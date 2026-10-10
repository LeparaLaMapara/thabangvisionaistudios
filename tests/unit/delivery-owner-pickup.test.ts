/**
 * Phase 8: collecting gear from the owner's address.
 *
 *  - the core origin rules (who is collected from home, and the per-leg key
 *    discriminators that leave every studio key as it was);
 *  - a mixed order (studio + two owners) gets one outbound and one return
 *    leg per origin, each priced from its own verified point;
 *  - checkout charges exactly those quotes and re-quotes when an origin
 *    changed; after payment each leg is prepared and dispatched once
 *    (replays change nothing); the owner is told when, never who rents;
 *  - custody at the owner's door (owner hands over with a photo; our driver
 *    collects; on return the owner confirms receipt AND condition, or reports
 *    a problem, which opens an incident and holds only that line);
 *  - the ledger: one earn journal per order, leg, origin and attempt, every
 *    journal balanced, income = fees earned;
 *  - privacy: owners see only their own items and never the renter's
 *    address or tracking link; renters see the owner's suburb at most.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { groupLinesByOrigin, originDiscriminator, originReferenceSuffix, ownerPickupDecision, publicOriginArea, type OwnerPickupFacts } from '@/lib/core/delivery/origin';
import { checkCustodyEvent, type CustodyEvent } from '@/lib/core/delivery/custody';
import { deliveryEarned, isBalanced } from '@/lib/core/rental/ledger';
import {
  advanceManualDelivery,
  checkRentalSettlement,
  confirmCollection,
  confirmHandover,
  confirmOwnerReturn,
  dispatchIdempotencyKey,
  getDeliveryStatus,
  merchantReferenceFor,
  prepareDelivery,
  priceDeliveryForCheckout,
  quoteDelivery,
} from '@/lib/core/delivery/use-cases';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { RENTAL_POLICY } from '@/lib/constants';
import { deliveryOriginPlan, priceCheckoutDelivery, quoteCartDelivery } from '@/lib/delivery/checkout';
import { dispatchDeliveryAfterPayment } from '@/lib/delivery/after-payment';
import { customerLegs } from '@/lib/delivery/customer-view';
import { ownerLegs } from '@/lib/delivery/owner-view';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { Shipment } from '@/lib/core/delivery/repository';
import { GROUP, OFFICE, OWNER_A, OWNER_B, RENTER, RENTER_HOME, STAFF } from './helpers/delivery-fakes';
import { BACK_WINDOW, LENS_A, LIGHT_B, MIXED_LINES, OUT_WINDOW, PICK_A, PICK_B, STUDIO_CAM, originWorld, type OriginWorld } from './helpers/delivery-origin-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const ownerA = { kind: 'owner' as const, userId: OWNER_A };
const ownerB = { kind: 'owner' as const, userId: OWNER_B };
const PHOTO = [{ kind: 'photo' as const, ref: 'https://res.cloudinary.com/x/image/upload/v1/evidence.jpg' }];

const feeFrom = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, items = 1): number => {
  const q = quoteOwnVehicleCents({ origin: { name: 'origin', coords: from }, destination: to, itemCount: items });
  if (!('feeCents' in q)) throw new Error('no fee');
  return q.feeCents;
};

async function quoteAll(w: OriginWorld, legs: ('outbound' | 'return')[] = ['outbound', 'return']): Promise<CustomerDeliveryQuote[]> {
  const r = await quoteCartDelivery(
    {
      caller: renter,
      renterId: RENTER,
      renterAddressId: RENTER_HOME,
      siteAddressId: OFFICE,
      lines: MIXED_LINES,
      legs: legs.map((leg) => ({ leg, window: leg === 'outbound' ? OUT_WINDOW : BACK_WINDOW })),
      bookingGroupId: GROUP,
    },
    w.deps,
  );
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.quotes;
}

/** Quote, pay and dispatch the whole mixed order (both legs, every origin). */
async function paidAndDispatched(w: OriginWorld): Promise<{ quotes: CustomerDeliveryQuote[]; total: number }> {
  const quotes = await quoteAll(w);
  const total = quotes.reduce((n, q) => n + q.customerFeeCents, 0);
  const r = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: total }, { delivery: w.deps, links: w.links });
  expect(r.outcome).toBe('done');
  return { quotes, total };
}

