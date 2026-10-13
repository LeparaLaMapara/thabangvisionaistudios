import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Audit 2026-10-13: the payment records (booking_payments) are the
 * reconciliation record a Yoco / legacy payment is confirmed against
 * (lib/payments/fulfil.ts). They were written after the payment link existed,
 * with the error ignored: a failed write left a paid order pending for good.
 * Now they are written before the link, and a failed write releases the hold
 * and hands out no link.
 */

let verification = 'verified';
let available = true;
let eligibility: Record<string, unknown> = { ok: true, collectionRequired: false, collectionReasons: [], requiresManualApproval: false, assessment: { tier: { id: 'contactable' } } };

const recordConsent = vi.fn(async () => ({ ok: true }));
const checkRenterEligibility = vi.fn(async () => eligibility);
const reserveOrder = vi.fn(async () => ({ ok: true, bookingIds: ['b1'], holdExpiresAt: '2030-01-01T00:00:00Z' }));
const releaseUnpaidReservation = vi.fn(async () => undefined);
type CheckoutParams = { cancelUrl: string; returnUrl: string };
const createCheckout = vi.fn<(params: CheckoutParams) => Promise<{ paymentUrl: string }>>(async () => ({ paymentUrl: 'https://checkout.paystack.com/abc' }));
const trackFunnel = vi.fn();
/** The owner's earlier community-gear bookings that reached payment (read by the first-booking funnel). */
let ownerEarlierBookings: { id: string }[] = [];
let paymentRecordError: { message: string } | null = null;

function chain(result: unknown): unknown {
  const fn = function () {};
  const proxy: unknown = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'renter-1', email: 'r@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { verification_status: verification } }) }) }) }),
  }),
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === 'smart_rentals'
          ? { data: [{ id: 'r1', owner_type: 'community', owner_id: 'owner-9' }], error: null }
          : table === 'equipment_bookings'
            ? { data: ownerEarlierBookings, error: null }
            : table === 'booking_payments'
              ? { data: null, error: paymentRecordError }
              : { data: [], error: null },
      ),
  }),
}));
vi.mock('@/lib/auth', () => ({ checkNotSuspended: async () => ({ suspended: false }), checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/consent', () => ({ recordConsent: (...a: unknown[]) => recordConsent(...(a as [])), requiredConsents: () => ['terms', 'privacy', 'rental_agreement'] }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: (...a: unknown[]) => trackFunnel(...a) }));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => true, createCheckout: (p: CheckoutParams) => createCheckout(p) } }));
vi.mock('@/lib/supabase/queries/cart', () => ({
  getCartItems: async () => [
    {
      id: 'c1',
      rental_id: 'r1',
      quantity: 1,
      start_date: '2030-01-10',
      end_date: '2030-01-12',
      rental: { id: 'r1', title: 'Camera', price_per_day: 500, price_per_week: null, deposit_amount: 0, replacement_value: 10_000, currency: 'ZAR', is_available: true, quantity: 1 },
    },
  ],
  clearCart: vi.fn(async () => undefined),
}));
vi.mock('@/lib/rental/availability-server', () => ({
  loadHolds: async () => [],
  blockedUnits: async () => (available ? 0 : 1),
  effectiveHoldMinutes: () => 30,
}));
vi.mock('@/lib/rental/eligibility-server', () => ({ checkRenterEligibility: (...a: unknown[]) => checkRenterEligibility(...(a as [])) }));
vi.mock('@/lib/rental/reserve', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/reserve')>()),
  reserveOrder: (...a: unknown[]) => reserveOrder(...(a as [])),
  releaseUnpaidReservation: (...a: unknown[]) => releaseUnpaidReservation(...(a as [])),
}));
vi.mock('@/lib/demand/record', () => ({ recordUnmetDemandAsync: vi.fn() }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));
vi.mock('@/lib/payments/offline', () => ({ reportUnpaidRequest: vi.fn(), PAYMENTS_OFF_MESSAGE: 'off' }));

const checkout = async (body: Record<string, unknown> = { acceptTerms: true }) => {
  const { POST } = await import('@/app/api/cart/checkout/route');
  return POST(
    new NextRequest('http://localhost/api/cart/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-1' },
      body: JSON.stringify(body),
    }),
  );
};

describe('cart checkout: payment records before the payment link', () => {
  beforeEach(() => {
    verification = 'verified';
    available = true;
    ownerEarlierBookings = [];
    paymentRecordError = null;
    eligibility = { ok: true, collectionRequired: false, collectionReasons: [], requiresManualApproval: false, assessment: { tier: { id: 'contactable' } } };
    for (const m of [recordConsent, checkRenterEligibility, reserveOrder, releaseUnpaidReservation, createCheckout, trackFunnel]) m.mockClear();
  });

  it('a failed payment record write releases the hold and hands out no payment link', async () => {
    paymentRecordError = { message: 'insert failed: secret detail' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await checkout();
    spy.mockRestore();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret detail');
    expect(createCheckout).not.toHaveBeenCalled();
    expect(releaseUnpaidReservation).toHaveBeenCalledTimes(1);
  });

  it('with the records written, the link is created after them', async () => {
    const res = await checkout();
    expect(res.status).toBe(201);
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(releaseUnpaidReservation).not.toHaveBeenCalled();
  });
});
