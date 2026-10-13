/**
 * Phase 4 delivery, review fixes round 2. Each block names the finding it
 * covers. The money ones (1, 2, 4) were mutation-checked: undoing the fix
 * makes a test here fail. The staff cancellation route (finding 3) is in
 * delivery-review2-staff-cancel.test.ts; the database side of 2, 5 and 6 is in
 * lib/migrations/076-delivery.test.sql (14, 20, 21).
 */
import { describe, expect, it } from 'vitest';
import * as L from '@/lib/core/rental/ledger';
import { DELIVERY_CHECKOUT } from '@/lib/constants';
import { manualReference } from '@/lib/payments/routing';
import {
  checkRentalSettlement,
  closeDeliveryReview,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  deemDeliveryAccepted,
  deliveryFeeRefundKey,
  markDeliveryQuotesPaid,
  prepareDelivery,
  quoteDelivery,
  refundDeliveryFee,
  reportIncident,
} from '@/lib/core/delivery/use-cases';
import { dispatchDeliveryAfterPayment } from '@/lib/delivery/after-payment';
import { quoteCartDelivery, studioDay, utcOffsetMs } from '@/lib/delivery/checkout';
import { SupabaseDeliveryJobQueries } from '@/lib/delivery/jobs';
import { chargeOfBooking } from '@/lib/rental/charges';
import {
  returnCollectedAt,
  settleAfterLineCancelled,
  settleOrderDeliveryOnCancel,
  sweepCancelledOrderDelivery,
  usesPhase4Delivery,
  type DeliveryCancellationPlan,
} from '@/lib/rental/delivery-settlement';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, STAFF, world, type World } from './helpers/delivery-fakes';
import { checkoutWorld, type CheckoutWorld } from './helpers/delivery-checkout-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const system = { kind: 'system' as const };
const WINDOW_OUT = { start: '2026-10-20T06:00:00.000Z', end: '2026-10-20T10:00:00.000Z' };
const WINDOW_BACK = { start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T15:00:00.000Z' };
const photo = (ref: string) => [{ kind: 'photo' as const, ref: `https://res.cloudinary.com/demo/${ref}.jpg` }];
const staffAlerts = (w: World): string[] => [...w.repo.outbox.values()].filter((n) => n.userId === 'staff').map((n) => String((n.data as { what?: string } | undefined)?.what));

// ── A tiny PostgREST stand-in: rows per table, filters applied in memory ─────

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, rpc: Record<string, unknown> = {}) {
  const calls: { table: string; filters: string[] }[] = [];
  return {
    calls,
    rpc: async (name: string) => ({ data: rpc[name] ?? null, error: null }),
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const filters: string[] = [];
      calls.push({ table, filters });
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.limit = (n: number) => {
        rows = rows.slice(0, n);
        return b;
      };
      b.eq = (col: string, v: unknown) => {
        filters.push(`${col}=${String(v)}`);
        rows = rows.filter((r) => r[col] === v);
        return b;
      };
      b.in = (col: string, vs: unknown[]) => {
        filters.push(`${col} in ${vs.join(',')}`);
        rows = rows.filter((r) => vs.includes(r[col]));
        return b;
      };
      b.not = (col: string, op: string, v: string) => {
        const vs = v.replace(/[()]/g, '').split(',');
        rows = rows.filter((r) => !(op === 'in' ? vs.includes(String(r[col])) : r[col] === v));
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
      return b;
    },
  };
}

/** Quotes taken at checkout and tied to the order (as the checkout route does). */
async function checkoutOrder(w: CheckoutWorld) {
  const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: LINES_FOR_QUOTE, legs: [{ leg: 'outbound', window: WINDOW_OUT }] }, w.deps);
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
  return { quote, shipmentId: p.shipment.id, fee: quote.customerFeeCents };
}

async function deliverAll(w: World, shipmentId: string) {
  for (const i of w.repo.shipments.get(shipmentId)!.items) {
    expect((await confirmHandover({ caller: staff, shipmentId, bookingId: i.bookingId, rentalId: i.rentalId, evidence: photo(`d-${i.rentalId}`), outcome: 'delivered' }, w.deps)).ok).toBe(true);
  }
}

const groupJournals = (w: World) => [...w.repo.journals.values()].filter((j) => j.bookingGroupId === GROUP);

// ── 1. Double fee refund through a payment replay ───────────────────────────

