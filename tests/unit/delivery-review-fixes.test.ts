/**
 * Review fixes on Phase 4 delivery (core and lib). Each block names the
 * finding it covers. The money ones (1, 4, 6) were mutation-checked: undoing
 * the fix makes the test fail.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_OPS, DELIVERY_POLICY } from '@/lib/constants';
import { manualReference } from '@/lib/payments/routing';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { lateFeeAutoChargeAllowed } from '@/lib/core/delivery/incidents';
import {
  CLAIM_STALE_MS,
  cancelDelivery,
  checkRentalSettlement,
  closeDeliveryReview,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  deemDeliveryAccepted,
  deliveryFeeRefundKey,
  isManualPaymentReference,
  markDeliveryQuotesPaid,
  markDeliveryQuotesPaidByStaff,
  prepareDelivery,
  quoteDelivery,
  refundUnusedDeliveryQuote,
  reportIncident,
  resolveIncident,
  type DeliveryLineInput,
} from '@/lib/core/delivery/use-cases';
import { dispatchAfterManualPayment, dispatchDeliveryAfterPayment } from '@/lib/delivery/after-payment';
import { priceCheckoutDelivery, quoteCartDelivery } from '@/lib/delivery/checkout';
import { createManualDeliveryAdapter, InMemoryManualTaskStore } from '@/lib/delivery/manual';
import { isOwnStorageUrl, queuesFor } from '@/lib/delivery/ops';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { returnPickupOption, RETURN_REQUESTED_MESSAGE } from '@/lib/delivery/customer-view';
import { lateFeeAfterDelivery } from '@/lib/rental/late-fee';
import { cleanRenter, GROUP, LINES_FOR_QUOTE, OFFICE, OWNER_A, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';
import { checkoutWorld, PRETORIA_NORTH, type CheckoutWorld } from './helpers/delivery-checkout-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const system = { kind: 'system' as const };
const WINDOW_OUT = { start: '2026-10-20T06:00:00.000Z', end: '2026-10-20T10:00:00.000Z' };
const WINDOW_BACK = { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T15:00:00.000Z' };
const photo = (ref: string) => [{ kind: 'photo' as const, ref: `https://res.cloudinary.com/demo/${ref}.jpg` }];
const staffAlerts = (w: World): string[] => [...w.repo.outbox.values()].filter((n) => n.userId === 'staff').map((n) => String((n.data as { what?: string } | undefined)?.what));

/** Quotes taken at checkout and tied to the order (as the checkout route does). */
async function checkoutOrder(w: CheckoutWorld, legs: ('outbound' | 'return')[] = ['outbound']) {
  const r = await quoteCartDelivery(
    { caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: LINES_FOR_QUOTE, legs: legs.map((leg) => ({ leg, window: leg === 'outbound' ? WINDOW_OUT : WINDOW_BACK })) },
    w.deps,
  );
  if (!r.ok) throw new Error(r.code);
  for (const q of r.quotes) expect(await w.links.linkToGroup(q.id, GROUP)).toBe(true);
  return { quotes: r.quotes, totalCents: r.quotes.reduce((s, q) => s + q.customerFeeCents, 0) };
}

/** A paid own-vehicle outbound leg, dispatched (scheduled). */
async function paidOutbound(w: World) {
  const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
  if (!q.ok) throw new Error(q.code);
  const quote = q.quotes[0];
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quote.id], paidDeliveryCents: quote.customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: system, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  const c = await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  return { quote, shipmentId: p.shipment.id };
}

/** Our driver hands every item over at the renter's door. */
async function deliverAll(w: World, shipmentId: string) {
  const s = w.repo.shipments.get(shipmentId)!;
  for (const i of s.items) {
    const r = await confirmHandover({ caller: staff, shipmentId, bookingId: i.bookingId, rentalId: i.rentalId, evidence: photo(`d-${i.rentalId}`), outcome: 'delivered' }, w.deps);
    expect(r.ok).toBe(true);
  }
  expect(w.repo.shipments.get(shipmentId)?.status).toBe('delivered');
}

