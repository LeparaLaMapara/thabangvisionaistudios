/**
 * Delivery pricing decisions of 2026-10-13 (owner):
 *  - R20 platform fee per courier leg (D-38), stored apart from the courier's cost;
 *  - both trips (to the renter and back) quoted up front and charged together;
 *  - the cheaper option for the renter wins (courier + fee against our own vehicle);
 *  - Uber Direct only inside its 10 km radius, and a refusal falls back quietly;
 *  - the courier trial runs on test deployments only, never on production.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_POLICY } from '@/lib/constants';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { priceDeliveryQuote } from '@/lib/core/delivery/quote';
import { selectDeliveryProviders, type EvaluatedCandidate } from '@/lib/core/delivery/select';
import { priceDeliveryForCheckout, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { quoteCartDelivery } from '@/lib/delivery/checkout';
import { CircuitBreaker, type FetchLike } from '@/lib/delivery/http';
import { sandboxCourierTrial, SANDBOX_TRIAL_POLICY_REF } from '@/lib/delivery/sandbox-trial';
import { createUberDirectAdapter, resetUberDirectTokenCache } from '@/lib/delivery/uber-direct';
import { withinUberRadius } from '@/lib/delivery/uber-direct/adapter';
import { deliveryTotalLabel } from '@/app/(platform)/dashboard/cart/DeliveryOptions';
import { ALL_CAPS, GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world } from './helpers/delivery-fakes';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW_OUT = { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T09:00:00.000Z' };
const WINDOW_BACK = { start: '2026-10-22T15:00:00.000Z', end: '2026-10-22T17:00:00.000Z' };
const renter = { kind: 'renter' as const, userId: RENTER };
const COURIER_POLICY = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };

const BRAAMFONTEIN = { lat: -26.1929, lng: 28.0305 };
const ROSEBANK = { lat: -26.146, lng: 28.041 };
const PRETORIA = { lat: -25.7479, lng: 28.2293 };

function courierWorld(costCents: number) {
  const w = world({ courierEnabled: true, providers: 'both', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = COURIER_POLICY;
  w.courier.costCents = costCents;
  return w;
}

describe('the R20 platform fee per leg (D-38)', () => {
  it('is R20 and is added to a courier leg, stored apart from the courier cost', () => {
    expect(DELIVERY_POLICY.platformFeeCents).toBe(2_000);
    const p = priceDeliveryQuote({ providerQuote: { providerId: 'uber_direct', providerQuoteRef: 'dqt_1', providerCostCents: 6_038, expiresAt: '2099-01-01T00:00:00Z', window: WINDOW_OUT }, providerKind: 'courier', now: NOW });
    expect(p).toMatchObject({ providerCostCents: 6_038, platformFeeCents: 2_000, customerFeeCents: 8_038 });
  });

  it('is not added to our own vehicle: its formula already is the customer price', () => {
    const p = priceDeliveryQuote({ providerQuote: { providerId: 'manual', providerQuoteRef: null, providerCostCents: 15_000, expiresAt: '2099-01-01T00:00:00Z', window: WINDOW_OUT }, providerKind: 'own_fleet', now: NOW });
    expect(p).toMatchObject({ platformFeeCents: 0, customerFeeCents: 15_000 });
  });
});

describe('the cheaper option for the renter wins', () => {
  const gate = { eligible: true, reasons: [] };
  const ok = (providerId: string, cents: number) => ({ ok: true as const, value: { providerId, providerQuoteRef: null, providerCostCents: cents, expiresAt: '2099-01-01T00:00:00Z', window: WINDOW_OUT } });
  const candidates = (courierCents: number, ownCents: number): EvaluatedCandidate[] => [
    { provider: { providerId: 'manual', kind: 'own_fleet', capabilities: ALL_CAPS }, gate, serviceability: { ok: true, value: { serviceable: true, reason: null } }, quote: ok('manual', ownCents) },
    { provider: { providerId: 'uber_direct', kind: 'courier', capabilities: ALL_CAPS }, gate, serviceability: { ok: true, value: { serviceable: true, reason: null } }, quote: ok('uber_direct', courierCents) },
  ];

  it('Uber at R60.38 + R20 beats our own vehicle at R150', () => {
    expect(selectDeliveryProviders(candidates(6_038, 15_000)).options.map((o) => o.providerId)).toEqual(['uber_direct', 'manual']);
  });

  it('the fee counts: Uber at R140 + R20 loses to our own vehicle at R150', () => {
    expect(selectDeliveryProviders(candidates(14_000, 15_000)).options.map((o) => o.providerId)).toEqual(['manual', 'uber_direct']);
  });

  it('in the full quote, the cheapest leg is the one the checkout uses (quotes[0])', async () => {
    const cheap = courierWorld(6_038);
    const a = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, cheap.deps);
    if (!a.ok) throw new Error(a.code);
    expect(a.quotes[0]).toMatchObject({ providerId: 'fake_courier', providerCostCents: 6_038, platformFeeCents: 2_000, customerFeeCents: 8_038 });

    const dear = courierWorld(60_000);
    const b = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, dear.deps);
    if (!b.ok) throw new Error(b.code);
    expect(b.quotes[0]).toMatchObject({ providerId: 'manual', platformFeeCents: 0 });
  });

  it('a courier that refuses the trip (e.g. Uber "address_undeliverable") falls back quietly to our own vehicle', async () => {
    const w = courierWorld(6_038);
    w.courier.quote = async () => ({ ok: false, kind: 'rejected', message: 'HTTP 400: The specified location is not in a deliverable area.' });
    const r = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
    if (!r.ok) throw new Error(r.code);
    expect(r.quotes.map((q) => q.providerId)).toEqual(['manual']);
    expect(r.excluded).toEqual([{ providerId: 'fake_courier', reasons: ['quote_refused'] }]);
  });
});

describe('both trips quoted up front', () => {
  it('delivery and collection are two stored quotes, and the checkout charges their sum once', async () => {
    const w = courierWorld(6_038);
    const r = await quoteCartDelivery(
      { caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: LINES_FOR_QUOTE, legs: [{ leg: 'outbound', window: WINDOW_OUT }, { leg: 'return', window: WINDOW_BACK }] },
      w.deps,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.quotes.map((q) => q.leg)).toEqual(['outbound', 'return']);
    expect(r.quotes.every((q) => q.customerFeeCents === 8_038)).toBe(true);
    const total = r.quotes.reduce((s, q) => s + q.customerFeeCents, 0);
    expect(total).toBe(16_076);
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: r.quotes.map((q) => q.id), browserAmountCents: total }, w.deps)).toEqual({ ok: true, amountCents: 16_076 });
    // The same leg twice is refused, so nothing can be charged double.
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [r.quotes[0].id, r.quotes[0].id] }, w.deps)).toMatchObject({ ok: false, code: 'duplicate_leg' });
  });

  it('says "Delivery and collection" when both trips are on the order', () => {
    expect(deliveryTotalLabel([{ leg: 'outbound' }, { leg: 'return' }])).toBe('Delivery and collection');
    expect(deliveryTotalLabel([{ leg: 'outbound' }, { leg: 'outbound' }])).toBe('Delivery total');
  });
});

describe("Uber Direct's 10 km radius", () => {
  it('Braamfontein to Rosebank is inside; Braamfontein to Pretoria is not', () => {
    expect(withinUberRadius(BRAAMFONTEIN, ROSEBANK)).toBe(true);
    expect(withinUberRadius(BRAAMFONTEIN, PRETORIA)).toBe(false);
  });

  it('a trip outside the radius is not serviceable and Uber is never called', async () => {
    resetUberDirectTokenCache();
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return new Response('{}', { status: 500 });
    };
    const port = createUberDirectAdapter({ mode: 'sandbox', clientId: 'c', clientSecret: 's', customerId: 'cust', fetchImpl, now: () => NOW, breaker: new CircuitBreaker('radius', { failureThreshold: 100, cooldownMs: 1 }) });
    const point = (p: { lat: number; lng: number }) => ({ ...p, suburb: 'x', city: 'x', postalCode: '0000', province: 'Gauteng' });
    const far = await port.checkServiceability({ from: point(BRAAMFONTEIN), to: point(PRETORIA), window: WINDOW_OUT, items: [] });
    expect(far).toEqual({ ok: true, value: { serviceable: false, reason: 'outside_provider_radius' } });
    const near = await port.checkServiceability({ from: point(BRAAMFONTEIN), to: point(ROSEBANK), window: WINDOW_OUT, items: [] });
    expect(near).toEqual({ ok: true, value: { serviceable: true, reason: null } });
    expect(calls).toHaveLength(0);
  });
});

describe('the courier trial is for test deployments only', () => {
  const sandboxUber = { providerId: 'uber_direct', kind: 'courier' as const, mode: 'sandbox' as const };
  const liveUber = { ...sandboxUber, mode: 'production' as const };
  const reg = (ports: { providerId: string; kind: 'courier'; mode: 'sandbox' | 'production' }[], allowSandbox = true) => ({
    list: () => ports as never,
    allowSandbox,
  });
  const ON = { DELIVERY_SANDBOX_TRIAL: 'true', VERCEL_ENV: 'preview' };

  it('is never on for the production deployment, whatever else is set', () => {
    expect(sandboxCourierTrial({ ...ON, VERCEL_ENV: 'production' }, reg([sandboxUber]))).toBeNull();
  });

  it('needs its switch, sandbox providers allowed, and a courier on test keys', () => {
    expect(sandboxCourierTrial({ VERCEL_ENV: 'preview' }, reg([sandboxUber]))).toBeNull();
    expect(sandboxCourierTrial(ON, reg([sandboxUber], false))).toBeNull();
    expect(sandboxCourierTrial(ON, reg([liveUber]))).toBeNull();
  });

  it('covers only couriers on test keys, says it is not insurance, and keeps the high-value rule', async () => {
    const t = sandboxCourierTrial(ON, reg([sandboxUber, { providerId: 'wumdrop', kind: 'courier', mode: 'production' }]));
    if (!t) throw new Error('expected a trial');
    expect(t.courierEnabled).toBe(true);
    expect(t.policy.automatedDeliveryMaxItemValueCents).toBeGreaterThan(0);
    expect(t.policy.requiredCourierCapabilities).toEqual(DEFAULT_DELIVERY_POLICY.requiredCourierCapabilities);
    expect(await t.insurance.coverFor({ providerId: 'uber_direct', items: [], leg: 'outbound' })).toMatchObject({ covered: true, policyRef: SANDBOX_TRIAL_POLICY_REF });
    expect(await t.insurance.coverFor({ providerId: 'wumdrop', items: [], leg: 'outbound' })).toMatchObject({ covered: false });
  });
});