describe('finding 1: a fee is never refunded twice when after-payment never marked the quotes', () => {
  it('(b) any linked quote that was not superseded means Phase 4 money rules, an unmarked active one included', async () => {
    const db = fakeDb({ delivery_shipments: [], delivery_quotes: [{ id: 'q1', booking_group_id: GROUP, status: 'active' }] });
    expect(await usesPhase4Delivery(db as never, GROUP)).toBe(true);
    const superseded = fakeDb({ delivery_shipments: [], delivery_quotes: [{ id: 'q1', booking_group_id: GROUP, status: 'superseded' }] });
    expect(await usesPhase4Delivery(superseded as never, GROUP)).toBe(false);
  });

  it('(c) a replay on an order whose every line is cancelled stops with a staff alert: no mark, no refund', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    // Payment confirmed, but the first after-payment run never got to mark the quotes; then the order is cancelled.
    w.bookings.setStatus(GROUP, 'cancelled');
    for (let i = 0; i < 2; i++) {
      const r = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links });
      expect(r).toEqual({ outcome: 'order_cancelled' });
    }
    expect(w.repo.refunds.size).toBe(0);
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('active');
    expect(staffAlerts(w)).toContain('delivery_after_payment_order_cancelled');
  });

  it('(c) markDeliveryQuotesPaid refuses an order whose lines are all cancelled (except for the cancellation’s own refund)', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    const input = { paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quotes[0].id], paidDeliveryCents: totalCents };
    expect(await markDeliveryQuotesPaid(input, w.deps)).toMatchObject({ ok: false, code: 'order_cancelled' });
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('active');
    expect(await markDeliveryQuotesPaid({ ...input, forCancelledOrderRefund: true }, w.deps)).toEqual({ ok: true, marked: 1 });
  });

  it('(a) cancelled under the legacy rules (fee refunded with the hire): linked quotes are superseded, never refunded; a replay finds nothing', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    const before: DeliveryCancellationPlan = { phase4: false, lastLine: false, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [] };
    // Read after the commit: the quote is there now (linked between the plan and the cancel).
    const after: DeliveryCancellationPlan = { ...before, phase4: true, lastLine: true, unmarkedQuoteIds: [quotes[0].id], onlineQuoteIds: [quotes[0].id], paidDeliveryCents: totalCents };
    const refunded = await settleAfterLineCancelled(fakeDb({}) as never, { before, bookingGroupId: GROUP, bookingId: 'bk-1', caller: renter, reason: 'cancelled' }, async () => after, { deps: async () => w.deps, submit: async () => undefined });
    expect(refunded).toBe(0);
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('superseded');
    expect(w.repo.refunds.size).toBe(0);
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links })).toEqual({ outcome: 'no_delivery' });
    expect(w.repo.refunds.size).toBe(0);
  });

  it('cancelled under Phase 4 rules: charged quotes nobody marked are refunded once with the order; replays add nothing', async () => {
    const w = checkoutWorld();
    const { quotes, totalCents } = await checkoutOrder(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    const plan: DeliveryCancellationPlan = {
      phase4: true,
      lastLine: true,
      shipmentIds: [],
      tooLate: false,
      feeCents: totalCents,
      courierBooked: false,
      unusedPaidQuoteIds: [],
      unmarkedQuoteIds: [quotes[0].id],
      onlineQuoteIds: [quotes[0].id],
      paidDeliveryCents: totalCents,
    };
    const hooks = { deps: async () => w.deps, submit: async () => undefined };
    expect(await settleAfterLineCancelled(fakeDb({}) as never, { before: plan, bookingGroupId: GROUP, bookingId: 'bk-1', caller: renter, reason: 'cancelled' }, async () => plan, hooks)).toBe(totalCents);
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('refunded');
    expect(w.repo.refunds.get(deliveryFeeRefundKey(`quote-${quotes[0].id}`))?.amountCents).toBe(totalCents);
    // The replay of the payment (webhook duplicate, recovery) and a second settlement: nothing more.
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links })).toEqual({ outcome: 'order_cancelled' });
    expect(await settleAfterLineCancelled(fakeDb({}) as never, { before: plan, bookingGroupId: GROUP, bookingId: 'bk-1', caller: renter, reason: 'again' }, async () => plan, hooks)).toBe(0);
    expect(w.repo.refunds.size).toBe(1);
  });

  it('an order that was never paid online: unmarked quotes are superseded, nothing is refunded', async () => {
    const w = checkoutWorld();
    const { quotes } = await checkoutOrder(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    w.bookings.groups.get(GROUP)!.paymentVerified = false;
    const plan: DeliveryCancellationPlan = { phase4: true, lastLine: true, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [], unmarkedQuoteIds: [quotes[0].id], paidDeliveryCents: null };
    expect(await settleOrderDeliveryOnCancel(fakeDb({}) as never, { plan, caller: renter, bookingId: 'bk-1', reason: 'x', bookingGroupId: GROUP }, { deps: async () => w.deps, submit: async () => undefined })).toBe(0);
    expect(w.repo.quotes.get(quotes[0].id)?.status).toBe('superseded');
    expect(w.repo.refunds.size).toBe(0);
  });
});

