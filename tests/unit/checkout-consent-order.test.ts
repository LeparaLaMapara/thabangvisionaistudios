import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Phase 3 checkout ordering:
 *  - consent is recorded only after the order passed the date, availability
 *    and eligibility checks (a refused order leaves no consent record);
 *  - refusals carry a machine code the cart turns into a fix link;
 *  - a cancelled payment returns to the cart with the order id, so its hold
 *    can be released (POST /api/cart/cancel);
 *  - funnel events carry ids and counts only.
 * Every server-side gate stays: these tests also check the gates still refuse.
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
    from: (table: string) => chain(table === 'smart_rentals' ? { data: [{ id: 'r1', owner_type: 'community', owner_id: 'owner-9' }], error: null } : { data: [], error: null }),
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

describe('cart checkout: consent after eligibility, codes, cancel return', () => {
  beforeEach(() => {
    verification = 'verified';
    available = true;
    eligibility = { ok: true, collectionRequired: false, collectionReasons: [], requiresManualApproval: false, assessment: { tier: { id: 'contactable' } } };
    for (const m of [recordConsent, checkRenterEligibility, reserveOrder, releaseUnpaidReservation, createCheckout, trackFunnel]) m.mockClear();
  });

  it('still refuses without the Terms tick, before anything else', async () => {
    const res = await checkout({});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CONSENT_REQUIRED');
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('identity gate carries a code (required / pending) and records nothing', async () => {
    verification = 'unverified';
    let res = await checkout();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ID_REQUIRED');
    verification = 'pending';
    res = await checkout();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ID_PENDING');
    expect(recordConsent).not.toHaveBeenCalled();
    expect(reserveOrder).not.toHaveBeenCalled();
  });

  it('an unavailable item is refused without recording consent', async () => {
    available = false;
    const res = await checkout();
    expect(res.status).toBe(409);
    expect(recordConsent).not.toHaveBeenCalled();
    expect(checkRenterEligibility).not.toHaveBeenCalled();
  });

  it('an ineligible renter is refused with the code, without recording consent', async () => {
    eligibility = { ok: false, code: 'not_eligible', message: 'Before your first hire, please verify your phone number.', assessment: { tier: { id: 'none' } }, exposureCents: 0 };
    const res = await checkout();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_eligible');
    expect(recordConsent).not.toHaveBeenCalled();
    expect(reserveOrder).not.toHaveBeenCalled();
  });

  it('records consent after eligibility and before reserving, and returns to the cart with the order on cancel', async () => {
    const res = await checkout();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(checkRenterEligibility.mock.invocationCallOrder[0]).toBeLessThan(recordConsent.mock.invocationCallOrder[0]);
    expect(recordConsent.mock.invocationCallOrder[0]).toBeLessThan(reserveOrder.mock.invocationCallOrder[0]);

    const params = createCheckout.mock.calls[0][0];
    expect(params.cancelUrl).toBe(`/dashboard/cart?payment=cancelled&order=${body.checkout_group_id}`);
    expect(params.returnUrl).toBe(`/dashboard/bookings?checkout=${body.checkout_group_id}&payment=success`);

    const stages = trackFunnel.mock.calls.map((c) => c[0]);
    expect(stages).toEqual(expect.arrayContaining(['rental_reserved', 'payment_started', 'listing_first_booking']));
    const owner = trackFunnel.mock.calls.find((c) => c[0] === 'listing_first_booking');
    expect(owner?.[1]).toMatchObject({ userId: 'owner-9', meta: { rentalId: 'r1' } });
    // Ids and counts only: no amounts.
    for (const [, p] of trackFunnel.mock.calls) {
      expect(JSON.stringify(p)).not.toMatch(/amount|price|email/i);
    }
  });
});