// ── 1. A cancelled paid leg is never re-dispatched on a payment replay ──────

describe('finding 1: a cancelled paid leg is not dispatched again by a payment replay', () => {
  it('cancel a paid, prepared leg → quote refunded; a duplicate webhook / recovery run sends nothing and earns nothing', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    // The first run prepares the leg but cannot commit it (the lines are not confirmed yet).
    w.bookings.setStatus(GROUP, 'pending');
    const first = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links });
    expect(first).toMatchObject({ outcome: 'done', legs: [{ leg: 'outbound', result: 'commit_booking_state' }] });
    const [leg] = await w.repo.listShipments(GROUP);
    expect(leg.status).toBe('prepared');
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('paid');

    // The renter cancels: the fee is refunded once and the quote is settled.
    const cancelled = await cancelDelivery({ caller: renter, shipmentId: leg.id, reason: 'changed plans' }, w.deps);
    expect(cancelled).toMatchObject({ ok: true, refundCents: totalCents });
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('refunded');

    // Payment webhook duplicate and missed-payment recovery, with the booking now confirmed.
    w.bookings.setStatus(GROUP, 'confirmed');
    for (let i = 0; i < 2; i++) {
      const replay = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links });
      expect(replay).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'refunded' }] });
    }
    const legs = await w.repo.listShipments(GROUP);
    expect(legs).toHaveLength(1);
    expect(w.tasks.tasks.size).toBe(0);
    expect(w.repo.refunds.size).toBe(1);
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
  });

  it('prepare refuses a quote whose leg was already cancelled, even if the quote still reads paid', async () => {
    const w = world({ providers: 'manual' });
    const { quote, shipmentId } = await paidOutbound(w);
    await cancelDelivery({ caller: staff, shipmentId, reason: 'platform cancelled' }, w.deps);
    // Simulate a quote that was left `paid` (e.g. an older row): the shipment history still guards it.
    w.repo.quotes.get(quote.id)!.status = 'paid';
    const again = await prepareDelivery({ caller: system, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
    expect(again).toMatchObject({ ok: false, code: 'quote_not_active' });
    expect(await w.repo.listShipments(GROUP)).toHaveLength(1);
  });

  it('a refused dispatch and a provider cancellation also settle the quote (refunded)', async () => {
    const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
    w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
    if (!q.ok) throw new Error(q.code);
    await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
    const p = await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    w.courier.createScript = ['rejected'];
    expect(await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: false, code: 'dispatch_rejected' });
    expect(w.repo.quotes.get(q.quotes[0].id)?.status).toBe('refunded');
    expect(await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'quote_not_active' });
  });
});

// ── 3. Renter acceptance and deemed acceptance (D-48) ───────────────────────

