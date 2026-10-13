/**
 * Phase 4 delivery: eligibility, provider gate, selection, quote pricing and
 * the shipment state machine (spec §4.2, §4.6–4.9). Pure core.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_POLICY, RENTAL_POLICY } from '@/lib/constants';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import { DEFAULT_DELIVERY_POLICY, evaluateDeliveryEligibility, inServiceArea, providerRiskGate } from '@/lib/core/delivery/policy';
import { checkQuotesForCharge, orderMoneyWithDelivery, priceDeliveryQuote, requoteNeedsApproval, type CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import { selectDeliveryProviders, type EvaluatedCandidate } from '@/lib/core/delivery/select';
import { applyProviderState, checkDeliveryTransition, DELIVERY_STATES } from '@/lib/core/delivery/state';
import { quoteDelivery as quoteDeliveryUseCase } from '@/lib/core/delivery/use-cases';
import { OWN_FLEET_CAPABILITIES } from '@/lib/delivery/manual';
import { ALL_CAPS, LINES_FOR_QUOTE, OFFICE, OUT_OF_AREA, RENTER, RENTER_HOME, cleanRenter, world } from './helpers/delivery-fakes';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const COURIER_POLICY = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
const line = (value: number) => ({ unitReplacementValueCents: value, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22' });
const gauteng = { province: 'Gauteng' };
const base = { currentExposureCents: 0, destination: gauteng, courierFlagEnabled: true, ownFleetEnabled: true, now: NOW, policy: COURIER_POLICY };
const parcel = (value: number) => ({ rentalId: 'r', bookingId: 'b', driverLabel: 'camera equipment', replacementValueCents: value, weightGrams: null, containsLithium: false });

describe('delivery eligibility (spec §4.2)', () => {
  it('D01 - an ineligible first-time renter cannot select delivery', () => {
    const r = evaluateDeliveryEligibility({ ...base, facts: { ...cleanRenter, cleanReturns: 0, firstCleanReturnAt: null }, lines: [line(100_000)] });
    expect(r).toMatchObject({ ok: false, code: 'first_hire', collectionOnly: true });
  });

  it('D02 - an item above R50k cannot use automated delivery (or any delivery)', () => {
    const over = RENTAL_POLICY.highValueCollectionThresholdCents + 1;
    const r = evaluateDeliveryEligibility({ ...base, facts: { ...cleanRenter, cleanReturns: 6, cleanReturnValueCents: 9_000_000, firstCleanReturnAt: '2025-01-01T00:00:00Z' }, lines: [line(over)] });
    expect(r).toMatchObject({ ok: false, code: 'high_value_item' });
    // Even below the R50k rule, a courier is offered only up to the founder-approved threshold.
    const mid = evaluateDeliveryEligibility({ ...base, facts: cleanRenter, lines: [line(COURIER_POLICY.automatedDeliveryMaxItemValueCents + 1)] });
    expect(mid.ok && mid.modes).toEqual(['own_fleet']);
    expect(mid.ok && mid.courierBlockedBy).toContain('value_threshold');
  });

  it('D02 - the shipped courier limit is the Sony A7 III (R35,000, set 2026-10-13): at the limit a courier is offered, above it own vehicle only', () => {
    expect(DELIVERY_POLICY.automatedDeliveryMaxItemValueCents).toBe(3_500_000);
    const trusted = { ...cleanRenter, cleanReturns: 6, cleanReturnValueCents: 9_000_000, firstCleanReturnAt: '2025-01-01T00:00:00Z' };
    const a7iii = evaluateDeliveryEligibility({ ...base, policy: DEFAULT_DELIVERY_POLICY, facts: trusted, lines: [line(3_500_000)] });
    expect(a7iii.ok && a7iii.modes).toContain('courier');
    const above = evaluateDeliveryEligibility({ ...base, policy: DEFAULT_DELIVERY_POLICY, facts: trusted, lines: [line(3_500_001)] });
    expect(above.ok && above.modes).toEqual(['own_fleet']);
    expect(above.ok && above.courierBlockedBy).toContain('value_threshold');
    // A 0 limit still switches couriers off for every item.
    const off = evaluateDeliveryEligibility({ ...base, policy: { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 0 }, facts: cleanRenter, lines: [line(1)] });
    expect(off.ok && off.modes).toEqual(['own_fleet']);
  });

  it('D03 - trust-tier limits are enforced through the rental rules (not re-implemented)', () => {
    // cleanRenter is Proven: already holding the whole Proven limit, one more item is over it.
    const over = evaluateDeliveryEligibility({ ...base, facts: cleanRenter, lines: [line(1000)], currentExposureCents: RENTAL_POLICY.trustTierLimitsCents.proven });
    expect(over).toMatchObject({ ok: false, code: 'trust_limit' });
    const unverified = evaluateDeliveryEligibility({ ...base, facts: { ...cleanRenter, phoneVerified: false }, lines: [line(1000)] });
    expect(unverified).toMatchObject({ ok: false, code: 'not_eligible' });
    const held = evaluateDeliveryEligibility({ ...base, facts: { ...cleanRenter, suspended: true }, lines: [line(1000)] });
    expect(held).toMatchObject({ ok: false, code: 'account_hold' });
  });

  it('D05 - an address outside the service area gets no delivery (collection, or travel by quote)', () => {
    const r = evaluateDeliveryEligibility({ ...base, facts: cleanRenter, lines: [line(1000)], destination: { province: 'KwaZulu-Natal' } });
    expect(r).toMatchObject({ ok: false, code: 'out_of_area', collectionOnly: true });
    expect(inServiceArea({ province: null })).toBe(false);
    expect(inServiceArea({ province: ' gauteng ' })).toBe(true);
  });

  it('D05 - the quote use case refuses an out-of-area address and offers collection', async () => {
    const w = world({ courierEnabled: true });
    const r = await quoteDeliveryUseCase({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: null, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: OUT_OF_AREA, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w.deps);
    expect(r).toMatchObject({ ok: false, code: 'out_of_area', collectionOnly: true });
    expect(w.repo.quotes.size).toBe(0);
  });
});

describe('provider risk gate (spec §4.6, §4.13)', () => {
  const window = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
  const courier = { providerId: 'c', kind: 'courier' as const, capabilities: ALL_CAPS };
  const covered = { covered: true, policyRef: 'POL-1', maxItemValueCents: 2_000_000, reason: null };

  it('D04 - a provider without verified cover is excluded, whatever its price', () => {
    const g = providerRiskGate({ provider: courier, leg: 'outbound', items: [parcel(100_000)], window, insurance: { covered: false, policyRef: null, maxItemValueCents: 0, reason: 'none' }, allowSandbox: false, policy: COURIER_POLICY });
    expect(g.eligible).toBe(false);
    expect(g.reasons).toContain('not_covered');
    const over = providerRiskGate({ provider: courier, leg: 'outbound', items: [parcel(1_900_000)], window, insurance: { ...covered, maxItemValueCents: 1_000_000 }, allowSandbox: false, policy: COURIER_POLICY });
    expect(over.reasons).toContain('item_value_above_cover');
    const fine = providerRiskGate({ provider: courier, leg: 'outbound', items: [parcel(100_000)], window, insurance: covered, allowSandbox: false, policy: COURIER_POLICY });
    expect(fine).toEqual({ eligible: true, reasons: [] });
  });

  it('D27 - unsupported provider capabilities fail safely (excluded with the missing capability named)', () => {
    for (const need of DELIVERY_POLICY.requiredCourierCapabilities) {
      const g = providerRiskGate({ provider: { ...courier, capabilities: { ...ALL_CAPS, [need]: false } }, leg: 'outbound', items: [parcel(1)], window, insurance: covered, allowSandbox: false, policy: COURIER_POLICY });
      expect(g.eligible).toBe(false);
      expect(g.reasons).toContain(`missing_capability:${need}`);
    }
    const noReturns = providerRiskGate({ provider: { ...courier, capabilities: { ...ALL_CAPS, reverseLogistics: false } }, leg: 'return', items: [parcel(1)], window, insurance: covered, allowSandbox: false, policy: COURIER_POLICY });
    expect(noReturns.reasons).toContain('missing_capability:reverseLogistics');
    const none = providerRiskGate({ provider: { ...courier, capabilities: NO_DELIVERY_CAPABILITIES }, leg: 'outbound', items: [parcel(1)], window, insurance: covered, allowSandbox: false, policy: COURIER_POLICY });
    expect(none.eligible).toBe(false);
    const sandbox = providerRiskGate({ provider: { ...courier, mode: 'sandbox' }, leg: 'outbound', items: [parcel(1)], window, insurance: covered, allowSandbox: false, policy: COURIER_POLICY });
    expect(sandbox.reasons).toContain('sandbox_provider');
    // Own fleet: no on-demand (needs a free person), but scheduled and returns are fine without courier cover.
    const own = { providerId: 'manual', kind: 'own_fleet' as const, capabilities: OWN_FLEET_CAPABILITIES };
    expect(providerRiskGate({ provider: own, leg: 'return', items: [parcel(4_000_000)], window, insurance: null, allowSandbox: false }).eligible).toBe(true);
    expect(providerRiskGate({ provider: own, leg: 'outbound', items: [parcel(1)], window: { start: null, end: null }, insurance: null, allowSandbox: false }).reasons).toContain('missing_capability:onDemand');
  });
});

describe('provider selection (spec §4.6)', () => {
  const window = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
  const q = (id: string, cents: number, start = window.start) => ({ ok: true as const, value: { providerId: id, providerQuoteRef: null, providerCostCents: cents, expiresAt: '2099-01-01T00:00:00Z', window: { ...window, start } } });
  const yes = { ok: true as const, value: { serviceable: true, reason: null } };
  const cand = (id: string, over: Partial<EvaluatedCandidate> = {}): EvaluatedCandidate => ({ provider: { providerId: id, capabilities: ALL_CAPS }, gate: { eligible: true, reasons: [] }, serviceability: yes, quote: q(id, 10_000), ...over });

  it('ranks by the configured preferences: reliability, then speed, then price', () => {
    const prefs = { rankBy: ['reliability', 'speed', 'price'] as const, reliability: { a: 50, b: 90, c: 90 } };
    const r = selectDeliveryProviders([cand('a', { quote: q('a', 1) }), cand('b', { quote: q('b', 30_000) }), cand('c', { quote: q('c', 20_000) })], prefs);
    expect(r.options.map((o) => o.providerId)).toEqual(['c', 'b', 'a']);
    const byPrice = selectDeliveryProviders([cand('a', { quote: q('a', 1) }), cand('b', { quote: q('b', 30_000) })], { rankBy: ['price'], reliability: {} });
    expect(byPrice.options[0].providerId).toBe('a');
  });

  it('a cheaper provider that fails the risk gate is never offered (D04)', () => {
    const r = selectDeliveryProviders([cand('cheap', { gate: { eligible: false, reasons: ['not_covered'] }, quote: q('cheap', 1) }), cand('safe', { quote: q('safe', 50_000) })]);
    expect(r.options.map((o) => o.providerId)).toEqual(['safe']);
    expect(r.excluded).toEqual([{ providerId: 'cheap', reasons: ['not_covered'] }]);
  });

  it('D20 - a provider outage triggers a safe fallback to the next eligible provider, then collection', () => {
    const down = { ok: false as const, kind: 'unknown' as const, message: 'timeout' };
    const r = selectDeliveryProviders([cand('primary', { serviceability: down, quote: null }), cand('backup')]);
    expect(r.options.map((o) => o.providerId)).toEqual(['backup']);
    expect(r.excluded[0]).toEqual({ providerId: 'primary', reasons: ['serviceability_unavailable'] });
    const none = selectDeliveryProviders([cand('primary', { quote: { ok: false, kind: 'unknown', message: 'x' } })]);
    expect(none).toMatchObject({ options: [], collectionOnly: true });
  });

  it('D20 - through the use case: the courier is down, our own fleet is still quoted', async () => {
    const w = world({ courierEnabled: true, cover: { fake_courier: 2_000_000 } });
    w.deps.policy = COURIER_POLICY;
    w.courier.down = true;
    const r = await quoteDeliveryUseCase({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: null, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quotes.map((x) => x.providerId)).toEqual(['manual']);
    expect(r.excluded).toEqual([{ providerId: 'fake_courier', reasons: ['serviceability_unavailable'] }]);
  });
});

describe('quote pricing (spec §4.7)', () => {
  const pq = { providerId: 'c', providerQuoteRef: 'Q1', providerCostCents: 11_850, expiresAt: '2026-10-10T08:20:00.000Z', window: { start: null, end: null } };

  it('D06 - a valid provider quote is calculated correctly in cents, provider cost and customer fee apart', () => {
    const p = priceDeliveryQuote({ providerQuote: pq, providerKind: 'courier', now: NOW, platformFeeCents: 2_500, ttlMinutes: 30 });
    expect(p).toEqual({ quoteAmountCents: 11_850, providerCostCents: 11_850, platformFeeCents: 2_500, customerFeeCents: 14_350, expiresAt: '2026-10-10T08:20:00.000Z' });
    // Our TTL wins when shorter than the provider's.
    expect(priceDeliveryQuote({ providerQuote: { ...pq, expiresAt: '2099-01-01T00:00:00Z' }, providerKind: 'courier', now: NOW, platformFeeCents: 0, ttlMinutes: 30 }).expiresAt).toBe('2026-10-10T08:30:00.000Z');
    // Own fleet: the own-vehicle formula already is the customer price.
    expect(priceDeliveryQuote({ providerQuote: pq, providerKind: 'own_fleet', now: NOW, platformFeeCents: 2_500 }).customerFeeCents).toBe(11_850);
    expect(() => priceDeliveryQuote({ providerQuote: { ...pq, providerCostCents: 10.5 }, providerKind: 'courier', now: NOW })).toThrow();
  });

  it('D06 - the delivery fee is never part of the owner 80% share', () => {
    const m = orderMoneyWithDelivery({ netHireCents: 150_000, ownership: 'community', deliveryQuotes: [{ customerFeeCents: 12_000, providerCostCents: 10_000, platformFeeCents: 2_000 }, { customerFeeCents: 12_000, providerCostCents: 10_000, platformFeeCents: 2_000 }] });
    expect(m.ownerShareCents).toBe(120_000);
    expect(m.platformShareCents).toBe(30_000);
    expect(m.deliveryCustomerCents).toBe(24_000);
  });

  it('D07 - an expired quote cannot silently be charged; a requote with a new price needs approval', () => {
    const q: CustomerDeliveryQuote = { id: 'q', renterId: RENTER, bookingGroupId: null, leg: 'outbound', providerId: 'c', providerKind: 'courier', providerQuoteRef: null, quoteAmountCents: 10_000, providerCostCents: 10_000, platformFeeCents: 0, customerFeeCents: 10_000, replacementValueCents: 1, bookingIds: [], rentalIds: ['r'], originAddressId: OFFICE, destinationAddressId: RENTER_HOME, window: { start: null, end: null }, expiresAt: '2026-10-10T07:59:59.000Z', status: 'active', paidReference: null, createdAt: NOW.toISOString() };
    expect(checkQuotesForCharge({ quotes: [q], renterId: RENTER, now: NOW })).toMatchObject({ ok: false, code: 'quote_expired' });
    expect(checkQuotesForCharge({ quotes: [{ ...q, expiresAt: '2026-10-10T08:00:01.000Z' }], renterId: RENTER, now: NOW })).toEqual({ ok: true, amountCents: 10_000 });
    expect(requoteNeedsApproval(10_000, { customerFeeCents: 10_500 })).toBe(true);
    expect(requoteNeedsApproval(10_000, { customerFeeCents: 10_000 })).toBe(false);
  });
});

describe('shipment state machine (spec §4.9)', () => {
  it('every state is reachable only through listed moves', () => {
    expect(checkDeliveryTransition('requested', 'delivered', 'provider')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(checkDeliveryTransition('prepared', 'booking', 'provider')).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(checkDeliveryTransition('incident_under_review', 'delivered', 'staff')).toMatchObject({ ok: false, code: 'reason_required' });
    expect(checkDeliveryTransition('incident_under_review', 'delivered', 'staff', 'found at depot')).toEqual({ ok: true, alreadyDone: false });
    expect(checkDeliveryTransition('cancelled', 'scheduled', 'staff').ok).toBe(false);
    expect(checkDeliveryTransition('collected', 'cancelled', 'staff').ok).toBe(false);
    expect(checkDeliveryTransition('nonsense', 'scheduled', 'staff')).toMatchObject({ ok: false, code: 'unknown_state' });
    expect(DELIVERY_STATES).toHaveLength(18);
  });

  it('D13 - an out-of-order provider update can never regress a later confirmed state', () => {
    expect(applyProviderState({ current: 'delivered', incoming: 'in_transit', incomingAt: '2026-10-20T09:00:00Z', lastAppliedAt: '2026-10-20T08:00:00Z' })).toEqual({ apply: false, reason: 'stale' });
    expect(applyProviderState({ current: 'collected', incoming: 'courier_assigned', incomingAt: null, lastAppliedAt: null })).toEqual({ apply: false, reason: 'stale' });
    expect(applyProviderState({ current: 'lost', incoming: 'delivered', incomingAt: '2026-10-21T00:00:00Z', lastAppliedAt: null }).apply).toBe(false);
    expect(applyProviderState({ current: 'courier_assigned', incoming: 'delivered', incomingAt: null, lastAppliedAt: null })).toEqual({ apply: true, to: 'delivered' });
    // A second attempt after a failed one is accepted only when it is newer.
    expect(applyProviderState({ current: 'delivery_attempt_failed', incoming: 'courier_at_dropoff', incomingAt: '2026-10-20T10:00:00Z', lastAppliedAt: '2026-10-20T09:00:00Z' })).toEqual({ apply: true, to: 'courier_at_dropoff' });
    expect(applyProviderState({ current: 'delivery_attempt_failed', incoming: 'courier_at_dropoff', incomingAt: '2026-10-20T08:30:00Z', lastAppliedAt: '2026-10-20T09:00:00Z' })).toEqual({ apply: false, reason: 'stale' });
    expect(applyProviderState({ current: 'scheduled', incoming: 'unknown', incomingAt: null, lastAppliedAt: null })).toEqual({ apply: false, reason: 'unknown_provider_state' });
  });
});