const shipmentsOf = (w: OriginWorld): Shipment[] => [...w.repo.shipments.values()];
const legOf = (w: OriginWorld, leg: 'outbound' | 'return', origin: string | null): Shipment => {
  const s = shipmentsOf(w).find((x) => x.leg === leg && (x.originOwnerId ?? null) === origin);
  if (!s) throw new Error(`no ${leg} leg for ${origin ?? 'studio'}`);
  return s;
};

// ── Core rules ───────────────────────────────────────────────────────────────

describe('owner pickup: who is collected from home (core)', () => {
  const ok: OwnerPickupFacts = { community: true, ownerId: OWNER_A, listingLive: true, listingOptIn: true, ownerVerified: true, ownerSuspended: false, address: { id: PICK_A, province: 'Gauteng' } };
  const policy = { enabled: true, serviceProvince: 'Gauteng' };

  it('only an opted-in, live community listing of a verified, active owner with a pickup address in the area', () => {
    expect(ownerPickupDecision(ok, policy)).toEqual({ ok: true, ownerId: OWNER_A, addressId: PICK_A });
    expect(ownerPickupDecision({ ...ok, listingOptIn: false }, policy)).toEqual({ ok: false, reason: 'listing_not_opted_in' });
    expect(ownerPickupDecision({ ...ok, community: false }, policy)).toEqual({ ok: false, reason: 'not_community' });
    expect(ownerPickupDecision({ ...ok, listingLive: false }, policy)).toEqual({ ok: false, reason: 'listing_not_live' });
    expect(ownerPickupDecision({ ...ok, ownerVerified: false }, policy)).toEqual({ ok: false, reason: 'owner_not_verified' });
    expect(ownerPickupDecision({ ...ok, ownerSuspended: true }, policy)).toEqual({ ok: false, reason: 'owner_suspended' });
    expect(ownerPickupDecision({ ...ok, address: null }, policy)).toEqual({ ok: false, reason: 'no_pickup_address' });
    expect(ownerPickupDecision({ ...ok, address: { id: PICK_A, province: 'KwaZulu-Natal' } }, policy)).toEqual({ ok: false, reason: 'address_outside_area' });
    expect(ownerPickupDecision(ok, { ...policy, enabled: false })).toEqual({ ok: false, reason: 'switched_off' });
  });

  it('groups lines by origin, studio first, deterministically; undecided lines go from the studio', () => {
    const origins = new Map([
      [LIGHT_B, { originOwnerId: OWNER_B, addressId: PICK_B }],
      [LENS_A, { originOwnerId: OWNER_A, addressId: PICK_A }],
    ]);
    const g = groupLinesByOrigin([...MIXED_LINES].reverse(), origins, OFFICE);
    expect(g.map((x) => [x.originOwnerId, x.addressId, x.lines.map((l) => l.rentalId)])).toEqual([
      [null, OFFICE, [STUDIO_CAM]],
      [OWNER_A, PICK_A, [LENS_A]],
      [OWNER_B, PICK_B, [LIGHT_B]],
    ]);
  });

  it('the renter is shown the suburb at most, never the street', () => {
    expect(publicOriginArea({ suburb: 'Melville', city: 'Johannesburg' })).toBe('Melville');
    expect(publicOriginArea({ suburb: null, city: 'Pretoria' })).toBe('Pretoria');
    expect(publicOriginArea(null)).toBeNull();
  });
});