// ── 2. The refund cap and chargeOfBooking see the whole order ───────────────

describe('finding 2: refunds are counted for the ORDER, whichever reference they were filed under', () => {
  const intent = { checkout_group_id: GROUP, state: 'paid', expected_amount_cents: 300_000, reference: GROUP, provider_transaction_id: '5123456789' };
  const booking = { id: 'bk-1', checkout_group_id: GROUP, payfast_payment_id: '5123456789' };

  it('chargeOfBooking counts delivery refunds (intent reference) with hire and staff refunds (transaction id), each once', async () => {
    const db = fakeDb({
      rental_payment_intents: [intent],
      refund_obligations: [
        { id: 'ob-hire', amount_cents: 100_000, state: 'processed', transaction_reference: '5123456789', booking_group_id: GROUP, from_unallocated: false },
        { id: 'ob-delivery', amount_cents: 12_000, state: 'eligible', transaction_reference: GROUP, booking_group_id: GROUP, from_unallocated: false },
        // Money that arrived apart from the order's charge is refunded from its own payment.
        { id: 'ob-stray', amount_cents: 50_000, state: 'eligible', transaction_reference: '5999', booking_group_id: GROUP, from_unallocated: true },
      ],
    });
    expect(await chargeOfBooking(db as never, booking)).toEqual({ totalCents: 300_000, remainderCents: 300_000 - 100_000 - 12_000 });
  });

  it('a delivery refund filed only under the intent reference (no order id on it) still counts', async () => {
    const db = fakeDb({
      rental_payment_intents: [intent],
      refund_obligations: [{ id: 'ob-d', amount_cents: 12_000, state: 'eligible', transaction_reference: GROUP, booking_group_id: null, from_unallocated: false }],
    });
    expect((await chargeOfBooking(db as never, booking)).remainderCents).toBe(288_000);
  });

  it('a delivery refund filed only against the order (no matching reference) still counts', async () => {
    const db = fakeDb({
      rental_payment_intents: [intent],
      refund_obligations: [{ id: 'ob-x', amount_cents: 7_000, state: 'eligible', transaction_reference: 'other-ref', booking_group_id: GROUP, from_unallocated: false }],
    });
    expect((await chargeOfBooking(db as never, booking)).remainderCents).toBe(293_000);
  });
});

// ── 4. Refunding a fee that was already earned ──────────────────────────────

