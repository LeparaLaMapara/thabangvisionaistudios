import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/cart/cancel: back from the payment page without paying. The
 * unpaid hold is ended (lapsed-hold rule, nothing deleted) and the items go
 * back into the cart, so trying again does not reserve the gear twice. A
 * paid or confirmed order is never touched.
 *
 * Money safety: the payment provider is asked first. Paid or still being
 * processed: refused (409), nothing released. Provider unreachable: refused
 * (503), nothing released. The call is idempotent: a second POST releases
 * nothing and puts nothing back.
 */

const ORDER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
let user: { id: string } | null = { id: 'renter-1' };

type Line = {
  id: string;
  rental_id: string;
  quantity: number;
  start_date: string;
  end_date: string;
  status: string;
  payfast_payment_id: string | null;
  hold_expires_at?: string | null;
};
type Intent = { reference: string; provider: string; state: string };
let lines: Line[] = [];
let linesAfter: Line[] | null = null;
let intent: Intent | null = null;
let updateErrors: Record<string, { code?: string; message: string } | null> = {};
/** Another request releases the lines between our read and our update. */
let releasedElsewhere = false;
const updates: { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];

const matches = (row: Record<string, unknown>, filters: [string, string, unknown][]): boolean =>
  filters.every(([op, k, v]) => {
    const value = row[k];
    if (op === 'eq') return value === v;
    if (op === 'is') return (value ?? null) === v;
    if (op === 'in') return (v as unknown[]).includes(value);
    if (op === 'gt') return typeof value === 'string' && value > (v as string);
    return true;
  });

function builder(table: string) {
  const filters: [string, string, unknown][] = [];
  let patch: Record<string, unknown> | null = null;
  const b = {
    select: () => b,
    update: (p: Record<string, unknown>) => { patch = p; return b; },
    eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return b; },
    in: (k: string, v: unknown) => { filters.push(['in', k, v]); return b; },
    is: (k: string, v: unknown) => { filters.push(['is', k, v]); return b; },
    gt: (k: string, v: unknown) => { filters.push(['gt', k, v]); return b; },
    maybeSingle: () => b,
    then: (resolve: (v: unknown) => unknown) => {
      if (patch) {
        updates.push({ table, patch, filters: filters.map(([, k, v]): [string, unknown] => [k, v]) });
        const error = updateErrors[table] ?? null;
        if (error || table !== 'equipment_bookings') return Promise.resolve({ data: null, error }).then(resolve);
        const changed = releasedElsewhere ? [] : lines.filter((l) => matches({ checkout_group_id: ORDER, user_id: 'renter-1', ...l }, filters));
        for (const l of changed) Object.assign(l, patch);
        return Promise.resolve({ data: changed.map((l) => ({ id: l.id })), error: null }).then(resolve);
      }
      if (table === 'rental_payment_intents') return Promise.resolve({ data: intent, error: null }).then(resolve);
      const data = linesAfter && readCount.n++ > 0 ? linesAfter : lines.map((l) => ({ ...l }));
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return b;
}
const readCount = { n: 0 };

type Verify = { ok: true; value: { status: string; amountCents: number; currency: string; providerTransactionId: string } } | { ok: false; kind: 'rejected' | 'unknown'; message: string };
const verifyCharge = vi.fn<(ref: string) => Promise<Verify>>();
let adapterProvider = 'paystack';
const charge = (status: string): Verify => ({ ok: true, value: { status, amountCents: 100_00, currency: 'ZAR', providerTransactionId: 'tx' } });

const addToCart = vi.fn(async () => ({ id: 'cart-item' }));
let cartNow: { rental_id: string }[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/queries/cart', () => ({
  addToCart: (...a: unknown[]) => addToCart(...(a as [])),
  getCartItems: async () => cartNow,
}));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/payments/ports', () => ({
  paymentAdapterFor: () => ({ ok: true, adapter: { provider: adapterProvider, verifyCharge: (r: string) => verifyCharge(r) } }),
}));

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/cart/cancel/route');
  return POST(new NextRequest('http://localhost/api/cart/cancel', { method: 'POST', body: JSON.stringify(body) }));
};