describe('per-leg keys: an origin discriminator that leaves studio keys unchanged', () => {
  it('ledger earn keys', () => {
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'outbound' }).idempotencyKey).toBe('delivery:g:outbound');
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'outbound', originOwnerId: null }).idempotencyKey).toBe('delivery:g:outbound');
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'return', attempt: 2 }).idempotencyKey).toBe('delivery:g:return:a2');
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'outbound', originOwnerId: OWNER_A }).idempotencyKey).toBe(`delivery:g:outbound@${OWNER_A}`);
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, leg: 'return', attempt: 2, originOwnerId: OWNER_B }).idempotencyKey).toBe(`delivery:g:return@${OWNER_B}:a2`);
    // The legacy order-level key is untouched.
    expect(deliveryEarned({ bookingGroupId: 'g', deliveryCents: 100, originOwnerId: OWNER_A }).idempotencyKey).toBe('delivery:g');
  });

  it('merchant references and dispatch keys', () => {
    expect(merchantReferenceFor(GROUP, 'outbound', 1)).toBe(`tvd_${GROUP.replace(/-/g, '')}_o1`);
    expect(merchantReferenceFor(GROUP, 'return', 2, null)).toBe(`tvd_${GROUP.replace(/-/g, '')}_r2`);
    expect(merchantReferenceFor(GROUP, 'outbound', 1, OWNER_A)).toBe(`tvd_${GROUP.replace(/-/g, '')}_o1_${OWNER_A.replace(/-/g, '')}`);
    expect(merchantReferenceFor(GROUP, 'outbound', 1, OWNER_A)).not.toBe(merchantReferenceFor(GROUP, 'outbound', 1, OWNER_B));
    expect(dispatchIdempotencyKey(GROUP, 'outbound', 1)).toBe(`delivery-dispatch:${GROUP}:outbound:1`);
    expect(dispatchIdempotencyKey(GROUP, 'outbound', 1, OWNER_A)).toBe(`delivery-dispatch:${GROUP}:outbound@${OWNER_A}:1`);
    expect(originDiscriminator(null)).toBe('');
    expect(originReferenceSuffix(undefined)).toBe('');
  });
});

// ── Quotes ───────────────────────────────────────────────────────────────────

describe('a mixed order: one leg per origin, each priced from where the gear is', () => {
  let w: OriginWorld;
  beforeEach(() => {
    w = originWorld();
  });

  it('three outbound and three return quotes, each for its own lines and its own verified points', async () => {
    const quotes = await quoteAll(w);
    expect(quotes.map((q) => [q.leg, q.originOwnerId ?? null, q.rentalIds])).toEqual([
      ['outbound', null, [STUDIO_CAM]],
      ['outbound', OWNER_A, [LENS_A]],
      ['outbound', OWNER_B, [LIGHT_B]],
      ['return', null, [STUDIO_CAM]],
      ['return', OWNER_A, [LENS_A]],
      ['return', OWNER_B, [LIGHT_B]],
    ]);
    const home = w.addresses.points.get(RENTER_HOME)!;
    const a = w.addresses.points.get(PICK_A)!;
    const b = w.addresses.points.get(PICK_B)!;
    const office = w.addresses.points.get(OFFICE)!;
    const byOrigin = (leg: string, o: string | null) => quotes.find((q) => q.leg === leg && (q.originOwnerId ?? null) === o)!;
    // The own-vehicle formula, from each origin's verified point (no hardcoded price).
    expect(byOrigin('outbound', null).customerFeeCents).toBe(feeFrom(office, home));
    expect(byOrigin('outbound', OWNER_A).customerFeeCents).toBe(feeFrom(a, home));
    expect(byOrigin('outbound', OWNER_B).customerFeeCents).toBe(feeFrom(b, home));
    expect(byOrigin('return', OWNER_B).customerFeeCents).toBe(feeFrom(home, b));
    // Owner B is far away: their trip costs more than owner A's, which proves the origin is used.
    expect(byOrigin('outbound', OWNER_B).customerFeeCents).toBeGreaterThan(byOrigin('outbound', OWNER_A).customerFeeCents);
    // Addresses: outbound from the origin to the renter; return from the renter back to the origin.
    expect([byOrigin('outbound', OWNER_A).originAddressId, byOrigin('outbound', OWNER_A).destinationAddressId]).toEqual([PICK_A, RENTER_HOME]);
    expect([byOrigin('return', OWNER_A).originAddressId, byOrigin('return', OWNER_A).destinationAddressId]).toEqual([RENTER_HOME, PICK_A]);
    expect([byOrigin('outbound', null).originAddressId, byOrigin('return', null).destinationAddressId]).toEqual([OFFICE, OFFICE]);
  });

  it('an owner who is not opted in, not verified or suspended: their gear goes from the studio (one studio leg)', async () => {
    w.origins.set(LENS_A, { listingOptIn: false });
    w.origins.set(LIGHT_B, { ownerSuspended: true });
    const plan = await deliveryOriginPlan(MIXED_LINES, OFFICE, w.deps);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ originOwnerId: null, addressId: OFFICE });
    expect(plan[0].lines.map((l) => l.rentalId)).toEqual([STUDIO_CAM, LENS_A, LIGHT_B]);
  });

  it('without an origin port every leg runs from the studio, exactly as before Phase 8', async () => {
    delete w.deps.origins;
    const quotes = await quoteAll(w, ['outbound']);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ originOwnerId: null, originAddressId: OFFICE, rentalIds: [STUDIO_CAM, LENS_A, LIGHT_B] });
  });

  it('refuses a leg from an owner when the address is not that owner\'s active one, or a line is not theirs', async () => {
    const base = { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound' as const, destinationAddressId: RENTER_HOME, window: OUT_WINDOW };
    // Owner B's address for owner A's gear.
    expect(await quoteDelivery({ ...base, originAddressId: PICK_B, originOwnerId: OWNER_A, lines: [MIXED_LINES[1]] }, w.deps)).toMatchObject({ ok: false, code: 'origin_unavailable' });
    // Owner B's light on owner A's leg.
    expect(await quoteDelivery({ ...base, originAddressId: PICK_A, originOwnerId: OWNER_A, lines: [MIXED_LINES[1], MIXED_LINES[2]] }, w.deps)).toMatchObject({ ok: false, code: 'origin_unavailable' });
    // No origin port: fail closed.
    delete w.deps.origins;
    expect(await quoteDelivery({ ...base, originAddressId: PICK_A, originOwnerId: OWNER_A, lines: [MIXED_LINES[1]] }, w.deps)).toMatchObject({ ok: false, code: 'origin_unavailable' });
  });

  it('the trust limit is checked on the whole order, never per origin (each leg alone would fit)', async () => {
    const big = MIXED_LINES.map((l) => ({ ...l, unitReplacementValueCents: 900_000 })); // R27 000 in all, R9 000 per origin
    const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: big, legs: [{ leg: 'outbound', window: OUT_WINDOW }] }, w.deps);
    expect(r).toMatchObject({ ok: false, collectionOnly: true, code: 'trust_limit' });
    expect(w.repo.quotes.size).toBe(0);
  });

  it('an item over the high-value threshold (or a first hire) makes the whole order collection in person at the studio, owner gear included', async () => {
    const facts = (await w.trust.getTrustInputs(RENTER)).facts;
    w.trust.facts.set(RENTER, { ...facts, cleanReturns: 40, cleanReturnValueCents: 100_000_000 });
    // Owner A's lens is over the threshold; the studio camera and owner B's light are not.
    const lines = MIXED_LINES.map((l) => (l.rentalId === LENS_A ? { ...l, unitReplacementValueCents: RENTAL_POLICY.highValueCollectionThresholdCents + 100 } : l));
    const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines, legs: [{ leg: 'outbound', window: OUT_WINDOW }] }, w.deps);
    expect(r).toMatchObject({ ok: false, collectionOnly: true, code: 'high_value_item' });
    expect(w.repo.quotes.size).toBe(0);
    // A first hire: the same (whatever the tier says first, delivery is refused for every origin).
    w.trust.facts.set(RENTER, { ...facts, cleanReturns: 0, cleanReturnValueCents: 0, firstCleanReturnAt: null });
    const first = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: MIXED_LINES, legs: [{ leg: 'outbound', window: OUT_WINDOW }] }, w.deps);
    expect(first).toMatchObject({ ok: false, collectionOnly: true });
    expect(w.repo.quotes.size).toBe(0);
  });
});

