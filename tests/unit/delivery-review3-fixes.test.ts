/**
 * Phase 4 delivery, review fixes round 3. Each block names the finding it
 * covers. Findings 1 and 2 were mutation-checked: undoing the fix makes a test
 * here fail. The database side of 3, 4 and 5 is in
 * lib/migrations/076-delivery.test.sql (22–24).
 */
import { describe, expect, it } from 'vitest';
import * as L from '@/lib/core/rental/ledger';
import {
  closeDeliveryReview,
  commitDelivery,
  confirmHandover,
  deemDeliveryAccepted,
  deliveryFeeRefundKey,
  markDeliveryQuotesPaid,
  prepareDelivery,
  quoteDelivery,
  refundDeliveryFee,
} from '@/lib/core/delivery/use-cases';
import { DELIVERY_POLICY } from '@/lib/constants';
import {
  deliveryCancellationPlan,
  settleOrderDeliveryOnCancel,
  sweepCancelledOrderDelivery,
  type DeliveryCancellationPlan,
} from '@/lib/rental/delivery-settlement';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const system = { kind: 'system' as const };
const WINDOW_OUT = { start: '2026-10-20T06:00:00.000Z', end: '2026-10-20T10:00:00.000Z' };
const WINDOW_BACK = { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T15:00:00.000Z' };
const photo = (ref: string) => [{ kind: 'photo' as const, ref: `https://res.cloudinary.com/demo/${ref}.jpg` }];
const staffAlerts = (w: World): string[] => [...w.repo.outbox.values()].filter((n) => n.userId === 'staff').map((n) => String((n.data as { what?: string } | undefined)?.what));
const groupJournals = (w: World) => [...w.repo.journals.values()].filter((j) => j.bookingGroupId === GROUP);

/** A paid own-vehicle outbound leg, its fee collected into unearned hire, handed over by our driver (delivered, NOT accepted). */
async function deliveredUnaccepted(w: World) {
  const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
  if (!q.ok) throw new Error(q.code);
  const quote = q.quotes[0];
  await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quote.id], paidDeliveryCents: quote.customerFeeCents }, w.deps);
  const p = await prepareDelivery({ caller: system, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  const c = await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  const fee = quote.customerFeeCents;
  await w.repo.post([L.paymentCaptured({ providerReference: 'pay-ref-1', bookingGroupId: GROUP, hireCents: 0, depositCents: 0, deliveryFeeCents: fee })], []);
  for (const i of w.repo.shipments.get(p.shipment.id)!.items) {
    expect((await confirmHandover({ caller: staff, shipmentId: p.shipment.id, bookingId: i.bookingId, rentalId: i.rentalId, evidence: photo(`d-${i.rentalId}`), outcome: 'delivered' }, w.deps)).ok).toBe(true);
  }
  expect(w.repo.shipments.get(p.shipment.id)).toMatchObject({ status: 'delivered', acceptedAt: null });
  return { shipmentId: p.shipment.id, fee, quoteId: quote.id };
}

/** Refunded once, never earned: unearned hire released once, no delivery income, the fee owed back. */
function expectRefundedNeverEarned(w: World, shipmentId: string, fee: number) {
  const b = L.balances(groupJournals(w));
  expect(b.unearned_hire).toBe(0);
  expect(b.delivery_income).toBe(0);
  expect(b.refunds_payable).toBe(-fee);
  expect(groupJournals(w).every((j) => L.isBalanced(j))).toBe(true);
  expect(w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(fee);
  expect(w.repo.refunds.size).toBe(1);
}

// ── 1. A fee refunded before it was earned is never earned afterwards ──────────

describe('finding 1: refund-then-earn never debits unearned hire twice', () => {
  it('refund of a delivered, unaccepted leg settles the earn key too (any later earn is a no-op)', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await deliveredUnaccepted(w);
    expect(await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill' }, w.deps)).toMatchObject({ ok: true, outcome: 'refunded', refundCents: fee });
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(true);
    expect(w.repo.journals.has(`delivery-cancel:${shipmentId}`)).toBe(true);
    expectRefundedNeverEarned(w, shipmentId, fee);
  });

  it('refund, then deemed acceptance: the leg is skipped entirely and the ledger stays balanced', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await deliveredUnaccepted(w);
    await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill' }, w.deps);
    w.clock.advanceMinutes(60 * (DELIVERY_POLICY.deemedAcceptanceHours - DELIVERY_POLICY.deemedAcceptanceReminderLeadHours) + 1);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
    w.clock.advanceMinutes(60 * DELIVERY_POLICY.deemedAcceptanceHours);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
    expect(w.repo.custody.some((c) => c.shipmentId === shipmentId && c.kind === 'deemed_accepted')).toBe(false);
    expectRefundedNeverEarned(w, shipmentId, fee);
  });

  it('refund, then the renter accepts: receipt is recorded, nothing is earned', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await deliveredUnaccepted(w);
    await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill' }, w.deps);
    for (const i of w.repo.shipments.get(shipmentId)!.items) {
      expect((await confirmHandover({ caller: renter, shipmentId, bookingId: i.bookingId, rentalId: i.rentalId, evidence: [], outcome: 'accepted' }, w.deps)).ok).toBe(true);
    }
    expect(w.repo.shipments.get(shipmentId)?.acceptedAt).not.toBeNull();
    expectRefundedNeverEarned(w, shipmentId, fee);
  });

  it('refund while under review, then close_review → delivered (confirmReceived): nothing is earned', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await deliveredUnaccepted(w);
    const [cam] = w.repo.shipments.get(shipmentId)!.items;
    await confirmHandover({ caller: renter, shipmentId, bookingId: cam.bookingId, rentalId: cam.rentalId, evidence: [], outcome: 'exception', discrepancies: ['strap missing'] }, w.deps);
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('incident_under_review');
    await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill for the missing strap' }, w.deps);
    expect(await closeDeliveryReview({ caller: staff, shipmentId, to: 'delivered', reason: 'strap found in the bag', confirmReceived: true }, w.deps)).toMatchObject({ ok: true, outcome: 'closed' });
    expect(w.repo.shipments.get(shipmentId)).toMatchObject({ status: 'delivered' });
    expect(w.repo.shipments.get(shipmentId)?.acceptedAt).not.toBeNull();
    expectRefundedNeverEarned(w, shipmentId, fee);
  });

  it('deemed acceptance skips a leg whose booking was cancelled (a person decides; the cancel alerted staff)', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await deliveredUnaccepted(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    w.clock.advanceMinutes(60 * DELIVERY_POLICY.deemedAcceptanceHours * 2);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(false);
  });

  it('unchanged: no refund, the renter accepts → earned once; a later refund reverses the income', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await deliveredUnaccepted(w);
    for (const i of w.repo.shipments.get(shipmentId)!.items) await confirmHandover({ caller: renter, shipmentId, bookingId: i.bookingId, rentalId: i.rentalId, evidence: [], outcome: 'accepted' }, w.deps);
    expect(L.balances(groupJournals(w))).toMatchObject({ unearned_hire: 0, delivery_income: -fee });
    await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill' }, w.deps);
    expect(L.balances(groupJournals(w))).toMatchObject({ unearned_hire: 0, delivery_income: 0, refunds_payable: -fee });
  });
});

