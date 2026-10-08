import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WebhookResult } from '@/lib/payments/types';

// ─── In-memory Supabase fake ────────────────────────────────────────────────
// Supports the calls the subscription checkout route and fulfilment make:
// select/insert/update/delete with .eq filters, .maybeSingle(), .single(),
// and awaiting the builder directly.

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { subscription_plans: [], subscriptions: [], profiles: [] };
let nextId = 1;

function builder(table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let payload: Row | null = null;
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => (db[table] ??= []);
  const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);

  const run = (): { data: Row[]; error: null } => {
    if (op === 'insert') {
      const row = { id: `row-${nextId++}`, ...payload };
      rows().push(row);
      return { data: [row], error: null };
    }
    if (op === 'update') {
      const hit = rows().filter(matches);
      hit.forEach((r) => Object.assign(r, payload));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (op === 'delete') {
      const keep = rows().filter((r) => !matches(r));
      const removed = rows().length - keep.length;
      db[table] = keep;
      return { data: Array.from({ length: removed }, () => ({})), error: null };
    }
    return { data: rows().filter(matches).map((r) => ({ ...r })), error: null };
  };

  const b = {
    select: () => b,
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    maybeSingle: async () => { const { data } = run(); return { data: data[0] ?? null, error: null }; },
    single: async () => {
      const { data } = run();
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'not one row' } };
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  return b;
}

const fakeClient = { from: (t: string) => builder(t) };
let sessionUser: { id: string; email: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ ...fakeClient, auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
  createAdminClient: () => fakeClient,
}));

vi.mock('@/lib/auth', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: vi.fn(), sendGearNotice: vi.fn() }));

const createSubscriptionCheckout = vi.fn(async () => ({ paymentUrl: 'https://checkout.paystack.com/abc' }));
vi.mock('@/lib/payments', () => ({
  payments: { isConfigured: () => true, createSubscriptionCheckout },
}));

// Subscriptions are switched off in production config; the route is tested
// as it behaves when they are switched back on.
vi.mock('@/lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/constants')>();
  return { ...actual, STUDIO: { ...actual.STUDIO, subscriptions: { enabled: true } } };
});

const PRO = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const FREE = '33333333-3333-4333-8333-333333333333';
const USER = 'user-1';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  createSubscriptionCheckout.mockClear();
  sessionUser = { id: USER, email: 'creator@example.test' };
  db.subscription_plans = [
    { id: PRO, name: 'Pro Creator', price: 299, currency: 'ZAR', interval: 'monthly', is_active: true },
    { id: OLD, name: 'Legacy', price: 99, currency: 'ZAR', interval: 'monthly', is_active: false },
    { id: FREE, name: 'Starter', price: 0, currency: 'ZAR', interval: 'monthly', is_active: true },
  ];
  db.subscriptions = [];
  db.profiles = [{ id: USER }];
});

