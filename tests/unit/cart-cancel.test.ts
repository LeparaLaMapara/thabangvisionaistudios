import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/cart/cancel: back from the payment page without paying. The
 * unpaid hold is ended (lapsed-hold rule, nothing deleted) and the items go
 * back into the cart, so trying again does not reserve the gear twice. A
 * paid or confirmed order is never touched.
 */

const ORDER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let user: { id: string } | null = { id: 'renter-1' };

type Line = { id: string; rental_id: string; quantity: number; start_date: string; end_date: string; status: string; payfast_payment_id: string | null };
let lines: Line[] = [];
let linesAfter: Line[] | null = null;
let updateErrors: Record<string, { code?: string; message: string } | null> = {};
const updates: { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];

function builder(table: string) {
  const filters: [string, unknown][] = [];
  let patch: Record<string, unknown> | null = null;
  const b = {
    select: () => b,
    update: (p: Record<string, unknown>) => { patch = p; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    in: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    is: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    then: (resolve: (v: unknown) => unknown) => {
      if (patch) {
        updates.push({ table, patch, filters });
        return Promise.resolve({ error: updateErrors[table] ?? null }).then(resolve);
      }
      const data = linesAfter && readCount.n++ > 0 ? linesAfter : lines;
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return b;
}
const readCount = { n: 0 };

const addToCart = vi.fn(async () => ({ id: 'cart-item' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/queries/cart', () => ({ addToCart: (...a: unknown[]) => addToCart(...(a as [])) }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/cart/cancel/route');
  return POST(new NextRequest('http://localhost/api/cart/cancel', { method: 'POST', body: JSON.stringify(body) }));
};

const pendingLine = (over: Partial<Line> = {}): Line => ({
  id: 'b1', rental_id: 'r1', quantity: 2, start_date: '2026-10-20', end_date: '2026-10-22', status: 'pending', payfast_payment_id: null, ...over,
});

describe('POST /api/cart/cancel', () => {
  beforeEach(() => {
    user = { id: 'renter-1' };
    lines = [pendingLine(), pendingLine({ id: 'b2', rental_id: 'r2', quantity: 1 })];
    linesAfter = null;
    readCount.n = 0;
    updateErrors = {};
    updates.length = 0;
    addToCart.mockClear();
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
    expect(updates.map((u) => u.table)).toEqual(['rental_payment_intents', 'equipment_bookings']);
    for (const u of updates) expect(Object.keys(u.patch)).toEqual(['hold_expires_at', 'updated_at']);
    // Only unpaid, pending lines of this renter; only open intents.
    expect(updates[0].filters).toContainEqual(['state', ['initiated', 'failed']]);
    expect(updates[1].filters).toEqual(expect.arrayContaining([['user_id', 'renter-1'], ['status', 'pending'], ['payfast_payment_id', null]]));
    expect(addToCart).toHaveBeenCalledWith('renter-1', 'r1', 2, '2026-10-20', '2026-10-22');
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
});
