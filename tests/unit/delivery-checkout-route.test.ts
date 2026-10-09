/**
 * POST /api/cart/checkout with delivery (Phase 4 §4.7, D07, D08, and the
 * geocoding fix). The checkout charges the stored quote for a server-verified
 * address. The browser's position and any browser total are never charged;
 * an expired quote is re-quoted and a changed total needs the renter's
 * approval before anything is reserved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { deliveryLines, quoteCartDelivery } from '@/lib/delivery/checkout';
import { OFFICE, OTHER_USER, RENTER, RENTER_HOME } from './helpers/delivery-fakes';
import { checkoutWorld, PRETORIA_NORTH, SANDTON, type CheckoutWorld } from './helpers/delivery-checkout-fakes';

const h = vi.hoisted(() => ({
  w: null as unknown as CheckoutWorld,
  eligibility: { ok: true } as Record<string, unknown>,
  reserveOrder: vi.fn(),
  release: vi.fn(async () => undefined),
  logEvent: vi.fn(),
  checkRenterEligibility: vi.fn(),
}));

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
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000000a1', email: 'r@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { verification_status: 'verified' } }) }) }) }),
  }),
  createAdminClient: () => ({ from: (t: string) => chain(t === 'smart_rentals' ? { data: [], error: null } : { data: [], error: null }) }),
}));
vi.mock('@/lib/auth', () => ({ checkNotSuspended: async () => ({ suspended: false }), checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: (...a: unknown[]) => h.logEvent(...a) }));
vi.mock('@/lib/consent', () => ({ recordConsent: async () => ({ ok: true }), requiredConsents: () => [] }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: vi.fn() }));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => true, createCheckout: async () => ({ paymentUrl: 'https://checkout.paystack.com/abc' }) } }));
vi.mock('@/lib/supabase/queries/cart', () => ({
  getCartItems: async () => [
    { id: 'c1', rental_id: 'cam-1', quantity: 1, start_date: '2030-01-10', end_date: '2030-01-12', rental: { id: 'cam-1', title: 'Camera', price_per_day: 500, price_per_week: null, deposit_amount: 3_750, replacement_value: 15_000, currency: 'ZAR', is_available: true, quantity: 1 } },
    { id: 'c2', rental_id: 'lens-1', quantity: 1, start_date: '2030-01-10', end_date: '2030-01-12', rental: { id: 'lens-1', title: 'Lens', price_per_day: 200, price_per_week: null, deposit_amount: 2_000, replacement_value: 8_000, currency: 'ZAR', is_available: true, quantity: 1 } },
  ],
  clearCart: vi.fn(async () => undefined),
}));
vi.mock('@/lib/rental/availability-server', () => ({ loadHolds: async () => [], blockedUnits: async () => 0, effectiveHoldMinutes: () => 30 }));
vi.mock('@/lib/rental/eligibility-server', () => ({ checkRenterEligibility: (...a: unknown[]) => h.checkRenterEligibility(...a) }));
vi.mock('@/lib/rental/reserve', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/reserve')>()),
  reserveOrder: (...a: unknown[]) => h.reserveOrder(...a),
  releaseUnpaidReservation: (...a: unknown[]) => h.release(...(a as [])),
}));
vi.mock('@/lib/demand/record', () => ({ recordUnmetDemandAsync: vi.fn() }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));
vi.mock('@/lib/payments/offline', () => ({ reportUnpaidRequest: vi.fn(), PAYMENTS_OFF_MESSAGE: 'off' }));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => h.w.deps }));
vi.mock('@/lib/delivery/address', async (orig) => ({ ...(await orig<typeof import('@/lib/delivery/address')>()), addressPort: () => h.w.geocoder }));
vi.mock('@/lib/delivery/checkout', async (orig) => ({
  ...(await orig<typeof import('@/lib/delivery/checkout')>()),
  SupabaseQuoteLinks: class {
    linkToGroup(q: string, g: string) {
      return h.w.links.linkToGroup(q, g);
    }
    quotesForGroup(g: string) {
      return h.w.links.quotesForGroup(g);
    }
    available() {
      return h.w.links.available();
    }
  },
}));

const OFFICE_PIN = { lat: STUDIO.fulfilment.dispatchFrom.lat, lng: STUDIO.fulfilment.dispatchFrom.lng };
const CART = deliveryLines([
  { rentalId: 'cam-1', quantity: 1, unitReplacementValueCents: 1_500_000, startDate: '2030-01-10', endDate: '2030-01-12' },
  { rentalId: 'lens-1', quantity: 1, unitReplacementValueCents: 800_000, startDate: '2030-01-10', endDate: '2030-01-12' },
]);
const WINDOW = { start: '2030-01-10T06:00:00.000Z', end: '2030-01-10T10:00:00.000Z' };

async function storedQuote(renterId = RENTER, destination = RENTER_HOME) {
  const r = await quoteCartDelivery({ caller: { kind: 'renter', userId: renterId }, renterId, renterAddressId: destination, siteAddressId: OFFICE, lines: CART, legs: [{ leg: 'outbound', window: WINDOW }] }, h.w.deps);
  if (!r.ok) throw new Error(`quote failed: ${r.code}`);
  return r.quotes[0];
}

async function checkout(body: Record<string, unknown>, key = `key-${Math.random()}`) {
  const { POST } = await import('@/app/api/cart/checkout/route');
  const res = await POST(new NextRequest('http://localhost/api/cart/checkout', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ acceptTerms: true, fulfilment_method: 'delivery', ...body }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Reserved = { rows: Record<string, unknown>[]; intent: { deliveryCents: number; expectedAmountCents: number } };
const reserved = (): Reserved => {
  const c = h.reserveOrder.mock.calls[0] as unknown[];
  return { rows: c[1] as Record<string, unknown>[], intent: c[2] as Reserved['intent'] };
};

const MIDRAND = { lat: -25.9992, lng: 28.1263 };

describe('checkout with delivery: the server prices it', () => {
  beforeEach(() => {
    h.w = checkoutWorld();
    // The renter's verified address, far enough that distance (not the minimum) sets the fee.
    const home = h.w.addresses.points.get(RENTER_HOME);
    if (home) h.w.addresses.points.set(RENTER_HOME, { ...home, ...MIDRAND });
    h.reserveOrder.mockReset();
    h.reserveOrder.mockImplementation(async (_db: unknown, rows: { id: string }[]) => ({ ok: true, bookingIds: rows.map((r) => r.id), holdExpiresAt: '2030-01-01T00:00:00Z' }));
    h.release.mockClear();
    h.logEvent.mockClear();
    h.checkRenterEligibility.mockReset();
    h.checkRenterEligibility.mockImplementation(async () => ({ ok: true, requiresManualApproval: false, assessment: { tier: { id: 'established' } } }));
  });

  it('charges the stored quote; a spoofed browser position changes nothing', async () => {
    const q = await storedQuote();
    const atOffice = quoteOwnVehicleCents({ destination: OFFICE_PIN, itemCount: 2 });
    expect('feeCents' in atOffice && atOffice.feeCents).toBeLessThan(q.customerFeeCents);
    const r = await checkout({ delivery_quote_id: q.id, delivery_approved_cents: q.customerFeeCents, delivery_lat: OFFICE_PIN.lat, delivery_lng: OFFICE_PIN.lng });
    expect(r.status).toBe(201);
    const { rows, intent } = reserved();
    expect(intent.deliveryCents).toBe(q.customerFeeCents);
    const first = rows.find((x) => x.delivery_fee !== undefined) as Record<string, unknown>;
    // Legacy columns carry the VERIFIED point, not the browser's.
    const home = h.w.addresses.points.get(RENTER_HOME);
    expect(first).toMatchObject({ delivery_fee: q.customerFeeCents / 100, delivery_lat: home?.lat, delivery_lng: home?.lng, delivery_address: home?.formattedAddress });
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'delivery_hint_mismatch' }));
    // The quote is tied to the order so the verified payment can book it.
    expect(h.w.repo.quotes.get(q.id)?.bookingGroupId).toBe(r.body.checkout_group_id);
  });

  it('D08: a browser total that differs from the stored quote is refused before reserving', async () => {
    const q = await storedQuote();
    const r = await checkout({ delivery_quote_id: q.id, delivery_approved_cents: q.customerFeeCents - 1 });
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_PRICE_CHANGED', delivery_total_cents: q.customerFeeCents } });
    expect(h.reserveOrder).not.toHaveBeenCalled();
  });

  it('D07: an expired quote at the same price is re-quoted and goes ahead with the new quote', async () => {
    const q = await storedQuote();
    h.w.clock.advanceMinutes(31);
    const r = await checkout({ delivery_quote_id: q.id, delivery_approved_cents: q.customerFeeCents });
    expect(r.status).toBe(201);
    expect(reserved().intent.deliveryCents).toBe(q.customerFeeCents);
    expect(h.w.repo.quotes.get(q.id)?.status).toBe('superseded');
    const linked = [...h.w.repo.quotes.values()].filter((x) => x.bookingGroupId === r.body.checkout_group_id);
    expect(linked).toHaveLength(1);
    expect(linked[0].id).not.toBe(q.id);
  });

  it('D07: an expired quote at a NEW price comes back for approval; only the approved new total is charged', async () => {
    const q = await storedQuote();
    h.w.clock.advanceMinutes(31);
    // The verified point moved (the price is the provider's now, not the old one).
    const home = h.w.addresses.points.get(RENTER_HOME);
    if (home) h.w.addresses.points.set(RENTER_HOME, { ...home, lat: -25.7479, lng: 28.2293 });
    const first = await checkout({ delivery_quote_id: q.id, delivery_approved_cents: q.customerFeeCents });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('DELIVERY_REQUOTE');
    expect(h.reserveOrder).not.toHaveBeenCalled();
    const fresh = (first.body.quotes as { id: string; customer_fee_cents: number }[])[0];
    expect(first.body.delivery_total_cents).toBe(fresh.customer_fee_cents);
    expect(fresh.customer_fee_cents).toBeGreaterThan(q.customerFeeCents);
    // Approving the old total again is refused; approving the new one goes ahead.
    expect((await checkout({ delivery_quote_id: fresh.id, delivery_approved_cents: q.customerFeeCents })).status).toBe(409);
    const ok = await checkout({ delivery_quote_id: fresh.id, delivery_approved_cents: fresh.customer_fee_cents });
    expect(ok.status).toBe(201);
    expect(reserved().intent.deliveryCents).toBe(fresh.customer_fee_cents);
  });

  it('needs a stored quote, and only the renter’s own', async () => {
    expect((await checkout({ delivery_address: '1 Test Road, Sandton', delivery_lat: OFFICE_PIN.lat, delivery_lng: OFFICE_PIN.lng })).body.code).toBe('DELIVERY_QUOTE_REQUIRED');
  });

  it('a quote that belongs to someone else is refused', async () => {
    h.w.addresses.points.set('addr-other', { ...SANDTON, placeId: 'addr-other', userId: OTHER_USER, contactName: 'X', contactPhone: '0820000000', instructions: null });
    const theirs = await storedQuote(OTHER_USER, 'addr-other');
    const r = await checkout({ delivery_quote_id: theirs.id, delivery_approved_cents: theirs.customerFeeCents });
    expect(r).toMatchObject({ status: 400, body: { code: 'DELIVERY_QUOTE_INVALID' } });
    expect(h.reserveOrder).not.toHaveBeenCalled();
  });

  it('eligibility at checkout: a renter who must collect cannot pay for delivery', async () => {
    const q = await storedQuote();
    h.checkRenterEligibility.mockImplementation(async (_db: unknown, _u: unknown, _l: unknown, delivery: boolean) =>
      delivery ? { ok: false, code: 'collection_only', message: 'Your first hire is collected in person.', assessment: { tier: { id: 'none' } }, exposureCents: 0 } : { ok: true, assessment: { tier: { id: 'none' } } },
    );
    const r = await checkout({ delivery_quote_id: q.id, delivery_approved_cents: q.customerFeeCents });
    expect(r).toMatchObject({ status: 403, body: { code: 'collection_only' } });
    expect(h.checkRenterEligibility.mock.calls[0][3]).toBe(true);
    expect(h.reserveOrder).not.toHaveBeenCalled();
  });
});

describe('checkout with delivery before migration 076 (legacy formula)', () => {
  beforeEach(() => {
    h.w = checkoutWorld();
    h.w.migrationApplied = false;
    h.w.geocoded = PRETORIA_NORTH;
    h.reserveOrder.mockReset();
    h.reserveOrder.mockImplementation(async (_db: unknown, rows: { id: string }[]) => ({ ok: true, bookingIds: rows.map((r) => r.id), holdExpiresAt: '2030-01-01T00:00:00Z' }));
    h.checkRenterEligibility.mockReset();
    h.checkRenterEligibility.mockImplementation(async () => ({ ok: true, requiresManualApproval: false, assessment: { tier: { id: 'established' } } }));
  });

  it('geocodes the typed address on the server; the browser’s coordinates cannot lower the fee', async () => {
    const r = await checkout({ delivery_address: { street: '1 Test Road', suburb: 'Sandton', city: 'Johannesburg' }, delivery_lat: OFFICE_PIN.lat, delivery_lng: OFFICE_PIN.lng });
    expect(r.status).toBe(201);
    const expected = quoteOwnVehicleCents({ destination: PRETORIA_NORTH, itemCount: 2 });
    if (!('feeCents' in expected)) throw new Error('no fee');
    const atOffice = quoteOwnVehicleCents({ destination: OFFICE_PIN, itemCount: 2 });
    if (!('feeCents' in atOffice)) throw new Error('no fee');
    expect(expected.feeCents).toBeGreaterThan(atOffice.feeCents);
    expect(reserved().intent.deliveryCents).toBe(expected.feeCents);
    expect(reserved().rows.find((x) => x.delivery_fee !== undefined)).toMatchObject({ delivery_lat: PRETORIA_NORTH.lat, delivery_lng: PRETORIA_NORTH.lng });
  });

  it('an address the server cannot verify is refused; it never falls back to the browser position', async () => {
    h.w.geocoded = null;
    const r = await checkout({ delivery_address: '1 Nowhere Road, Atlantis', delivery_lat: OFFICE_PIN.lat, delivery_lng: OFFICE_PIN.lng });
    expect(r).toMatchObject({ status: 400, body: { code: 'ADDRESS_NOT_FOUND' } });
    expect(h.reserveOrder).not.toHaveBeenCalled();
  });
});