describe('finding 3: the renter accepts; otherwise the leg is deemed accepted', () => {
  it('the renter accepting every item earns the outbound fee and sets acceptedAt', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, quote } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    for (const [bookingId, rentalId] of [['bk-1', 'cam-1'], ['bk-2', 'lens-1']] as const) {
      expect(await confirmHandover({ caller: renter, shipmentId, bookingId, rentalId, evidence: [], outcome: 'accepted' }, w.deps)).toMatchObject({ ok: true });
    }
    expect(w.repo.shipments.get(shipmentId)?.acceptedAt).not.toBeNull();
    expect(w.repo.journals.get(`delivery:${GROUP}:outbound`)?.lines.find((l) => l.account === 'delivery_income')?.creditCents).toBe(quote.customerFeeCents);
    // Nobody else accepts for the renter (D15).
    expect(await confirmHandover({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId, bookingId: 'bk-1', rentalId: 'cam-1', evidence: [], outcome: 'accepted' }, w.deps)).toMatchObject({ ok: false });
  });

  it('reminds once, then deems acceptance after deemedAcceptanceHours: fee earned, address can follow retention', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, quote } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    const lead = DELIVERY_POLICY.deemedAcceptanceHours - DELIVERY_POLICY.deemedAcceptanceReminderLeadHours;

    w.clock.advanceMinutes((lead - 1) * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_due' });
    w.clock.advanceMinutes(2 * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'reminded' });
    expect([...w.repo.outbox.values()].some((n) => n.userId === RENTER && n.kind === 'delivery_delivered' && n.dedupeKey.includes('accept_reminder'))).toBe(true);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_due' });

    w.clock.advanceMinutes(DELIVERY_POLICY.deemedAcceptanceReminderLeadHours * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'deemed' });
    const s = w.repo.shipments.get(shipmentId)!;
    expect(s.acceptedAt).not.toBeNull();
    expect(w.repo.custody.filter((c) => c.kind === 'deemed_accepted').map((c) => c.actor)).toEqual([
      { kind: 'system', id: null },
      { kind: 'system', id: null },
    ]);
    expect(w.repo.journals.get(`delivery:${GROUP}:outbound`)?.lines.find((l) => l.account === 'delivery_income')?.creditCents).toBe(quote.customerFeeCents);
    // Idempotent: nothing more happens.
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
    // Only the system deems.
    expect(await deemDeliveryAccepted({ caller: staff, shipmentId }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('never deems without a reminder on an earlier run, over a reported problem, or with an open incident', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    // A leg first seen long after delivery is reminded first, not deemed.
    w.clock.advanceMinutes(DELIVERY_POLICY.deemedAcceptanceHours * 3 * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'reminded' });
    // The renter reports a problem with one item: a person decides.
    expect(await confirmHandover({ caller: renter, shipmentId, bookingId: 'bk-2', rentalId: 'lens-1', evidence: [], outcome: 'exception', discrepancies: ['lens cap missing'] }, w.deps)).toMatchObject({ ok: true });
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });

    const w2 = world({ providers: 'manual' });
    const two = await paidOutbound(w2);
    await deliverAll(w2, two.shipmentId);
    await reportIncident({ caller: renter, shipmentId: two.shipmentId, kind: 'delayed', description: 'arrived very late' }, w2.deps);
    w2.clock.advanceMinutes(DELIVERY_POLICY.deemedAcceptanceHours * 3 * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId: two.shipmentId }, w2.deps)).toEqual({ ok: true, outcome: 'held' });
    expect(w2.repo.shipments.get(two.shipmentId)?.acceptedAt).toBeNull();
  });

  it('never applies to a return leg (inspection still needed, D17)', async () => {
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW_BACK }, w.deps);
    if (!q.ok) throw new Error(q.code);
    w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
    w.repo.shipments.get(p.shipment.id)!.status = 'delivered';
    w.repo.shipments.get(p.shipment.id)!.deliveredAt = w.clock.now().toISOString();
    w.clock.advanceMinutes(DELIVERY_POLICY.deemedAcceptanceHours * 3 * 60);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId: p.shipment.id }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
  });
});

// ── 4. A renter cannot waive their own late fee ─────────────────────────────