async function checkout(body: unknown) {
  const { POST } = await import('@/app/api/payfast/checkout/route');
  const req = new NextRequest('http://localhost:3000/api/payfast/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe('subscription checkout: the server sets the price', () => {
  it('creates a pending subscription priced from the plan table', async () => {
    const res = await checkout({ plan_id: PRO, billing: 'monthly' });
    expect(res.status).toBe(200);
    expect((await res.json()).payment_url).toBe('https://checkout.paystack.com/abc');

    expect(db.subscriptions).toHaveLength(1);
    const sub = db.subscriptions[0];
    expect(sub).toMatchObject({
      user_id: USER,
      plan_id: PRO,
      status: 'pending',
      expected_amount_cents: 29900,
      currency: 'ZAR',
      billing_interval: 'monthly',
    });
    expect(String(sub.provider_reference)).toMatch(/^sub_/);

    expect(createSubscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(createSubscriptionCheckout.mock.calls[0]).toEqual([
      expect.objectContaining({ amount: 299, subscriptionId: sub.provider_reference, planName: 'Pro Creator' }),
    ]);
  });

  it.each([
    ['amount', 1],
    ['price', 1],
    ['plan_name', 'Pro'],
    ['discount', 100],
    ['currency', 'USD'],
    ['commission', 0],
  ])('rejects a body carrying "%s" with 400 and writes nothing', async (key, value) => {
    const res = await checkout({ plan_id: PRO, billing: 'monthly', [key]: value });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(key);
    expect(db.subscriptions).toHaveLength(0);
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('rejects missing or malformed fields with 400', async () => {
    expect((await checkout({ plan_id: PRO })).status).toBe(400);
    expect((await checkout({ plan_id: PRO, billing: 'weekly' })).status).toBe(400);
    expect((await checkout({ plan_id: 'pro', billing: 'monthly' })).status).toBe(400);
    expect((await checkout([PRO])).status).toBe(400);
  });

  it('refuses an unknown plan with 400', async () => {
    const res = await checkout({ plan_id: '99999999-9999-4999-8999-999999999999', billing: 'monthly' });
    expect(res.status).toBe(400);
    expect(db.subscriptions).toHaveLength(0);
  });

  it('refuses an inactive plan with 400', async () => {
    const res = await checkout({ plan_id: OLD, billing: 'monthly' });
    expect(res.status).toBe(400);
    expect(db.subscriptions).toHaveLength(0);
  });

  it('refuses billing the plan is not offered at (no server-invented annual price)', async () => {
    const res = await checkout({ plan_id: PRO, billing: 'annual' });
    expect(res.status).toBe(400);
    expect(db.subscriptions).toHaveLength(0);
  });

  it('sends a free plan to the dashboard without a payment', async () => {
    const res = await checkout({ plan_id: FREE, billing: 'monthly' });
    expect(res.status).toBe(200);
    expect((await res.json()).payment_url).toBe('/dashboard?subscription=free');
    expect(db.subscriptions).toHaveLength(0);
  });

  it('requires sign-in', async () => {
    sessionUser = null;
    expect((await checkout({ plan_id: PRO, billing: 'monthly' })).status).toBe(401);
  });
});

describe('subscription confirmation: activate only on an exact match, once', () => {
  async function pending() {
    await checkout({ plan_id: PRO, billing: 'monthly' });
    return db.subscriptions[0];
  }

  function webhook(sub: Row, over: { amount?: number; currency?: string; reference?: string; plan?: string; user?: string } = {}): WebhookResult {
    return {
      valid: true,
      status: 'COMPLETE',
      providerPaymentId: 'ps_123',
      paymentId: over.reference ?? String(sub.provider_reference),
      amountGross: over.amount ?? 299,
      raw: {
        currency: over.currency ?? 'ZAR',
        customStr1: 'subscription',
        customStr2: over.user ?? USER,
        customStr3: over.plan ?? PRO,
      },
    };
  }

  it('activates when amount, currency, reference, plan and user match', async () => {
    const { handlePaymentComplete } = await import('@/lib/payments/fulfil');
    const sub = await pending();
    await handlePaymentComplete(webhook(sub));
    expect(db.subscriptions[0].status).toBe('active');
    expect(db.subscriptions[0].payfast_token).toBe('ps_123');
    expect(db.subscriptions[0].expected_amount_cents).toBe(29900);
  });

  it.each([
    ['a lower amount', { amount: 1 }],
    ['a higher amount', { amount: 2990 }],
    ['an amount one cent off', { amount: 298.99 }],
    ['another currency', { currency: 'USD' }],
    ['a different plan', { plan: OLD }],
    ['a different user', { user: 'someone-else' }],
  ])('does not activate on %s', async (_label, over) => {
    const { confirmSubscriptionPayment } = await import('@/lib/payments/fulfil');
    const sub = await pending();
    expect(await confirmSubscriptionPayment(webhook(sub, over))).toBe('rejected');
    expect(db.subscriptions[0].status).toBe('pending');
  });

  it('does not activate on an unknown reference', async () => {
    const { confirmSubscriptionPayment } = await import('@/lib/payments/fulfil');
    const sub = await pending();
    expect(await confirmSubscriptionPayment(webhook(sub, { reference: 'sub_forged' }))).toBe('rejected');
    expect(db.subscriptions[0].status).toBe('pending');
  });

  it('a duplicate confirmation activates only once and changes nothing the second time', async () => {
    const { confirmSubscriptionPayment } = await import('@/lib/payments/fulfil');
    const sub = await pending();
    expect(await confirmSubscriptionPayment(webhook(sub))).toBe('activated');
    const periodEnd = db.subscriptions[0].current_period_end;
    db.subscriptions[0].payfast_token = 'ps_123';
    expect(await confirmSubscriptionPayment({ ...webhook(sub), providerPaymentId: 'ps_456' })).toBe('already_active');
    expect(db.subscriptions[0]).toMatchObject({ status: 'active', payfast_token: 'ps_123', current_period_end: periodEnd });
  });

  it('a failed charge never cancels an active subscription', async () => {
    const { confirmSubscriptionPayment, handlePaymentFailed } = await import('@/lib/payments/fulfil');
    const sub = await pending();
    await confirmSubscriptionPayment(webhook(sub));
    await handlePaymentFailed({ ...webhook(sub), status: 'FAILED' });
    expect(db.subscriptions[0].status).toBe('active');
  });
});