describe('checkout charges exactly the per-origin quotes', () => {
  let w: OriginWorld;
  beforeEach(() => {
    w = originWorld();
  });

  it('the stored quotes, at the total the renter saw; one quote per trip (leg and origin)', async () => {
    const quotes = await quoteAll(w);
    const total = quotes.reduce((n, q) => n + q.customerFeeCents, 0);
    const ids = quotes.map((q) => q.id);
    expect(await priceCheckoutDelivery({ renterId: RENTER, quoteIds: ids, approvedCents: total, lines: MIXED_LINES, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: true, amountCents: total, requoted: false });
    expect(await priceCheckoutDelivery({ renterId: RENTER, quoteIds: ids, approvedCents: total - 1, lines: MIXED_LINES, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'DELIVERY_PRICE_CHANGED' });
    // Two quotes for the same trip are refused by the core.
    const again = await quoteAll(w, ['outbound']);
    expect(await priceDeliveryForCheckout({ renterId: RENTER, quoteIds: [quotes[1].id, again[1].id] }, w.deps)).toMatchObject({ ok: false, code: 'duplicate_leg' });
  });

  it('a missing origin quote, or an owner who switched pickup off since, is re-quoted for the renter to approve', async () => {
    const quotes = await quoteAll(w, ['outbound']);
    const total = quotes.reduce((n, q) => n + q.customerFeeCents, 0);
    // Only the studio and owner A quotes sent: owner B's trip is missing.
    const partial = await priceCheckoutDelivery({ renterId: RENTER, quoteIds: [quotes[0].id, quotes[1].id], approvedCents: quotes[0].customerFeeCents + quotes[1].customerFeeCents, lines: MIXED_LINES, bookingGroupId: GROUP }, w.deps);
    expect(partial).toMatchObject({ ok: false, code: 'DELIVERY_REQUOTE' });
    if (partial.ok) throw new Error('unexpected');
    expect(partial.quotes?.map((q) => q.originOwnerId ?? null)).toEqual([null, OWNER_A, OWNER_B]);
    // Owner A switches pickup off: their lens now goes from the studio, in the studio's trip.
    w.origins.set(LENS_A, { listingOptIn: false });
    const fresh = await quoteAll(w, ['outbound']);
    const freshTotal = fresh.reduce((n, q) => n + q.customerFeeCents, 0);
    const r = await priceCheckoutDelivery({ renterId: RENTER, quoteIds: fresh.map((q) => q.id), approvedCents: freshTotal, lines: MIXED_LINES, bookingGroupId: GROUP }, w.deps);
    expect(r.ok === true && r.requoted === false).toBe(true); // quoted after the change: it matches
    const stale = await priceCheckoutDelivery({ renterId: RENTER, quoteIds: quotes.map((q) => q.id), approvedCents: total, lines: MIXED_LINES, bookingGroupId: GROUP }, w.deps);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('unexpected');
    expect(stale.code).toBe('DELIVERY_REQUOTE');
    expect(stale.quotes?.map((q) => [q.originOwnerId ?? null, q.rentalIds])).toEqual([
      [null, [STUDIO_CAM, LENS_A]],
      [OWNER_B, [LIGHT_B]],
    ]);
  });
});

// ── After payment: dispatch per leg and origin ───────────────────────────────

describe('after payment: every leg prepared and dispatched once', () => {
  let w: OriginWorld;
  beforeEach(() => {
    w = originWorld();
  });

  it('six legs, six distinct references and staff tasks; a replay books nothing new', async () => {
    const { total } = await paidAndDispatched(w);
    const ships = shipmentsOf(w);
    expect(ships).toHaveLength(6);
    expect(new Set(ships.map((s) => s.merchantReference)).size).toBe(6);
    expect(ships.every((s) => s.status === 'scheduled' && s.attempt === 1)).toBe(true);
    expect(w.tasks.tasks.size).toBe(6);
    const before = JSON.stringify([...w.repo.shipments.values()].map((s) => [s.id, s.status]));
    const replay = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: total }, { delivery: w.deps, links: w.links });
    expect(replay.outcome).toBe('done');
    expect(JSON.stringify([...w.repo.shipments.values()].map((s) => [s.id, s.status]))).toBe(before);
    expect(w.tasks.tasks.size).toBe(6);
  });

  it('the owner hears that a collection from (and a return to) their address is booked; nothing about the renter', async () => {
    await paidAndDispatched(w);
    const toA = [...w.repo.outbox.values()].filter((n) => n.userId === OWNER_A);
    expect(toA.filter((n) => n.kind === 'owner_pickup_scheduled' && n.channel === 'in_app').map((n) => n.data.leg).sort()).toEqual(['outbound', 'return']);
    expect(toA.every((n) => n.bookingIds.every((b) => b === 'bk-a'))).toBe(true);
    for (const n of toA) {
      expect(Object.keys(n.data).every((k) => k === 'leg')).toBe(true);
      expect(JSON.stringify(n)).not.toMatch(/Sandton|Test Road|Thandi|0000000001|Melville|Owner Lane/);
    }
    // The studio legs tell no owner anything new.
    expect([...w.repo.outbox.values()].some((n) => n.kind === 'owner_pickup_scheduled' && n.userId !== OWNER_A && n.userId !== OWNER_B)).toBe(false);
  });

  it('an owner who switched pickup off after payment: that leg is not prepared and its fee is refunded, the others go ahead', async () => {
    const quotes = await quoteAll(w);
    const total = quotes.reduce((n, q) => n + q.customerFeeCents, 0);
    w.origins.set(LIGHT_B, { listingOptIn: false });
    const r = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: total }, { delivery: w.deps, links: w.links });
    expect(r.outcome).toBe('done');
    expect(shipmentsOf(w).some((s) => s.originOwnerId === OWNER_B)).toBe(false);
    expect(shipmentsOf(w)).toHaveLength(4);
    const bQuotes = quotes.filter((q) => q.originOwnerId === OWNER_B);
    for (const q of bQuotes) expect(w.repo.quotes.get(q.id)?.status).toBe('refunded');
    const refunded = [...w.repo.refunds.values()].reduce((n, x) => n + x.amountCents, 0);
    expect(refunded).toBe(bQuotes.reduce((n, q) => n + q.customerFeeCents, 0));
    for (const j of w.repo.journals.values()) expect(isBalanced(j)).toBe(true);
  });

  it('prepare refuses an owner leg whose lines are not all that owner\'s', async () => {
    const quotes = await quoteAll(w, ['outbound']);
    const qa = quotes.find((q) => q.originOwnerId === OWNER_A)!;
    // Somebody else's light slipped into owner A's quote.
    w.repo.quotes.get(qa.id)!.rentalIds = [LENS_A, LIGHT_B];
    w.repo.quotes.get(qa.id)!.lines = [];
    expect(await prepareDelivery({ caller: { kind: 'system' }, quoteId: qa.id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'origin_unavailable' });
  });
});