describe('finding 4: only staff or the provider attribute a delay', () => {
  async function returnLeg(w: World) {
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW_BACK }, w.deps);
    if (!q.ok) throw new Error(q.code);
    w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
    return p.shipment.id;
  }

  it('a renter or agent "driver did not come" starts unattributed: it holds settlement but never waives the fee', async () => {
    const w = world({ providers: 'manual' });
    const shipmentId = await returnLeg(w);
    for (const caller of [renter, { kind: 'agent' as const, userId: RENTER, approval: null }]) {
      const r = await reportIncident({ caller, shipmentId, kind: 'driver_no_show', description: 'nobody came', providerCaused: true }, w.deps);
      expect(r.ok).toBe(true);
      w.clock.advanceMinutes(1);
    }
    const incidents = await w.repo.listIncidents(GROUP);
    expect(incidents.map((i) => i.providerCaused)).toEqual([null, null]);
    const check = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps);
    expect(check.lateFeeAutoCharge).toBe(true);
    expect(check.allowed).toBe(false);
    expect(check.reasons).toContain('open_delivery_incident');
  });

  it('resolved without attribution: the normal late fee applies; staff attribution to the provider waives it', async () => {
    const w = world({ providers: 'manual' });
    const shipmentId = await returnLeg(w);
    const r = await reportIncident({ caller: renter, shipmentId, kind: 'delayed', description: 'driver late' }, w.deps);
    if (!r.ok) throw new Error(r.code);
    await resolveIncident({ caller: staff, incidentId: r.incidentId, resolution: 'renter not home', providerCaused: null, liability: 'undetermined' }, w.deps);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).lateFeeAutoCharge).toBe(true);
    const late = lateFeeAfterDelivery({ endDate: '2026-10-22', returnedAt: new Date('2026-10-24T12:00:00Z'), quantity: 1, deposit: 5000 }, { lateFeeAutoCharge: true });
    expect(late.fee).toBeGreaterThan(0);

    const s = await reportIncident({ caller: staff, shipmentId, kind: 'driver_no_show', description: 'courier never came', providerCaused: true }, w.deps);
    expect(s.ok).toBe(true);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).lateFeeAutoCharge).toBe(false);
  });

  it('the pure rule: only providerCaused === true waives', () => {
    const base = { leg: 'return' as const, kind: 'driver_no_show' as const };
    expect(lateFeeAutoChargeAllowed([{ ...base, providerCaused: null }]).allowed).toBe(true);
    expect(lateFeeAutoChargeAllowed([{ ...base, providerCaused: false }]).allowed).toBe(true);
    expect(lateFeeAutoChargeAllowed([{ ...base, providerCaused: true }])).toEqual({ allowed: false, reason: 'provider_caused_delay' });
  });
});

// ── 6. A paid quote with no leg is refunded ─────────────────────────────────