describe('finding 4: a refund of an EARNED fee reverses the income, never unearned hire twice', () => {
  it('accepted (earned), then lost under review and closed as failed with a refund: the ledger balances', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await paidOutbound(w);
    // The payment put the fee in unearned hire.
    await w.repo.post([L.paymentCaptured({ providerReference: 'pay-ref-1', bookingGroupId: GROUP, hireCents: 0, depositCents: 0, deliveryFeeCents: fee })], []);
    await deliverAll(w, shipmentId);
    for (const i of w.repo.shipments.get(shipmentId)!.items) await confirmHandover({ caller: renter, shipmentId, bookingId: i.bookingId, rentalId: i.rentalId, evidence: [], outcome: 'accepted' }, w.deps);
    expect(w.repo.journals.has(`delivery:${GROUP}:outbound`)).toBe(true);
    // Later the renter says a lens was missing after all; staff look into it and refund the fee.
    expect((await reportIncident({ caller: staff, shipmentId, kind: 'lost', description: 'lens missing from the case' }, w.deps)).ok).toBe(true);
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('incident_under_review');
    const r = await closeDeliveryReview({ caller: staff, shipmentId, to: 'failed', reason: 'renter never had the lens', refundFee: true }, w.deps);
    expect(r).toMatchObject({ ok: true, refundCents: fee });
    const b = L.balances(groupJournals(w));
    // Unearned hire held the fee once and released it once; the income was reversed; the fee is owed back.
    expect(b.unearned_hire).toBe(0);
    expect(b.delivery_income).toBe(0);
    expect(b.refunds_payable).toBe(-fee);
    expect(w.repo.refunds.get(deliveryFeeRefundKey(shipmentId))?.amountCents).toBe(fee);
  });

  it('not earned yet: the refund still releases unearned hire (unchanged)', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await paidOutbound(w);
    await w.repo.post([L.paymentCaptured({ providerReference: 'pay-ref-1', bookingGroupId: GROUP, hireCents: 0, depositCents: 0, deliveryFeeCents: fee })], []);
    await deliverAll(w, shipmentId);
    await reportIncident({ caller: staff, shipmentId, kind: 'lost', description: 'never arrived' }, w.deps);
    await closeDeliveryReview({ caller: staff, shipmentId, to: 'failed', reason: 'lost by the driver', refundFee: true }, w.deps);
    const b = L.balances(groupJournals(w));
    expect(b.unearned_hire).toBe(0);
    expect(b.delivery_income).toBe(0);
    expect(b.refunds_payable).toBe(-fee);
  });

  it('a fee already refunded (refundDeliveryFee) is not refunded again when the review closes', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    await reportIncident({ caller: staff, shipmentId, kind: 'damaged', description: 'body cracked' }, w.deps);
    expect(await refundDeliveryFee({ caller: staff, shipmentId, reason: 'goodwill' }, w.deps)).toMatchObject({ ok: true, outcome: 'refunded', refundCents: fee });
    expect(await refundDeliveryFee({ caller: staff, shipmentId, reason: 'again' }, w.deps)).toMatchObject({ ok: true, outcome: 'already_refunded', refundCents: 0 });
    expect(await closeDeliveryReview({ caller: staff, shipmentId, to: 'failed', reason: 'written off', refundFee: true }, w.deps)).toMatchObject({ ok: true, refundCents: 0 });
    expect([...w.repo.journals.keys()].filter((k) => k.startsWith('delivery-cancel:'))).toHaveLength(1);
    expect(w.repo.refunds.size).toBe(1);
  });

  it('deliveryEarnedRefund moves income to refunds payable, keyed like deliveryCancelled', () => {
    const j = L.deliveryEarnedRefund({ shipmentId: 's1', bookingGroupId: GROUP, refundCents: 5_000 });
    expect(j.idempotencyKey).toBe(L.deliveryCancelled({ shipmentId: 's1', bookingGroupId: GROUP, customerFeeCents: 5_000, refundCents: 5_000 }).idempotencyKey);
    expect(L.isBalanced(j)).toBe(true);
    expect(() => L.deliveryEarnedRefund({ shipmentId: 's1', bookingGroupId: GROUP, refundCents: 0 })).toThrow();
  });
});

// ── 5. Closing a review as delivered is a decision; the deemed queue skips held legs ──