const pendingLine = (over: Partial<Line> = {}): Line => ({
  id: 'b1', rental_id: 'r1', quantity: 2, start_date: '2026-10-20', end_date: '2026-10-22', status: 'pending', payfast_payment_id: null, hold_expires_at: FUTURE, ...over,
});

describe('POST /api/cart/cancel', () => {
  beforeEach(() => {
    user = { id: 'renter-1' };
    lines = [pendingLine(), pendingLine({ id: 'b2', rental_id: 'r2', quantity: 1 })];
    linesAfter = null;
    intent = { reference: ORDER, provider: 'paystack', state: 'initiated' };
    adapterProvider = 'paystack';
    releasedElsewhere = false;
    readCount.n = 0;
    updateErrors = {};
    updates.length = 0;
    addToCart.mockClear();
    cartNow = [];
    verifyCharge.mockReset().mockResolvedValue(charge('abandoned'));
  });

  it('needs a signed-in renter and an order id', async () => {
    user = null;
    expect((await post({ checkout_group_id: ORDER })).status).toBe(401);
    user = { id: 'renter-1' };
    expect((await post({ checkout_group_id: 'nope' })).status).toBe(400);
  });

  it('404 when the order is not this renter\'s', async () => {
    lines = [];
    expect((await post({ checkout_group_id: ORDER })).status).toBe(404);
  });

  it('ends the unpaid hold (intent first, then the lines) and puts the items back', async () => {
    const res = await post({ checkout_group_id: ORDER });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ released: true, restored: 2 });
    expect(verifyCharge).toHaveBeenCalledWith(ORDER);
    expect(updates.map((u) => u.table)).toEqual(['rental_payment_intents', 'equipment_bookings']);
    for (const u of updates) expect(Object.keys(u.patch)).toEqual(['hold_expires_at', 'updated_at']);
    // Only unpaid, pending lines of this renter whose hold is still running; only open intents.
    expect(updates[0].filters).toContainEqual(['state', ['initiated', 'failed']]);
    expect(updates[1].filters).toEqual(expect.arrayContaining([['user_id', 'renter-1'], ['status', 'pending'], ['payfast_payment_id', null]]));
    expect(updates[1].filters.map(([k]) => k)).toContain('hold_expires_at');
    expect(addToCart).toHaveBeenCalledWith('renter-1', 'r1', 2, '2026-10-20', '2026-10-22');
    expect(addToCart).toHaveBeenCalledWith('renter-1', 'r2', 1, '2026-10-20', '2026-10-22');
  });

  it('keeps a newer choice for the same gear already in the cart (another tab)', async () => {
    cartNow = [{ rental_id: 'r1' }];
    const res = await post({ checkout_group_id: ORDER });
    expect(await res.json()).toMatchObject({ released: true, restored: 1, kept: 1 });
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(addToCart).toHaveBeenCalledWith('renter-1', 'r2', 1, '2026-10-20', '2026-10-22');
  });

  it('never touches a paid or confirmed order', async () => {
    lines = [pendingLine({ status: 'confirmed', payfast_payment_id: 'tx-1' })];
    const res = await post({ checkout_group_id: ORDER });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_PAID');
    expect(updates).toHaveLength(0);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it('a payment confirmed meanwhile wins: nothing goes back in the cart', async () => {
    linesAfter = [pendingLine({ status: 'confirmed', payfast_payment_id: 'tx-2' })];
    const res = await post({ checkout_group_id: ORDER });
    expect(res.status).toBe(409);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it('before migration 070 the hold is kept and the cart is not refilled (no double reservation)', async () => {
    updateErrors = {
      rental_payment_intents: { code: '42P01', message: 'relation does not exist' },
      equipment_bookings: { code: '42703', message: 'column "hold_expires_at" does not exist' },
    };
    const res = await post({ checkout_group_id: ORDER });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ released: false, code: 'HOLD_KEPT', booking_id: 'b1' });
    expect(addToCart).not.toHaveBeenCalled();
  });

  describe('the provider is asked before anything is released', () => {
    it('provider says PAID (webhook not in yet): 409 PAYMENT_RECEIVED, hold kept, cart untouched', async () => {
      verifyCharge.mockResolvedValue(charge('success'));
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ released: false, code: 'PAYMENT_RECEIVED', booking_id: 'b1' });
      expect(updates).toHaveLength(0);
      expect(addToCart).not.toHaveBeenCalled();
      expect(lines.every((l) => l.hold_expires_at === FUTURE)).toBe(true);
    });

    it.each(['ongoing', 'pending', 'processing', 'queued', 'something_new'])('provider says %s: 409 PAYMENT_IN_PROGRESS, nothing released', async (status) => {
      verifyCharge.mockResolvedValue(charge(status));
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('PAYMENT_IN_PROGRESS');
      expect(updates).toHaveLength(0);
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('provider unreachable (timeout / 5xx): 503, fail closed, nothing released', async () => {
      verifyCharge.mockResolvedValue({ ok: false, kind: 'unknown', message: 'timeout' });
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('PAYMENT_CHECK_UNAVAILABLE');
      expect(body.error).toMatch(/can't check your payment right now/i);
      expect(updates).toHaveLength(0);
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('the provider call throwing is treated as unreachable', async () => {
      verifyCharge.mockRejectedValue(new Error('network down'));
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(503);
      expect(updates).toHaveLength(0);
    });

    it('a refusal that is not "not found" (bad key, rate limit) says nothing about the money: 503', async () => {
      verifyCharge.mockResolvedValue({ ok: false, kind: 'rejected', message: 'Invalid key' });
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(503);
      expect(updates).toHaveLength(0);
    });

    it('"transaction not found" is a definite no: released', async () => {
      verifyCharge.mockResolvedValue({ ok: false, kind: 'rejected', message: 'Transaction reference not found' });
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(200);
      expect((await res.json()).released).toBe(true);
    });

    it('a payment taken by another provider cannot be checked here: 503, nothing released', async () => {
      intent = { reference: 'ch_123', provider: 'yoco', state: 'initiated' };
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(503);
      expect(verifyCharge).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    });

    it('an intent already marked paid: 409 PAYMENT_RECEIVED without asking the provider', async () => {
      intent = { reference: ORDER, provider: 'paystack', state: 'paid' };
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('PAYMENT_RECEIVED');
      expect(updates).toHaveLength(0);
    });

    it('no intent (nothing was sent to a provider, payments offline): released without asking', async () => {
      intent = null;
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(200);
      expect(verifyCharge).not.toHaveBeenCalled();
      expect((await res.json()).restored).toBe(2);
    });
  });

  describe('idempotent', () => {
    it('a second call (Back button, retry) releases nothing and refills nothing', async () => {
      const first = await post({ checkout_group_id: ORDER });
      expect((await first.json()).released).toBe(true);
      expect(addToCart).toHaveBeenCalledTimes(2);
      updates.length = 0;
      verifyCharge.mockClear();

      const second = await post({ checkout_group_id: ORDER });
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ released: false, code: 'ALREADY_RELEASED', restored: 0 });
      expect(addToCart).toHaveBeenCalledTimes(2);
      expect(updates).toHaveLength(0);
      expect(verifyCharge).not.toHaveBeenCalled();
    });

    it('refills only the lines this call released: not a lapsed one, not a cancelled one', async () => {
      lines = [
        pendingLine(),
        pendingLine({ id: 'b2', rental_id: 'r2', hold_expires_at: PAST }),
        pendingLine({ id: 'b3', rental_id: 'r3', status: 'cancelled', hold_expires_at: PAST }),
      ];
      const res = await post({ checkout_group_id: ORDER });
      expect(await res.json()).toMatchObject({ released: true, restored: 1, items: 1 });
      expect(addToCart).toHaveBeenCalledTimes(1);
      expect(addToCart).toHaveBeenCalledWith('renter-1', 'r1', 2, '2026-10-20', '2026-10-22');
    });

    it('two calls racing: the one whose update changed no rows refills nothing', async () => {
      releasedElsewhere = true;
      const res = await post({ checkout_group_id: ORDER });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ released: false, code: 'ALREADY_RELEASED' });
      expect(addToCart).not.toHaveBeenCalled();
    });
  });
});