describe('finding 6: a paid quote whose leg was never made is refunded, once', () => {
  it('after-payment prepare refused (no longer eligible): fee obligation opened at once; replays add nothing', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    w.trust.facts.set(RENTER, { ...cleanRenter, suspended: true });
    const r = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links });
    expect(r).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'refunded_not_eligible' }] });
    const key = deliveryFeeRefundKey(`quote-${quotes[0].id}`);
    expect(w.repo.refunds.get(key)).toMatchObject({ amountCents: totalCents, paidReference: 'pay-ref-1' });
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('refunded');
    expect(w.repo.journals.get(`delivery-cancel:quote-${quotes[0].id}`)?.lines.find((l) => l.account === 'refunds_payable')?.creditCents).toBe(totalCents);
    // Eligible again later: a replay still never dispatches a refunded fee, or refunds twice.
    w.trust.facts.set(RENTER, cleanRenter);
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links })).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'refunded' }] });
    expect(w.repo.refunds.size).toBe(1);
    expect(await w.repo.listShipments(GROUP)).toHaveLength(0);
    expect(await refundUnusedDeliveryQuote({ caller: system, quoteId: quotes[0].id, reason: 'again' }, w.deps)).toEqual({ ok: true, outcome: 'already_refunded', refundCents: 0 });
  });

  it('refused while a live leg uses the quote, and for someone else', async () => {
    const w = world({ providers: 'manual' });
    const { quote } = await paidOutbound(w);
    w.repo.quotes.get(quote.id)!.status = 'paid';
    expect(await refundUnusedDeliveryQuote({ caller: system, quoteId: quote.id, reason: 'x' }, w.deps)).toMatchObject({ ok: false, code: 'in_use' });
    expect(await refundUnusedDeliveryQuote({ caller: { kind: 'renter', userId: OWNER_A }, quoteId: quote.id, reason: 'x' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
  });
});

// ── 7. Quotes are tied to the cart's dates and units ────────────────────────

describe('finding 7: a quote is stale when the dates or units change', () => {
  const linesWith = (patch: Partial<DeliveryLineInput>): DeliveryLineInput[] => LINES_FOR_QUOTE.map((l) => ({ ...l, ...patch }));

  it('more units of the same item: re-quoted (the own-vehicle price counts units)', async () => {
    const w = checkoutWorld();
    w.addresses.points.set(RENTER_HOME, { ...w.addresses.points.get(RENTER_HOME)!, lat: PRETORIA_NORTH.lat, lng: PRETORIA_NORTH.lng });
    const cheap = linesWith({ unitReplacementValueCents: 50_000 });
    const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: cheap, legs: [{ leg: 'outbound', window: WINDOW_OUT }] }, w.deps);
    if (!r.ok) throw new Error(r.code);
    const before = r.quotes[0].customerFeeCents;
    const priced = await priceCheckoutDelivery({ renterId: RENTER, quoteIds: [r.quotes[0].id], approvedCents: before, lines: cheap.map((l) => ({ ...l, quantity: 4 })) }, w.deps);
    expect(priced).toMatchObject({ ok: false, status: 409, code: 'DELIVERY_REQUOTE' });
    expect((priced as { amountCents: number }).amountCents).toBeGreaterThan(before);
  });

  it('new hire dates: re-quoted with the window moved to the new first day; the old quote is never charged', async () => {
    const w = checkoutWorld();
    const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: LINES_FOR_QUOTE, legs: [{ leg: 'outbound', window: WINDOW_OUT }] }, w.deps);
    if (!r.ok) throw new Error(r.code);
    const fee = r.quotes[0].customerFeeCents;
    const moved = linesWith({ startDate: '2026-10-21', endDate: '2026-10-23' });
    const priced = await priceCheckoutDelivery({ renterId: RENTER, quoteIds: [r.quotes[0].id], approvedCents: fee, lines: moved }, w.deps);
    expect(priced).toMatchObject({ ok: true, requoted: true, amountCents: fee });
    const fresh = (priced as { quotes: { id: string; window: { start: string | null } }[] }).quotes[0];
    expect(fresh.id).not.toBe(r.quotes[0].id);
    expect(fresh.window.start).toBe('2026-10-21T06:00:00.000Z');
    expect(w.repo.quotes.get(r.quotes[0].id)?.status).toBe('superseded');
  });

  it('prepare refuses a quote whose units or dates differ from the booking', async () => {
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
    if (!q.ok) throw new Error(q.code);
    w.bookings.groups.get(GROUP)!.lines[0].endDate = '2026-10-25';
    expect(await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'dates_mismatch' });
    w.bookings.groups.get(GROUP)!.lines[0].endDate = '2026-10-22';
    w.bookings.groups.get(GROUP)!.lines[1].quantity = 2;
    expect(await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: false, code: 'dates_mismatch' });
    w.bookings.groups.get(GROUP)!.lines[1].quantity = 1;
    expect(await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps)).toMatchObject({ ok: true });
  });
});

// ── 8. Own-vehicle price counts units ───────────────────────────────────────