describe('finding 5: close_review → delivered records the renter has the gear; held legs never clog the deemed queue', () => {
  async function underReviewAfterException(w: World) {
    const { shipmentId, fee } = await paidOutbound(w);
    await deliverAll(w, shipmentId);
    const [cam] = w.repo.shipments.get(shipmentId)!.items;
    const ex = await confirmHandover({ caller: renter, shipmentId, bookingId: cam.bookingId, rentalId: cam.rentalId, evidence: [], outcome: 'exception', discrepancies: ['strap missing'] }, w.deps);
    expect(ex.ok).toBe(true);
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('incident_under_review');
    return { shipmentId, fee };
  }

  it('without the decision it is refused; with it every item is settled as received, acceptedAt is set and the fee is earned once', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await underReviewAfterException(w);
    expect(await closeDeliveryReview({ caller: staff, shipmentId, to: 'delivered', reason: 'strap found in the bag' }, w.deps)).toMatchObject({ ok: false, code: 'decision_required' });
    const r = await closeDeliveryReview({ caller: staff, shipmentId, to: 'delivered', reason: 'strap found in the bag', confirmReceived: true }, w.deps);
    expect(r).toMatchObject({ ok: true, outcome: 'closed' });
    const s = w.repo.shipments.get(shipmentId)!;
    expect(s.status).toBe('delivered');
    expect(s.acceptedAt).not.toBeNull();
    const decisions = w.repo.custody.filter((c) => c.shipmentId === shipmentId && c.kind === 'staff_confirmed_received');
    expect(decisions).toHaveLength(2);
    expect(decisions.every((c) => c.actor.kind === 'thabangvision_staff' && c.condition === 'strap found in the bag')).toBe(true);
    expect(w.repo.journals.get(`delivery:${GROUP}:outbound`)?.lines.find((l) => l.account === 'delivery_income')?.creditCents).toBe(fee);
    // Nothing left for the deemed-acceptance job.
    w.clock.advanceMinutes(60 * 24 * 5);
    expect(await deemDeliveryAccepted({ caller: system, shipmentId }, w.deps)).toEqual({ ok: true, outcome: 'not_applicable' });
  });

  it('the daily list asks the database for deemable legs only (exclusion before the limit)', async () => {
    const asked: { name: string; args: unknown }[] = [];
    const db = { rpc: async (name: string, args: unknown) => (asked.push({ name, args }), { data: ['s-ok'], error: null }) };
    expect(await new SupabaseDeliveryJobQueries(db as never).listAwaitingAcceptance('2026-10-10T00:00:00.000Z', 1)).toEqual([{ shipmentId: 's-ok' }]);
    expect(asked).toEqual([{ name: 'delivery_list_awaiting_acceptance', args: { p_delivered_before: '2026-10-10T00:00:00.000Z', p_limit: 1 } }]);
  });
});

// ── 6. Two cancellations racing: settle after the commit, and the daily sweep ──

describe('finding 6: the last-line race settles once', () => {
  it('both cancellations saw the other line open before acting; after the commit each re-reads, the fee is refunded once', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await paidOutbound(w);
    w.bookings.setStatus(GROUP, 'cancelled');
    const before: DeliveryCancellationPlan = { phase4: true, lastLine: false, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [] };
    const after: DeliveryCancellationPlan = { ...before, lastLine: true, shipmentIds: [shipmentId], feeCents: fee };
    const hooks = { deps: async () => w.deps, submit: async () => undefined };
    const [a, b] = await Promise.all([
      settleAfterLineCancelled(fakeDb({}) as never, { before, bookingGroupId: GROUP, bookingId: 'bk-1', caller: renter, reason: 'cancel 1' }, async () => after, hooks),
      settleAfterLineCancelled(fakeDb({}) as never, { before, bookingGroupId: GROUP, bookingId: 'bk-2', caller: renter, reason: 'cancel 2' }, async () => after, hooks),
    ]);
    expect(a + b).toBe(fee);
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('cancelled');
    expect(w.repo.refunds.size).toBe(1);
    expect(staffAlerts(w).filter((x) => x.startsWith('delivery_cancel_failed'))).toEqual([]);
  });

  it('the daily sweep settles a fully cancelled order that still holds a cancellable leg, once', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId, fee } = await paidOutbound(w);
    const db = fakeDb({ equipment_bookings: [{ id: 'bk-1', status: 'cancelled', checkout_group_id: GROUP }, { id: 'bk-2', status: 'cancelled', checkout_group_id: GROUP }] }, { delivery_cancelled_orders_to_settle: [GROUP] });
    const plan: DeliveryCancellationPlan = { phase4: true, lastLine: true, shipmentIds: [shipmentId], tooLate: false, feeCents: fee, courierBooked: false, unusedPaidQuoteIds: [] };
    const hooks = { deps: async () => w.deps, submit: async () => undefined };
    expect(await sweepCancelledOrderDelivery(db as never, { limit: 10 }, hooks, async () => plan)).toEqual({ checked: 1, settled: 1, refundCents: fee });
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('cancelled');
    // Next day: already settled.
    const cancelledPlan = { ...plan, shipmentIds: [] };
    expect(await sweepCancelledOrderDelivery(db as never, { limit: 10 }, hooks, async () => cancelledPlan)).toEqual({ checked: 1, settled: 0, refundCents: 0 });
    expect(w.repo.refunds.size).toBe(1);
  });

  it('the sweep never touches an order with a line still open', async () => {
    const w = world({ providers: 'manual' });
    const { shipmentId } = await paidOutbound(w);
    const db = fakeDb({ equipment_bookings: [{ id: 'bk-1', status: 'cancelled', checkout_group_id: GROUP }, { id: 'bk-2', status: 'confirmed', checkout_group_id: GROUP }] }, { delivery_cancelled_orders_to_settle: [GROUP] });
    const plan: DeliveryCancellationPlan = { phase4: true, lastLine: true, shipmentIds: [shipmentId], tooLate: false, feeCents: 1, courierBooked: false, unusedPaidQuoteIds: [] };
    expect(await sweepCancelledOrderDelivery(db as never, { limit: 10 }, { deps: async () => w.deps, submit: async () => undefined }, async () => plan)).toMatchObject({ settled: 0 });
    expect(w.repo.shipments.get(shipmentId)?.status).toBe('scheduled');
  });
});