// ── 2. A staff cancellation keeps the return pickup when the renter has the gear ──

/** A plan read through the real deliveryCancellationPlan over the in-memory repo. */
async function realPlan(w: World, lineStatus = 'cancelled'): Promise<DeliveryCancellationPlan> {
  const fake = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'equipment_bookings' ? [{ id: 'bk-1', status: lineStatus }] : table === 'delivery_shipments' ? [{ id: 'x' }] : [], error: null }).then(resolve);
      return b;
    },
  };
  return deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-1' }, w.repo);
}

async function returnLegScheduled(w: World) {
  const ret = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW_BACK }, w.deps);
  if (!ret.ok) throw new Error(ret.code);
  w.repo.quotes.get(ret.quotes[0].id)!.customerFeeCents = 0;
  w.bookings.setStatus(GROUP, 'active');
  const p = await prepareDelivery({ caller: system, quoteId: ret.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  const c = await commitDelivery({ caller: system, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  expect(w.repo.shipments.get(p.shipment.id)?.status).toBe('scheduled');
  return p.shipment.id;
}

describe('finding 2: a staff cancellation never drops the return pickup while the renter has the gear', () => {
  it('the plan keeps the scheduled return leg (not cancelled, not refunded) and says the gear is with the renter', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await deliveredUnaccepted(w);
    const ret = await returnLegScheduled(w);
    const plan = await realPlan(w);
    expect(plan).toMatchObject({ phase4: true, lastLine: true, inMotion: false, keptShipmentIds: [shipmentId], shipmentIds: [], returnKeptShipmentIds: [ret], gearWithRenter: true, feeCents: 0 });
  });

  it('settling the cancelled order leaves the return leg scheduled and alerts staff once', async () => {
    const w = world({ providers: 'manual' });
    await deliveredUnaccepted(w);
    const ret = await returnLegScheduled(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    const plan = await realPlan(w);
    const hooks = { deps: async () => w.deps, submit: async () => undefined };
    for (let i = 0; i < 2; i++) {
      await settleOrderDeliveryOnCancel({ rpc: async () => ({ data: null, error: null }) } as never, { plan, caller: staff, bookingId: 'bk-1', reason: 'hire ended early', bookingGroupId: GROUP }, hooks);
    }
    expect(w.repo.shipments.get(ret)?.status).toBe('scheduled');
    expect(staffAlerts(w).filter((a) => a === 'delivery_gear_with_renter_after_cancel')).toHaveLength(1);
  });

  it('no outbound leg with the renter: a scheduled return leg is still cancelled with the order (unchanged)', async () => {
    const w = world({ providers: 'manual' });
    const ret = await returnLegScheduled(w);
    const plan = await realPlan(w);
    expect(plan).toMatchObject({ shipmentIds: [ret] });
    expect(plan.gearWithRenter ?? false).toBe(false);
    expect(plan.returnKeptShipmentIds ?? []).toEqual([]);
  });
});

// ── 3. The legacy cancel path leaves its legs and quotes to staff; the sweep does too ──

describe('finding 3: what the legacy cancel path leaves for staff is never refunded by the sweep', () => {
  it('a paid unused quote is consumed and the order is put on hold for the sweep; nothing is refunded', async () => {
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW_OUT }, w.deps);
    if (!q.ok) throw new Error(q.code);
    const quoteId = q.quotes[0].id;
    await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quoteId], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
    w.bookings.setStatus(GROUP, 'cancelled');
    const rpcs: { name: string; args: unknown }[] = [];
    const db = { rpc: async (name: string, args: unknown) => (rpcs.push({ name, args }), { data: null, error: null }) };
    const plan: DeliveryCancellationPlan = { phase4: true, lastLine: true, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [quoteId] };
    const hooks = { deps: async () => w.deps, submit: async () => undefined };
    expect(await settleOrderDeliveryOnCancel(db as never, { plan, caller: renter, bookingId: 'bk-1', reason: 'x', bookingGroupId: GROUP, phase4AtCancel: false }, hooks)).toBe(0);
    expect(w.repo.quotes.get(quoteId)?.status).toBe('consumed');
    expect(rpcs).toContainEqual({ name: 'delivery_note_cancelled_order', args: { p_group: GROUP, p_hold: 'legacy_cancel' } });
    expect(staffAlerts(w)).toContain('delivery_legacy_cancel_has_phase4_delivery');
    // The next day's sweep: the quote is no longer paid, so even a stale plan finds nothing to refund.
    const sweepDb = {
      rpc: async (name: string) => ({ data: name === 'delivery_cancelled_orders_to_settle' ? [GROUP] : null, error: null }),
      from() {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'bk-1', status: 'cancelled' }], error: null }).then(resolve);
        return b;
      },
    };
    await sweepCancelledOrderDelivery(sweepDb as never, { limit: 10 }, hooks, async () => plan);
    expect(w.repo.refunds.size).toBe(0);
    expect(w.repo.quotes.get(quoteId)?.status).toBe('consumed');
  });
});

// ── 5. A leg the provider will not cancel does not clog the sweep ──────────────

describe('finding 5: the sweep records each attempt so a stuck order moves to the back of the queue', () => {
  it('every order it looks at is noted (the database orders by last attempt)', async () => {
    const rpcs: { name: string; args: unknown }[] = [];
    const db = {
      rpc: async (name: string, args: unknown) => (rpcs.push({ name, args }), { data: name === 'delivery_cancelled_orders_to_settle' ? ['g-1', 'g-2'] : null, error: null }),
      from() {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'bk-1', status: 'cancelled' }], error: null }).then(resolve);
        return b;
      },
    };
    const empty: DeliveryCancellationPlan = { phase4: true, lastLine: true, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [] };
    await sweepCancelledOrderDelivery(db as never, { limit: 10 }, { deps: async () => world().deps, submit: async () => undefined }, async () => empty);
    expect(rpcs.filter((r) => r.name === 'delivery_note_cancelled_order')).toEqual([
      { name: 'delivery_note_cancelled_order', args: { p_group: 'g-1', p_hold: null } },
      { name: 'delivery_note_cancelled_order', args: { p_group: 'g-2', p_hold: null } },
    ]);
  });
});