describe('finding 8: own vehicle prices units, not lines', () => {
  it('one line of 5 costs the same as 5 lines of 1, and what the formula says for 5 items', async () => {
    const adapter = createManualDeliveryAdapter(new InMemoryManualTaskStore());
    const from = { placeId: 'o', lat: -26.1929, lng: 28.0305, formattedAddress: 'o', suburb: null, city: null, postalCode: null, province: 'Gauteng', contactName: 'x', contactPhone: 'x', instructions: null };
    const to = { ...from, placeId: 'd', lat: PRETORIA_NORTH.lat, lng: PRETORIA_NORTH.lng };
    const item = { rentalId: 'r', bookingId: 'b', driverLabel: 'gear', replacementValueCents: 1, weightGrams: null, containsLithium: false };
    const one = await adapter.quote({ from, to, items: [{ ...item, quantity: 5 }], window: { start: null, end: null }, leg: 'outbound' });
    const five = await adapter.quote({ from, to, items: Array.from({ length: 5 }, (_, i) => ({ ...item, rentalId: `r${i}`, quantity: 1 })), window: { start: null, end: null }, leg: 'outbound' });
    const single = await adapter.quote({ from, to, items: [{ ...item, quantity: 1 }], window: { start: null, end: null }, leg: 'outbound' });
    if (!one.ok || !five.ok || !single.ok) throw new Error('quote');
    expect(one.value.providerCostCents).toBe(five.value.providerCostCents);
    const formula = quoteOwnVehicleCents({ origin: { name: 'origin', coords: { lat: from.lat, lng: from.lng } }, destination: { lat: to.lat, lng: to.lng }, itemCount: 5 });
    expect('feeCents' in formula && formula.feeCents).toBe(one.value.providerCostCents);
    expect(one.value.providerCostCents).toBeGreaterThan(single.value.providerCostCents);
  });
});

// ── 9. Incidents cover the reporter's own lines ─────────────────────────────

describe('finding 9: an incident covers the reporter’s own lines and holds only those', () => {
  it('an owner reports on their own item only; the other owner’s line is not held', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await paidOutbound(w);
    const r = await reportIncident({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId, kind: 'delayed', description: 'driver late at my place' }, w.deps);
    if (!r.ok) throw new Error(r.code);
    expect((await w.repo.getIncident(r.incidentId))?.bookingIds).toEqual(['bk-1']);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).reasons).toContain('open_delivery_incident');
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-2' }, w.deps)).reasons).not.toContain('open_delivery_incident');
    // An owner cannot name another owner's line.
    expect(await reportIncident({ caller: { kind: 'owner', userId: OWNER_A }, shipmentId, kind: 'delayed', description: 'about the lens', bookingIds: ['bk-2'] }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('the renter reports on the order’s lines; staff can narrow to one line', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await paidOutbound(w);
    const a = await reportIncident({ caller: renter, shipmentId, kind: 'delayed', description: 'late' }, w.deps);
    w.clock.advanceMinutes(1);
    const b = await reportIncident({ caller: staff, shipmentId, kind: 'delayed', description: 'lens only', bookingIds: ['bk-2'] }, w.deps);
    if (!a.ok || !b.ok) throw new Error('report');
    expect((await w.repo.getIncident(a.incidentId))?.bookingIds).toEqual(['bk-1', 'bk-2']);
    expect((await w.repo.getIncident(b.incidentId))?.bookingIds).toEqual(['bk-2']);
  });
});

// ── 10. Staff close a review ────────────────────────────────────────────────

describe('finding 10: staff close a leg stuck in review, with a reason', () => {
  it('incident_under_review → delivered or failed through the core rules; reason required; staff only', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, quote } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    await confirmHandover({ caller: renter, shipmentId, bookingId: 'bk-1', rentalId: 'cam-1', evidence: [], outcome: 'exception', discrepancies: ['scratched'] }, w.deps);
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('incident_under_review');

    expect(await closeDeliveryReview({ caller: renter, shipmentId, to: 'delivered', reason: 'fine' }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await closeDeliveryReview({ caller: staff, shipmentId, to: 'delivered', reason: ' ' }, w.deps)).toMatchObject({ ok: false, code: 'reason_required' });
    const closed = await closeDeliveryReview({ caller: staff, shipmentId, to: 'failed', reason: 'gear came back damaged; collect in person', refundFee: true }, w.deps);
    expect(closed).toMatchObject({ ok: true, outcome: 'closed', refundCents: quote.customerFeeCents });
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('failed');
    expect(w.repo.events.at(-1)).toMatchObject({ to: 'failed', source: 'staff' });
    expect(w.repo.quotes.get(quote.id)?.status).toBe('refunded');
    expect(await closeDeliveryReview({ caller: staff, shipmentId, to: 'failed', reason: 'again' }, w.deps)).toMatchObject({ ok: false, code: 'not_under_review' });
  });
});