// ── Custody at the owner's door, and the ledger ─────────────────────────────

describe('custody: handovers at the owner\'s door, the return to the owner, and the money', () => {
  let w: OriginWorld;
  beforeEach(async () => {
    w = originWorld();
    await paidAndDispatched(w);
  });

  async function deliverOutbound(): Promise<void> {
    for (const [origin, booking, rental] of [[null, 'bk-s', STUDIO_CAM], [OWNER_A, 'bk-a', LENS_A], [OWNER_B, 'bk-b', LIGHT_B]] as const) {
      const s = legOf(w, 'outbound', origin);
      await advanceManualDelivery({ caller: staff, shipmentId: s.id, state: 'courier_assigned' }, w.deps);
      if (origin) expect(await confirmCollection({ caller: { kind: 'owner', userId: origin }, shipmentId: s.id, bookingId: booking, rentalId: rental, evidence: PHOTO }, w.deps)).toMatchObject({ ok: true });
      expect(await confirmCollection({ caller: staff, shipmentId: s.id, bookingId: booking, rentalId: rental, evidence: PHOTO }, w.deps)).toMatchObject({ ok: true });
      expect(await confirmHandover({ caller: staff, shipmentId: s.id, bookingId: booking, rentalId: rental, evidence: PHOTO, outcome: 'delivered' }, w.deps)).toMatchObject({ ok: true });
      expect(await confirmHandover({ caller: renter, shipmentId: s.id, bookingId: booking, rentalId: rental, evidence: [], outcome: 'accepted' }, w.deps)).toMatchObject({ ok: true });
    }
  }

  it('only the item\'s owner hands it over at their door, with a photo; the renter or another owner cannot', async () => {
    const s = legOf(w, 'outbound', OWNER_A);
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: [] }, w.deps)).toMatchObject({ ok: false, code: 'evidence_required' });
    expect(await confirmCollection({ caller: ownerB, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps)).toMatchObject({ ok: false, code: 'not_owner' });
    expect(await confirmCollection({ caller: renter, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps)).toMatchObject({ ok: false });
    expect(await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps)).toMatchObject({ ok: true, duplicate: false });
    expect(w.repo.custody.filter((c) => c.shipmentId === s.id).map((c) => [c.kind, c.actor.kind])).toEqual([['handed_to_courier', 'owner']]);
    // Our driver's collection moves the leg and tells the owner it was collected.
    await confirmCollection({ caller: staff, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
    expect(w.repo.shipments.get(s.id)?.status).toBe('collected');
    expect(w.repo.noticesFor(OWNER_A)).toContain('owner_pickup_collected:in_app');
    expect(w.repo.noticesFor(OWNER_B)).not.toContain('owner_pickup_collected:in_app');
  });

  it('each origin\'s fee is earned under its own key, once; every journal balances and income = the fees earned', async () => {
    await deliverOutbound();
    const keys = [...w.repo.journals.keys()].filter((k) => k.startsWith('delivery:'));
    expect(keys.sort()).toEqual([`delivery:${GROUP}:outbound`, `delivery:${GROUP}:outbound@${OWNER_A}`, `delivery:${GROUP}:outbound@${OWNER_B}`].sort());
    // Accepting again earns nothing more.
    const s = legOf(w, 'outbound', OWNER_A);
    await confirmHandover({ caller: renter, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: [], outcome: 'accepted' }, w.deps);
    expect([...w.repo.journals.keys()].filter((k) => k.startsWith('delivery:'))).toHaveLength(3);
    let income = 0;
    for (const j of w.repo.journals.values()) {
      expect(isBalanced(j)).toBe(true);
      for (const l of j.lines) if (l.account === 'delivery_income') income += l.creditCents - l.debitCents;
    }
    const fees = shipmentsOf(w).filter((x) => x.leg === 'outbound').reduce((n, x) => n + x.customerFeeCents, 0);
    expect(income).toBe(fees);
  });

  it('return to the owner: the owner confirms receipt and condition; that fee is earned and the line can settle', async () => {
    await deliverOutbound();
    const r = legOf(w, 'return', OWNER_A);
    for (const st of ['courier_assigned', 'courier_at_pickup'] as const) await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: st }, w.deps);
    await confirmCollection({ caller: staff, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'in_transit' }, w.deps);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'courier_at_dropoff' }, w.deps);
    expect(w.repo.noticesFor(OWNER_A)).toContain('owner_gear_returned:in_app');
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-a' }, w.deps)).allowed).toBe(false);
    // Nobody but owner A confirms owner A's return.
    expect(await confirmOwnerReturn({ caller: ownerB, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await confirmOwnerReturn({ caller: renter as never, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: '' }, w.deps)).toMatchObject({ ok: false, code: 'evidence_required' });
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: [], outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: false, code: 'evidence_required' });
    const ok = await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good, all caps there' }, w.deps);
    expect(ok).toMatchObject({ ok: true, duplicate: false });
    expect(w.repo.custody.filter((c) => c.shipmentId === r.id).map((c) => [c.kind, c.actor.kind])).toEqual([
      ['collected_by_courier', 'thabangvision_staff'],
      ['received_by_owner', 'owner'],
      ['inspected', 'owner'],
    ]);
    expect(w.repo.shipments.get(r.id)).toMatchObject({ status: 'delivered' });
    expect(w.repo.journals.has(`delivery:${GROUP}:return@${OWNER_A}`)).toBe(true);
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-a' }, w.deps)).toMatchObject({ allowed: true });
    // A replay changes nothing.
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: true, duplicate: true });
    for (const j of w.repo.journals.values()) expect(isBalanced(j)).toBe(true);
  });

  it('a problem the owner reports opens an incident that holds only that line (no blame)', async () => {
    await deliverOutbound();
    const r = legOf(w, 'return', OWNER_B);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'courier_assigned' }, w.deps);
    await confirmCollection({ caller: staff, shipmentId: r.id, bookingId: 'bk-b', rentalId: LIGHT_B, evidence: PHOTO }, w.deps);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'courier_at_dropoff' }, w.deps);
    expect(await confirmOwnerReturn({ caller: ownerB, shipmentId: r.id, bookingId: 'bk-b', rentalId: LIGHT_B, evidence: PHOTO, outcome: 'problem', problem: { kind: 'damaged', description: '' } }, w.deps)).toMatchObject({ ok: false, code: 'exception_needs_detail' });
    const res = await confirmOwnerReturn({ caller: ownerB, shipmentId: r.id, bookingId: 'bk-b', rentalId: LIGHT_B, evidence: PHOTO, outcome: 'problem', problem: { kind: 'damaged', description: 'Cracked lens hood' } }, w.deps);
    expect(res).toMatchObject({ ok: true });
    const incidents = [...w.repo.incidents.values()];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ bookingIds: ['bk-b'], kind: 'damaged', liability: 'undetermined', providerCaused: null, reportedBy: { kind: 'owner', id: OWNER_B } });
    const held = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-b' }, w.deps);
    expect(held).toMatchObject({ allowed: false });
    expect(held.reasons).toContain('open_delivery_incident');
    // The studio camera is not held by owner B's report.
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-s' }, w.deps)).reasons).not.toContain('open_delivery_incident');
    expect(w.repo.noticesFor(RENTER)).toContain('delivery_incident:in_app');
  });

  it('an owner never confirms a return to the studio, and staff still can record a receipt for an owner', async () => {
    await deliverOutbound();
    const studioReturn = legOf(w, 'return', null);
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: studioReturn.id, bookingId: 'bk-s', rentalId: STUDIO_CAM, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    // Custody rule: an owner inspects only on a return to THEIR address.
    const e: CustodyEvent = { shipmentId: studioReturn.id, bookingGroupId: GROUP, bookingId: 'bk-a', rentalId: LENS_A, serialNumber: null, kind: 'inspected', actor: { kind: 'owner', id: OWNER_A }, occurredAt: '2026-10-22T12:00:00Z', evidence: PHOTO, accessories: [], serialConfirmed: false, condition: 'Good', discrepancies: [], incidentId: null, dedupeKey: 'x' };
    const ctx = { shipmentId: studioReturn.id, bookingGroupId: GROUP, leg: 'return' as const, items: [{ bookingId: 'bk-a', rentalId: LENS_A, ownerId: OWNER_A }], renterId: RENTER };
    expect(checkCustodyEvent(e, ctx, [])).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(checkCustodyEvent(e, { ...ctx, originOwnerId: OWNER_B }, [])).toMatchObject({ ok: false, code: 'actor_not_allowed' });
    expect(checkCustodyEvent(e, { ...ctx, originOwnerId: OWNER_A }, [])).toMatchObject({ ok: false, code: 'out_of_order' }); // allowed actor, but receipt first
  });
});

