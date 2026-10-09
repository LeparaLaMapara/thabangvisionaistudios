import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Found by the local journey tests: a gear payment whose webhook never
 * arrived stayed "We are confirming your payment" until the DAILY recovery
 * pass, with its hold lapsing in the meantime. The return page now asks the
 * server to check the charge with the provider (POST /api/cart/confirm).
 *
 * Money safety: only the provider's own answer confirms (same use case as a
 * webhook); only the renter's own order; never releases or cancels anything.
 */

const ORDER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let user: { id: string } | null = { id: 'renter-1' };
let intentRow: { reference: string; provider: string; state: string; user_id: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  createAdminClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve({ data: intentRow, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: vi.fn(async () => undefined) }));

const processChargeEvent = vi.fn();
vi.mock('@/lib/core/rental/use-cases', () => ({
  processChargeEvent: (...a: unknown[]) => processChargeEvent(...a),
  submitPayout: vi.fn(),
  submitRefund: vi.fn(),
}));
vi.mock('@/lib/delivery/after-payment', () => ({ afterRentalPayment: vi.fn(async () => 'none') }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: vi.fn() }));
vi.mock('@/lib/rental/eligibility-server', () => ({ lateConfirmationAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/rental/repos', () => ({
  SupabaseRentalPayments: class {
    async getIntent() {
      return { userId: 'renter-1', checkoutGroupId: ORDER };
    }
  },
  SupabaseRefunds: class {},
  SupabasePayouts: class {},
  isMissingPipeline: () => false,
  transitionBookings: vi.fn(),
}));

type Verify =
  | { ok: true; value: { status: string; amountCents: number; currency: string; providerTransactionId: string } }
  | { ok: false; kind: 'rejected' | 'unknown'; message: string };
const verifyCharge = vi.fn<(ref: string) => Promise<Verify>>();
const port = { provider: 'paystack', capabilities: {}, refund: vi.fn(), listRefunds: vi.fn(), verifyCharge } as never;
vi.mock('@/lib/payments/ports', () => ({
  paymentPort: { provider: 'paystack', verifyCharge: (r: string) => verifyCharge(r) },
  payoutPort: {},
}));

import { confirmPaymentOnReturn } from '@/lib/rental/workers';
import { POST } from '@/app/api/cart/confirm/route';

const db = {} as never;
const success: Verify = { ok: true, value: { status: 'success', amountCents: 97500, currency: 'ZAR', providerTransactionId: '5000001' } };

beforeEach(() => {
  verifyCharge.mockReset();
  processChargeEvent.mockReset();
  user = { id: 'renter-1' };
  intentRow = { reference: ORDER, provider: 'paystack', state: 'initiated', user_id: 'renter-1' };
});

describe('confirmPaymentOnReturn', () => {
  it('confirms through the webhook use case when the provider reports success', async () => {
    verifyCharge.mockResolvedValue(success);
    processChargeEvent.mockResolvedValue('confirmed');
    const r = await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'paystack', state: 'initiated' }, port);
    expect(r).toEqual({ state: 'paid', outcome: 'confirmed' });
    expect(processChargeEvent).toHaveBeenCalledTimes(1);
    expect(processChargeEvent.mock.calls[0][0]).toMatchObject({ kind: 'charge.success', reference: ORDER, amountCents: 97500, providerTransactionId: '5000001' });
  });

  it('confirms nothing when the provider says abandoned, pending, or cannot be asked', async () => {
    verifyCharge.mockResolvedValueOnce({ ok: true, value: { ...success.value, status: 'abandoned' } });
    expect((await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'paystack', state: 'initiated' }, port)).state).toBe('not_paid');
    verifyCharge.mockResolvedValueOnce({ ok: true, value: { ...success.value, status: 'ongoing' } });
    expect((await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'paystack', state: 'initiated' }, port)).state).toBe('pending');
    verifyCharge.mockResolvedValueOnce({ ok: false, kind: 'unknown', message: 'timeout' });
    expect((await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'paystack', state: 'initiated' }, port)).state).toBe('unknown');
    expect(processChargeEvent).not.toHaveBeenCalled();
  });

  it('does not ask again for a settled order, nor ask a different provider', async () => {
    expect((await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'paystack', state: 'paid' }, port)).state).toBe('already_settled');
    expect((await confirmPaymentOnReturn(db, { reference: ORDER, provider: 'yoco', state: 'initiated' }, port)).state).toBe('unknown');
    expect(verifyCharge).not.toHaveBeenCalled();
  });
});

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost:3000/api/cart/confirm', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/cart/confirm', () => {
  it('needs a signed-in renter and a well-formed order id', async () => {
    user = null;
    expect((await call({ checkout_group_id: ORDER })).status).toBe(401);
    user = { id: 'renter-1' };
    expect((await call({ checkout_group_id: 'nope' })).status).toBe(400);
  });

  it("answers someone else's order exactly like a missing one", async () => {
    intentRow = { reference: ORDER, provider: 'paystack', state: 'initiated', user_id: 'someone-else' };
    expect((await call({ checkout_group_id: ORDER })).status).toBe(404);
    expect(verifyCharge).not.toHaveBeenCalled();
  });

  it('confirms the renter\'s own paid order', async () => {
    verifyCharge.mockResolvedValue(success);
    processChargeEvent.mockResolvedValue('confirmed');
    const res = await call({ checkout_group_id: ORDER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'paid', outcome: 'confirmed' });
  });
});