// ── 7. Hand-paid quotes and the online amount check ─────────────────────────

describe('finding 7: a quote paid by hand is not part of the online payment', () => {
  it('a replay with a hand-paid return pickup linked to the order raises no amount mismatch', async () => {
    const w = checkoutWorld();
    const { totalCents } = await checkoutOrder(w);
    // A return pickup the renter asked for during the hire, paid by EFT and confirmed by staff.
    const ret = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: WINDOW_BACK }, w.deps);
    if (!ret.ok) throw new Error(ret.code);
    await w.repo.setQuoteStatus(ret.quotes[0].id, ['active'], 'paid', { paidReference: manualReference('eft', 'EFT-1'), bookingGroupId: GROUP });
    const r = await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: totalCents }, { delivery: w.deps, links: w.links });
    expect(r).toMatchObject({ outcome: 'done' });
    expect(staffAlerts(w)).not.toContain('delivery_amount_mismatch');
  });
});

// ── 8. Who can end the renter's possession on a return ──────────────────────

describe('finding 8: only a courier or our staff stop the late-fee clock', () => {
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

  it('a renter recording their own handover is kept, but returnCollectedAt stays empty', async () => {
    const w = world({ providers: 'manual' });
    const shipmentId = await returnLeg(w);
    const r = await confirmCollection({ caller: renter, shipmentId, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo('self'), occurredAt: '2026-10-22T09:00:00.000Z' }, w.deps);
    expect(r.ok).toBe(true);
    expect(w.repo.custody.some((c) => c.kind === 'handed_to_return_courier' && c.actor.kind === 'renter')).toBe(true);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).returnCollectedAt).toBeNull();
    // Our driver's collection does count.
    await confirmCollection({ caller: staff, shipmentId, bookingId: 'bk-1', rentalId: 'cam-1', evidence: photo('driver'), occurredAt: '2026-10-22T11:00:00.000Z' }, w.deps);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).returnCollectedAt).toBe('2026-10-22T11:00:00.000Z');
  });

  it('the overdue ladder’s lookup only reads courier and staff records', async () => {
    const db = fakeDb({
      delivery_custody_events: [
        { booking_id: 'bk-1', shipment_id: 'ret-1', occurred_at: '2026-10-22T09:00:00.000Z', kind: 'handed_to_return_courier', actor_kind: 'renter' },
        { booking_id: 'bk-2', shipment_id: 'ret-1', occurred_at: '2026-10-22T11:00:00.000Z', kind: 'collected_by_courier', actor_kind: 'courier' },
      ],
      delivery_shipments: [{ id: 'ret-1', leg: 'return', status: 'collected' }],
    });
    expect([...(await returnCollectedAt(db as never, ['bk-1', 'bk-2'])).entries()]).toEqual([['bk-2', '2026-10-22T11:00:00.000Z']]);
  });
});

// ── 9. The studio day comes from the configured offset ──────────────────────

describe('finding 9: the delivery day uses DELIVERY_CHECKOUT.utcOffset', () => {
  it('parses offsets and applies them', () => {
    expect(utcOffsetMs('+02:00')).toBe(7_200_000);
    expect(utcOffsetMs('-05:30')).toBe(-19_800_000);
    expect(() => utcOffsetMs('2')).toThrow();
    expect(studioDay('2026-10-09T23:30:00.000Z', '+02:00')).toBe('2026-10-10');
    expect(studioDay('2026-10-09T23:30:00.000Z', '+00:00')).toBe('2026-10-09');
    expect(studioDay('2026-10-09T23:30:00.000Z')).toBe(studioDay('2026-10-09T23:30:00.000Z', DELIVERY_CHECKOUT.utcOffset));
  });
});