// ── Privacy ─────────────────────────────────────────────────────────────────

describe('privacy: owners see their own items only; renters see the owner\'s suburb at most', () => {
  let w: OriginWorld;
  beforeEach(async () => {
    w = originWorld();
    await paidAndDispatched(w);
  });

  it('getDeliveryStatus for owner A: only legs and items that are theirs, no tracking link', async () => {
    for (const s of w.repo.shipments.values()) s.trackingUrl = 'https://track.example/where-the-renter-is';
    const r = await getDeliveryStatus({ caller: ownerA, bookingGroupId: GROUP }, w.deps);
    if (!r.ok) throw new Error(r.code);
    expect(r.legs.every((l) => l.items.every((i) => i.bookingId === 'bk-a'))).toBe(true);
    expect(r.legs.every((l) => l.trackingUrl === null)).toBe(true);
    expect(r.legs.map((l) => [l.leg, l.originOwnerId])).toEqual([
      ['outbound', OWNER_A],
      ['return', OWNER_A],
    ]);
  });

  it('the owner view carries no renter id, address, fee or tracking link, and no other owner\'s item', async () => {
    const custody = w.repo.custody;
    const legs = ownerLegs(OWNER_A, shipmentsOf(w), custody, new Map([[LENS_A, 'Lens A']]));
    expect(legs).toHaveLength(2);
    expect(legs.find((l) => l.leg === 'outbound')).toMatchObject({ via: 'your_address', status_label: 'Collection from you booked', items: [{ booking_id: 'bk-a', title: 'Lens A', can_hand_over: true, can_confirm_return: false }] });
    const text = JSON.stringify(legs);
    for (const secret of [RENTER, 'Sandton', 'Test Road', 'Thandi', 'bk-b', 'bk-s', 'track.example', 'fee']) expect(text).not.toContain(secret);
  });

  it('the renter sees "from the owner (suburb)", never the owner\'s street or phone', async () => {
    const r = await getDeliveryStatus({ caller: renter, bookingGroupId: GROUP }, w.deps);
    if (!r.ok) throw new Error(r.code);
    const areas = new Map<string, string | null>();
    for (const s of shipmentsOf(w)) if (s.originOwnerId) areas.set(s.id, publicOriginArea(w.addresses.points.get(s.leg === 'outbound' ? s.originAddressId : s.destinationAddressId) ?? null));
    const legs = customerLegs(r.legs, shipmentsOf(w), new Map(), areas);
    expect(legs.filter((l) => l.from === 'owner').map((l) => l.origin_area).sort()).toEqual(['Hatfield', 'Hatfield', 'Melville', 'Melville']);
    expect(legs.find((l) => l.from === 'studio')?.origin_area).toBeNull();
    const text = JSON.stringify(legs);
    for (const secret of ['Owner Lane', 'Owner Road', '0820000003', 'Ayanda', 'Ring twice', OWNER_A]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/address|lat|lng/i);
  });
});