// ── 11. Orders paid by hand ─────────────────────────────────────────────────

describe('finding 11: staff dispatch a delivery paid by hand (never unpaid)', () => {
  function manualOrder() {
    const w = checkoutWorld();
    const g = w.bookings.groups.get(GROUP)!;
    g.paymentVerified = false;
    g.paymentReference = null;
    g.manualPaymentReference = 'manual:eft:ORDER1';
    return w;
  }

  it('the system never dispatches it; staff with the exact amount do, through the core', async () => {
    const w = manualOrder();
    const { quotes, totalCents } = await checkoutOrder(w);
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: null }, { delivery: w.deps, links: w.links })).toEqual({ outcome: 'payment_not_verified' });

    const ids = quotes.map((q) => q.id);
    expect(await dispatchAfterManualPayment({ staffId: STAFF, bookingGroupId: GROUP, quoteIds: ids, reference: 'manual:eft:ORDER1', receivedCents: totalCents - 1 }, w.deps)).toMatchObject({ ok: false, code: 'amount_mismatch' });
    expect(await dispatchAfterManualPayment({ staffId: STAFF, bookingGroupId: GROUP, quoteIds: ids, reference: 'pay-ref-1', receivedCents: totalCents }, w.deps)).toMatchObject({ ok: false, code: 'not_manual' });
    expect(await markDeliveryQuotesPaidByStaff({ caller: renter, bookingGroupId: GROUP, quoteIds: ids, reference: 'manual:eft:ORDER1', receivedCents: totalCents }, w.deps)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(w.tasks.tasks.size).toBe(0);

    const ok = await dispatchAfterManualPayment({ staffId: STAFF, bookingGroupId: GROUP, quoteIds: ids, reference: 'manual:eft:ORDER1', receivedCents: totalCents }, w.deps);
    expect(ok).toEqual({ ok: true, marked: 1, legs: [{ leg: 'outbound', result: 'dispatched' }] });
    const [leg] = await w.repo.listShipments(GROUP);
    expect(leg).toMatchObject({ status: 'scheduled', paidReference: 'manual:eft:ORDER1' });
    // The server still never commits it on its own (payment not provider-verified).
    expect(await commitDelivery({ caller: system, shipmentId: leg.id }, w.deps)).toMatchObject({ ok: true, outcome: 'already_dispatched' });
  });

  it('an order not yet paid: refused, nothing marked or dispatched', async () => {
    const w = checkoutWorld();
    const g = w.bookings.groups.get(GROUP)!;
    g.paymentVerified = false;
    g.manualPaymentReference = null;
    const { quotes, totalCents } = await checkoutOrder(w);
    expect(await dispatchAfterManualPayment({ staffId: STAFF, bookingGroupId: GROUP, quoteIds: quotes.map((q) => q.id), reference: 'manual:eft:X', receivedCents: totalCents }, w.deps)).toMatchObject({ ok: false, code: 'payment_not_confirmed' });
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('active');
    expect(w.tasks.tasks.size).toBe(0);
  });

  it('cancelling a hand-paid leg: no provider refund or journal; staff refund it by hand', async () => {
    const w = manualOrder();
    const { quotes, totalCents } = await checkoutOrder(w);
    await dispatchAfterManualPayment({ staffId: STAFF, bookingGroupId: GROUP, quoteIds: quotes.map((q) => q.id), reference: 'manual:eft:ORDER1', receivedCents: totalCents }, w.deps);
    const [leg] = await w.repo.listShipments(GROUP);
    const r = await cancelDelivery({ caller: staff, shipmentId: leg.id, reason: 'renter called' }, w.deps);
    expect(r).toMatchObject({ ok: true, refundCents: totalCents });
    expect(w.repo.refunds.size).toBe(0);
    expect(w.repo.journals.has(`delivery-cancel:${leg.id}`)).toBe(false);
    expect(staffAlerts(w)).toContain('delivery_manual_fee_refund_due');
  });

  it('the manual reference prefix matches lib/payments/routing', () => {
    expect(isManualPaymentReference(manualReference('eft', 'ABC'))).toBe(true);
    expect(isManualPaymentReference(manualReference('cash', 'x'))).toBe(true);
    expect(isManualPaymentReference('T_provider_1')).toBe(false);
  });
});

