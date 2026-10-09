/**
 * POST /api/delivery/quote (Phase 4 §4.7, §4.17). The fee comes from the
 * SERVER-verified address: a spoofed browser position cannot change it.
 * Delivery is offered only to eligible renters; others get collection only,
 * with the reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { STUDIO } from '@/lib/constants';
import { cleanRenter, RENTER } from './helpers/delivery-fakes';
import { checkoutWorld, DURBAN, PRETORIA_NORTH, SANDTON, type CheckoutWorld } from './helpers/delivery-checkout-fakes';

const h = vi.hoisted(() => ({ w: null as unknown as CheckoutWorld, logEvent: vi.fn(), cheap: false }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000000a1' } } }) } }),
  createAdminClient: () => ({}),
}));
vi.mock('@/lib/auth', () => ({ checkNotSuspended: async () => ({ suspended: false }), checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: (...a: unknown[]) => h.logEvent(...a) }));
vi.mock('@/lib/supabase/queries/cart', () => ({
  getCartItems: async () => [
    { id: 'c1', rental_id: 'cam-1', quantity: 1, start_date: '2026-10-20', end_date: '2026-10-22', rental: { replacement_value: h.cheap ? 1_000 : 15_000, deposit_amount: 250 } },
    { id: 'c2', rental_id: 'lens-1', quantity: 1, start_date: '2026-10-20', end_date: '2026-10-22', rental: { replacement_value: h.cheap ? 500 : 8_000, deposit_amount: 125 } },
  ],
}));
vi.mock('@/lib/delivery/server', () => ({ deliveryDeps: async () => h.w.deps }));
vi.mock('@/lib/delivery/address', async (orig) => ({ ...(await orig<typeof import('@/lib/delivery/address')>()), addressPort: () => h.w.geocoder }));
vi.mock('@/lib/delivery/address-store', () => ({
  SupabaseDeliveryAddressWriter: class {
    saveRenterAddress(p: never) {
      return h.w.writer.saveRenterAddress(p);
    }
    platformSiteId() {
      return h.w.writer.platformSiteId();
    }
  },
}));
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

const ADDRESS = { street: '1 Test Road', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196' };
const BASE = { address: ADDRESS, contact_name: 'Thandi', contact_phone: '082 123 4567', window: 'morning' };
const OFFICE_PIN = { lat: STUDIO.fulfilment.dispatchFrom.lat, lng: STUDIO.fulfilment.dispatchFrom.lng };

async function quote(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/delivery/quote/route');
  const res = await POST(new NextRequest('http://localhost/api/delivery/quote', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { quotes?: { customer_fee_cents: number; leg: string; id: string; window_start: string }[] } };
}

/** What our own vehicle charges for this cart to a point, from our site. */
const feeTo = (p: { lat: number; lng: number }): number => {
  const q = quoteOwnVehicleCents({ origin: { name: 'origin', coords: OFFICE_PIN }, destination: p, itemCount: 2 });
  if (!('feeCents' in q)) throw new Error('no fee');
  return q.feeCents;
};

describe('delivery quote: the verified address sets the price', () => {
  beforeEach(() => {
    h.w = checkoutWorld();
    h.logEvent.mockClear();
  });

  it('a spoofed browser position next to our office does not change the fee', async () => {
    h.w.geocoded = PRETORIA_NORTH;
    // Distance sets this fee (not the minimum), so a pin at our office would lower it.
    expect(feeTo(PRETORIA_NORTH)).toBeGreaterThan(feeTo(OFFICE_PIN));
    const honest = await quote(BASE);
    const spoofed = await quote({ ...BASE, hint: OFFICE_PIN });
    expect(honest.status).toBe(201);
    expect(spoofed.status).toBe(201);
    expect(honest.body.quotes?.[0].customer_fee_cents).toBe(feeTo(PRETORIA_NORTH));
    expect(spoofed.body.quotes?.[0].customer_fee_cents).toBe(feeTo(PRETORIA_NORTH));
    // The mismatch is logged for review, never used.
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'delivery_hint_mismatch' }));
    // The geocoder saw the typed text, not coordinates.
    expect(h.w.geocodeCalls[0]).toBe('1 Test Road, Sandton, Johannesburg, 2196');
  });

  it('a far address costs what the far address costs, whatever pin the browser sends', async () => {
    h.w.geocoded = PRETORIA_NORTH;
    const r = await quote({ ...BASE, hint: OFFICE_PIN });
    expect(r.body.quotes?.[0].customer_fee_cents).toBe(feeTo(PRETORIA_NORTH));
    expect(feeTo(PRETORIA_NORTH)).toBeGreaterThan(feeTo(SANDTON));
    // Stored with an expiry, against the verified address the renter owns.
    const stored = h.w.repo.quotes.get(r.body.quotes?.[0].id ?? '');
    expect(stored).toMatchObject({ renterId: RENTER, leg: 'outbound', status: 'active', customerFeeCents: feeTo(PRETORIA_NORTH) });
    expect(h.w.addresses.points.get(stored?.destinationAddressId ?? '')).toMatchObject({ lat: PRETORIA_NORTH.lat, lng: PRETORIA_NORTH.lng, userId: RENTER });
  });

  it('refuses a body that carries a price, before looking anything up', async () => {
    const r = await quote({ ...BASE, customer_fee_cents: 1 });
    expect(r).toMatchObject({ status: 400, body: { code: 'CLIENT_PRICE_REJECTED' } });
    expect(h.w.geocodeCalls).toHaveLength(0);
  });

  it('an address the server cannot find is refused (no fallback to the browser)', async () => {
    h.w.geocoded = null;
    const r = await quote({ ...BASE, hint: OFFICE_PIN });
    expect(r).toMatchObject({ status: 422, body: { code: 'ADDRESS_NOT_FOUND' } });
    expect(h.w.repo.quotes.size).toBe(0);
  });

  it('a return pickup is its own leg, on the last hire day', async () => {
    const r = await quote({ ...BASE, return_window: 'afternoon' });
    expect(r.body.quotes?.map((q) => q.leg)).toEqual(['outbound', 'return']);
    expect(r.body.quotes?.[1].window_start).toBe('2026-10-22T10:00:00.000Z');
    expect(r.body.delivery_total_cents).toBe(2 * feeTo(SANDTON));
  });
});

describe('delivery quote: eligibility gating (collection only, with the reason)', () => {
  beforeEach(() => {
    h.w = checkoutWorld();
    h.cheap = false;
  });

  it('first hire: collection in person (even for a small order)', async () => {
    h.cheap = true;
    h.w.trust.facts.set(RENTER, { ...cleanRenter, cleanReturns: 0, firstCleanReturnAt: null });
    const r = await quote(BASE);
    expect(r.body).toMatchObject({ ok: false, collection_only: true, code: 'first_hire' });
    expect(h.w.repo.quotes.size).toBe(0);
  });

  it('outside Gauteng: collection in person (travel is quoted separately)', async () => {
    h.w.geocoded = DURBAN;
    const r = await quote(BASE);
    expect(r.body).toMatchObject({ ok: false, collection_only: true, code: 'out_of_area' });
  });

  it('own-vehicle delivery switched off: collection in person', async () => {
    h.w.deps.flags = { courierEnabled: false, ownFleetEnabled: false };
    const r = await quote(BASE);
    expect(r.body).toMatchObject({ ok: false, collection_only: true, code: 'delivery_disabled' });
  });
});