// ── 12. Return pickup request (pure part; the route is in delivery-review-routes) ──

describe('finding 12: a requested pickup is not offered again', () => {
  it('returnPickupOption says requested while one is pending', () => {
    expect(returnPickupOption([{ leg: 'outbound', status: 'delivered' }], ['active'], { customerFeeCents: 15_000 })).toEqual({ allowed: false, reason: 'requested', message: RETURN_REQUESTED_MESSAGE });
  });
});

// ── 13. The return pickup ends lateness ─────────────────────────────────────

describe('finding 13: late fees run to when the return pickup took the gear', () => {
  it('checkRentalSettlement reports when every unit of the line left the renter', async () => {
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW_BACK }, w.deps);
    if (!q.ok) throw new Error(q.code);
    w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: system, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).returnCollectedAt).toBeNull();
    const at = '2026-10-22T11:00:00.000Z';
    await confirmCollection({ caller: staff, shipmentId: p.shipment.id, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo('c1'), occurredAt: at }, w.deps);
    const check = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps);
    expect(check.returnCollectedAt).toBe(at);
    // Still not settled: received and inspected first (D17).
    expect(check.allowed).toBe(false);
    // Late fee counted to the collection (on time), not to when it reached us days later.
    expect(lateFeeAfterDelivery({ endDate: '2026-10-22', returnedAt: new Date(at), quantity: 1, deposit: 5000 }, check).fee).toBe(0);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-2' }, w.deps)).returnCollectedAt).toBeNull();
  });
});

// ── 19, 20. Evidence storage and the stale-claim constant ───────────────────

describe('findings 19 and 20', () => {
  it('19: a Cloudinary link is accepted only for our configured cloud (fail closed)', () => {
    const url = 'https://res.cloudinary.com/anyone/image/upload/x.jpg';
    expect(isOwnStorageUrl(url, {})).toBe(false);
    expect(isOwnStorageUrl(url, { CLOUDINARY_CLOUD_NAME: 'ours' })).toBe(false);
    expect(isOwnStorageUrl('https://res.cloudinary.com/ours/image/upload/x.jpg', { CLOUDINARY_CLOUD_NAME: 'ours' })).toBe(true);
  });

  it('20: one stale-claim rule; a stale claim is in the attention (failed) queue', () => {
    expect(CLAIM_STALE_MS).toBe(DELIVERY_OPS.staleClaimMinutes * 60_000);
    const now = new Date('2026-10-10T12:00:00Z');
    const old = new Date(now.getTime() - CLAIM_STALE_MS - 1000).toISOString();
    const fresh = new Date(now.getTime() - 1000).toISOString();
    expect(queuesFor({ status: 'booking', leg: 'outbound', acceptedAt: null, intent: { state: 'claimed', attempts: 1, lastError: null, claimedAt: old } }, now)).toContain('failed');
    expect(queuesFor({ status: 'booking', leg: 'outbound', acceptedAt: null, intent: { state: 'claimed', attempts: 1, lastError: null, claimedAt: fresh } }, now)).not.toContain('failed');
  });
});
