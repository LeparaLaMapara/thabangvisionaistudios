import { createAdminClient } from '@/lib/supabase/server';
import type { DeliveryDeps, DeliveryRepository } from '@/lib/core/delivery/repository';
import {
  cancelDelivery,
  checkRentalSettlement,
  deliveryFeeRefundKey,
  isManualPaymentReference,
  markDeliveryQuotesPaid,
  refundDeliveryFee,
  refundUnusedDeliveryQuote,
  type DeliveryCaller,
  type SettlementCheck,
} from '@/lib/core/delivery/use-cases';
import { POSSESSION_ENDING_ACTORS } from '@/lib/core/delivery/custody';
import { CANCELLABLE_STATES, FINAL_DELIVERY_STATES, IN_COURIER_CUSTODY } from '@/lib/core/delivery/state';
import { buildNotices } from '@/lib/core/rental/notifications';
import { toCents } from '@/lib/core/pricing/money';
import { isMissingPipeline } from './repos';

/**
 * Where the gear-hire money paths meet Phase 4 delivery (risk register R-39,
 * R-40). Used by take-back, dispute settlement, owner payout eligibility and
 * cancellation.
 *
 * R-39: an order that uses Phase 4 delivery (it has shipment legs, or ANY
 * delivery quote linked to it that was not superseded) earns its delivery fee
 * per leg through the delivery use cases. The legacy order-level
 * `deliveryEarned({ bookingGroupId })` journal must not be posted for it, or
 * the fee is earned twice. Orders without Phase 4 delivery keep the legacy
 * behaviour unchanged.
 *
 * R-40: settlement (deposit, owner payout) waits for checkRentalSettlement:
 * an open delivery incident holds it (D29), a courier collection never
 * releases a deposit (D17, every returned item must be inspected), and a
 * provider-caused or unattributed delay stops an automatic late fee (D19).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Linked quote statuses that are part of the order's money (a superseded quote never was). */
const ORDER_QUOTE_STATUSES = ['active', 'expired', 'paid', 'consumed', 'refunded'] as const;

/**
 * Whether this order uses Phase 4 delivery: it has shipment legs, or any
 * delivery quote linked to it that was not superseded (review fix round 2,
 * finding 1). A linked quote that is still `active` because the after-payment
 * step never marked it paid (a crash or a timeout) still means the order's
 * delivery fee follows the Phase 4 rules: it is settled per leg or quote,
 * never refunded with the hire. Throws when it cannot tell (callers fail closed).
 */
export async function usesPhase4Delivery(db: Admin, bookingGroupId: string | null): Promise<boolean> {
  if (!bookingGroupId) return false;
  const [ships, quotes] = await Promise.all([
    db.from('delivery_shipments').select('id').eq('booking_group_id', bookingGroupId).limit(1),
    db.from('delivery_quotes').select('id').eq('booking_group_id', bookingGroupId).in('status', [...ORDER_QUOTE_STATUSES]).limit(1),
  ]);
  for (const r of [ships, quotes]) {
    if (r.error && !isMissingPipeline(r.error)) throw new Error(`delivery lookup failed: ${r.error.message}`);
  }
  return (ships.data ?? []).length > 0 || (quotes.data ?? []).length > 0;
}

/** Nothing about delivery stands in the way. */
export const NO_DELIVERY_HOLD: SettlementCheck = { allowed: true, reasons: [], lateFeeAutoCharge: true, returnCollectedAt: null };

/**
 * checkRentalSettlement for one booking line. A line outside any order, or an
 * order before migration 076, has no delivery and is not held. Throws when the
 * delivery records cannot be read (callers fail closed).
 */
export async function deliverySettlement(
  input: { bookingGroupId: string | null; bookingId: string },
  repo?: Pick<DeliveryRepository, 'listShipments' | 'listIncidents' | 'listCustody'>,
): Promise<SettlementCheck> {
  if (!input.bookingGroupId) return NO_DELIVERY_HOLD;
  const r = repo ?? new (await import('@/lib/delivery/repos')).SupabaseDeliveryRepository();
  return checkRentalSettlement({ bookingGroupId: input.bookingGroupId, bookingId: input.bookingId }, { repo: r as DeliveryRepository });
}

/**
 * When a return pickup took each booking line's gear from the renter
 * (`collected_by_courier` / `handed_to_return_courier` on a return leg that is
 * not cancelled, failed or returning to the renter). The renter gave the gear
 * back at that moment: the overdue ladder stops escalating and late fees are
 * counted to it (D-49). Only events recorded by the courier (the provider's
 * own confirmation) or by our staff count: a renter recording their own
 * handover never stops the clock (review fix round 2, finding 8). Lines
 * without such a record are absent. Empty before migration 076. Throws on any
 * other failure.
 */
export async function returnCollectedAt(db: Admin, bookingIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (bookingIds.length === 0) return out;
  const { data: custody, error } = await db
    .from('delivery_custody_events')
    .select('booking_id, shipment_id, occurred_at')
    .in('booking_id', [...bookingIds])
    .in('kind', ['collected_by_courier', 'handed_to_return_courier'])
    .in('actor_kind', [...POSSESSION_ENDING_ACTORS]);
  if (error) {
    if (isMissingPipeline(error)) return out;
    throw new Error(`return collection lookup failed: ${error.message}`);
  }
  const rows = (custody ?? []) as { booking_id: string; shipment_id: string; occurred_at: string }[];
  if (rows.length === 0) return out;
  const { data: legs, error: legErr } = await db
    .from('delivery_shipments')
    .select('id')
    .in('id', [...new Set(rows.map((r) => r.shipment_id))])
    .eq('leg', 'return')
    .not('status', 'in', '(cancelled,failed,return_to_sender)');
  if (legErr) throw new Error(`return legs lookup failed: ${legErr.message}`);
  const live = new Set(((legs ?? []) as { id: string }[]).map((l) => l.id));
  for (const r of rows) {
    if (!live.has(r.shipment_id)) continue;
    const prev = out.get(r.booking_id);
    if (!prev || r.occurred_at < prev) out.set(r.booking_id, r.occurred_at);
  }
  return out;
}

/** Plain words for staff, per hold reason. */
export function settlementHoldMessage(reasons: readonly string[]): string {
  const parts = reasons.map((r) =>
    r === 'open_delivery_incident'
      ? 'a delivery incident on this item is still open'
      : r.includes('inspect')
        ? 'the item has not been received back and inspected on its return delivery (if it came back in person, cancel the return pickup)'
        : r.replace(/_/g, ' '),
  );
  return `The deposit cannot be settled yet: ${[...new Set(parts)].join('; ')}. Resolve it in the delivery console first.`;
}

export interface DeliveryCancellationPlan {
  /** The order uses Phase 4 delivery: its fee is refunded per leg (cancelDelivery), not with the hire. */
  phase4: boolean;
  /** This is the order's last line still booked, so its delivery legs go with it. */
  lastLine: boolean;
  /** Live legs that can still be cancelled (nothing has moved): cancelled through the core when the last line goes. */
  shipmentIds: string[];
  /**
   * The RENTER's rule: a live leg is past the point where it can be cancelled
   * (anything outside the cancellable states, delivered included). The renter
   * cannot cancel online; staff can (see `inMotion`).
   */
  tooLate: boolean;
  /**
   * The STAFF rule (review fix round 2, finding 3): a leg is actually in
   * motion, the gear in a courier's or our driver's hands. Only this blocks a
   * staff cancellation. Absent (an older caller): read as `tooLate` (fail closed).
   */
  inMotion?: boolean;
  /**
   * Live legs a staff cancellation leaves as they are: delivered, lost,
   * damaged or under review. Their fee follows D-39/D-52: an outbound leg
   * that reached the renter keeps its fee unless staff explicitly refund it.
   */
  keptShipmentIds?: string[];
  /** Paid delivery fees on the cancellable legs, unused paid quotes and charged unmarked quotes, in cents: refunded in full unless a courier was already booked (D-39). */
  feeCents: number;
  /** A courier job is booked on one of them: its cancellation fee may be passed on at cost, capped at the fee (D-39). */
  courierBooked: boolean;
  /** Paid quotes no leg was ever made from (after-payment prepare refused them): refunded with the order. */
  unusedPaidQuoteIds: string[];
  /**
   * Linked quotes still `active`/`expired` with no leg made from them (the
   * after-payment step never marked them, finding 1). On an order whose
   * payment was verified they were charged: marked and refunded with the
   * order. Otherwise nothing was paid: they are superseded.
   */
  unmarkedQuoteIds?: string[];
  /** Every linked quote the online payment covered (not superseded, not paid by hand): the amount check for marking them. */
  onlineQuoteIds?: string[];
  /** The delivery cents of the order's verified (paid) payment intent, or null when it is not paid online. */
  paidDeliveryCents?: number | null;
}

/**
 * What cancelling this booking line means for its order's delivery (D-39).
 * Call it before the cancellation (to refuse a renter's cancellation of gear
 * on its way, or a staff one of gear in motion) AND again after it committed:
 * the second read sees what concurrent cancellations did (finding 6).
 * Throws when the records cannot be read (callers fail closed).
 */
export async function deliveryCancellationPlan(
  db: Admin,
  input: { bookingGroupId: string | null; bookingId: string },
  repo?: Pick<DeliveryRepository, 'listShipments'>,
): Promise<DeliveryCancellationPlan> {
  const none: DeliveryCancellationPlan = {
    phase4: false,
    lastLine: false,
    shipmentIds: [],
    tooLate: false,
    inMotion: false,
    keptShipmentIds: [],
    feeCents: 0,
    courierBooked: false,
    unusedPaidQuoteIds: [],
    unmarkedQuoteIds: [],
    onlineQuoteIds: [],
    paidDeliveryCents: null,
  };
  if (!input.bookingGroupId) return none;
  if (!(await usesPhase4Delivery(db, input.bookingGroupId))) return none;
  const { data: lines, error } = await db.from('equipment_bookings').select('id, status').eq('checkout_group_id', input.bookingGroupId);
  if (error) throw new Error(`order lines lookup failed: ${error.message}`);
  const lastLine = !((lines ?? []) as { id: string; status: string }[]).some((l) => l.id !== input.bookingId && l.status !== 'cancelled');
  if (!lastLine) return { ...none, phase4: true };
  const r = repo ?? new (await import('@/lib/delivery/repos')).SupabaseDeliveryRepository(db);
  const all = await r.listShipments(input.bookingGroupId);
  const live = all.filter((s) => !FINAL_DELIVERY_STATES.includes(s.status));
  const cancellable = live.filter((s) => CANCELLABLE_STATES.includes(s.status));
  const moving = live.filter((s) => IN_COURIER_CUSTODY.includes(s.status));
  const kept = live.filter((s) => !CANCELLABLE_STATES.includes(s.status) && !IN_COURIER_CUSTODY.includes(s.status));
  const used = new Set(all.map((s) => s.quoteId));
  const [paidQ, openQ, orderQ, intentQ] = await Promise.all([
    // A paid quote with no leg made from it (after-payment prepare refused it):
    // its fee would otherwise be lost when the order goes.
    db.from('delivery_quotes').select('id, customer_fee_cents').eq('booking_group_id', input.bookingGroupId).eq('status', 'paid'),
    // A linked quote never marked paid (the after-payment step did not run to the end).
    db.from('delivery_quotes').select('id, customer_fee_cents, paid_reference').eq('booking_group_id', input.bookingGroupId).in('status', ['active', 'expired']),
    db.from('delivery_quotes').select('id, paid_reference').eq('booking_group_id', input.bookingGroupId).in('status', [...ORDER_QUOTE_STATUSES]),
    db.from('rental_payment_intents').select('state, delivery_cents').eq('checkout_group_id', input.bookingGroupId).limit(1),
  ]);
  for (const q of [paidQ, openQ, orderQ, intentQ]) {
    if (q.error && !isMissingPipeline(q.error)) throw new Error(`delivery quotes lookup failed: ${q.error.message}`);
  }
  type QuoteRow = { id: string; customer_fee_cents?: number | null; paid_reference?: string | null };
  const unused = ((paidQ.data ?? []) as QuoteRow[]).filter((q) => !used.has(q.id));
  const unusedIds = new Set(unused.map((q) => q.id));
  const unmarked = ((openQ.data ?? []) as QuoteRow[]).filter((q) => !used.has(q.id) && !unusedIds.has(q.id));
  const intent = ((intentQ.data ?? []) as { state?: string; delivery_cents?: number | null }[])[0];
  const paidDeliveryCents = intent?.state === 'paid' ? Number(intent.delivery_cents ?? 0) : null;
  const fee = (qs: readonly QuoteRow[]): number => qs.reduce((n, q) => n + Number(q.customer_fee_cents ?? 0), 0);
  return {
    phase4: true,
    lastLine: true,
    shipmentIds: cancellable.map((s) => s.id),
    tooLate: live.some((s) => !CANCELLABLE_STATES.includes(s.status)),
    inMotion: moving.length > 0,
    keptShipmentIds: kept.map((s) => s.id),
    feeCents: cancellable.filter((s) => s.paidReference).reduce((n, s) => n + s.customerFeeCents, 0) + fee(unused) + (paidDeliveryCents !== null ? fee(unmarked) : 0),
    courierBooked: cancellable.some((s) => s.providerKind === 'courier' && !!s.providerReference),
    unusedPaidQuoteIds: unused.map((q) => q.id),
    unmarkedQuoteIds: unmarked.map((q) => q.id),
    onlineQuoteIds: ((orderQ.data ?? []) as QuoteRow[]).filter((q) => !isManualPaymentReference(q.paid_reference)).map((q) => q.id),
    paidDeliveryCents,
  };
}

/**
 * The order's last line was cancelled: cancel its cancellable delivery legs
 * and refund paid quotes no leg was made from, each through the core (one
 * refund obligation per leg or quote, capped in the database at what is left
 * of the charge), then submit the obligations at once (the daily pipeline
 * retries them, never twice). A leg that cannot be cancelled is alerted to
 * staff; the booking stays cancelled. Never throws. Returns the delivery
 * refund in cents.
 *
 * Review fix round 2:
 *  - finding 1: `phase4AtCancel` is what the plan said BEFORE the line was
 *    cancelled, i.e. which money rules the hire refund used. Under the legacy
 *    rules the line's delivery fee was refunded with the hire, so linked
 *    quotes are only superseded (a later payment replay finds nothing to
 *    dispatch or refund) and any leg or paid quote goes to staff. Under the
 *    Phase 4 rules, linked quotes the payment covered but nobody marked are
 *    marked and refunded once; on an unpaid order they are superseded.
 *  - finding 3: `refundKeptLegs` (staff only) refunds the fee of legs a
 *    cancellation leaves as they are (delivered, lost, damaged, under review);
 *    without it those legs keep their fee and are only logged.
 *  - finding 6: callers pass the plan read AFTER their cancellation
 *    committed; everything here is idempotent per leg and quote, so two
 *    concurrent cancellations (or the daily sweep) settle once.
 */
export async function settleOrderDeliveryOnCancel(
  db: Admin,
  input: {
    plan: DeliveryCancellationPlan;
    caller: DeliveryCaller;
    bookingId: string;
    reason: string;
    bookingGroupId?: string | null;
    phase4AtCancel?: boolean;
    refundKeptLegs?: boolean;
  },
  hooks: {
    deps?: () => Promise<DeliveryDeps>;
    submit?: (obligationId: string) => Promise<unknown>;
  } = {},
): Promise<number> {
  const { plan } = input;
  const unused = plan.unusedPaidQuoteIds ?? [];
  const unmarked = plan.unmarkedQuoteIds ?? [];
  const kept = input.refundKeptLegs && input.caller.kind === 'staff' ? (plan.keptShipmentIds ?? []) : [];
  if (!plan.phase4 || !plan.lastLine || (plan.shipmentIds.length === 0 && unused.length === 0 && unmarked.length === 0 && kept.length === 0)) return 0;
  const legacyMoney = input.phase4AtCancel === false;
  const alert = (what: string, reference: string) =>
    buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [input.bookingId], discriminator: `delivery:${what}:${reference}`, data: { what, reference } });
  const submit =
    hooks.submit ??
    (async (id: string) => {
      const [{ submitRefund }, { SupabaseRefunds }, { paymentPort }, { systemClock }] = await Promise.all([
        import('@/lib/core/rental/use-cases'),
        import('./repos'),
        import('@/lib/payments/ports'),
        import('@/lib/core/ports'),
      ]);
      return submitRefund(id, { refunds: new SupabaseRefunds(db), payments: paymentPort, clock: systemClock });
    });
  const submitKey = async (key: string): Promise<void> => {
    const { data: ob } = await db.from('refund_obligations').select('id').eq('obligation_key', key).maybeSingle();
    if (ob) await submit((ob as { id: string }).id).catch(() => 'unknown_outcome');
  };
  let refunded = 0;
  try {
    const deps = await (hooks.deps ?? (async () => (await import('@/lib/delivery/server')).deliveryDeps()))();
    if (legacyMoney) {
      // The hire refund already carried the line's delivery fee: never refund it again.
      for (const quoteId of unmarked) await deps.repo.setQuoteStatus(quoteId, ['active', 'expired'], 'superseded');
      if (plan.shipmentIds.length > 0 || unused.length > 0) await deps.repo.post([], alert('delivery_legacy_cancel_has_phase4_delivery', input.bookingId));
      return 0;
    }
    for (const shipmentId of plan.shipmentIds) {
      const r = await cancelDelivery({ caller: input.caller, shipmentId, reason: input.reason, initiatedBy: input.caller.kind === 'staff' ? 'platform' : undefined }, deps);
      if (r.ok && r.refundCents > 0) {
        refunded += r.refundCents;
        await submitKey(deliveryFeeRefundKey(shipmentId));
      } else if (!r.ok) {
        // A concurrent cancellation of the same order got there first: settled once, nothing to report.
        const now = r.code === 'conflict' ? await deps.repo.getShipment(shipmentId) : null;
        if (now?.status !== 'cancelled') await deps.repo.post([], alert(`delivery_cancel_failed_${r.code}`, shipmentId));
      }
    }
    for (const quoteId of unused) {
      const r = await refundUnusedDeliveryQuote({ caller: input.caller, quoteId, reason: input.reason }, deps);
      if (r.ok && r.refundCents > 0) {
        refunded += r.refundCents;
        await submitKey(deliveryFeeRefundKey(`quote-${quoteId}`));
      } else if (!r.ok) await deps.repo.post([], alert(`delivery_quote_refund_failed_${r.code}`, quoteId));
    }
    if (unmarked.length > 0) refunded += await settleUnmarkedQuotes({ ...input, unmarked }, deps, submitKey, alert);
    for (const shipmentId of kept) {
      const r = await refundDeliveryFee({ caller: input.caller, shipmentId, reason: input.reason }, deps);
      if (r.ok && r.refundCents > 0) {
        refunded += r.refundCents;
        await submitKey(deliveryFeeRefundKey(shipmentId));
      } else if (!r.ok) await deps.repo.post([], alert(`delivery_fee_refund_failed_${r.code}`, shipmentId));
    }
  } catch (err) {
    console.error('[delivery] order cancellation failed:', err instanceof Error ? err.message : 'unknown error');
    await db.rpc('outbox_enqueue', { p_notices: alert('delivery_cancel_error', input.bookingId) });
  }
  return refunded;
}

/**
 * Linked quotes nobody marked paid (finding 1). On an order whose payment the
 * provider verified, its delivery cents paid for them: mark them paid (the
 * amount must match, as after payment) and refund them at once. On an order
 * that was never paid online they were never charged: supersede them.
 */
async function settleUnmarkedQuotes(
  input: { plan: DeliveryCancellationPlan; caller: DeliveryCaller; reason: string; bookingGroupId?: string | null; unmarked: readonly string[] },
  deps: DeliveryDeps,
  submitKey: (key: string) => Promise<void>,
  alert: (what: string, reference: string) => ReturnType<typeof buildNotices>,
): Promise<number> {
  const first = await deps.repo.getQuote(input.unmarked[0]);
  const groupId = input.bookingGroupId ?? first?.bookingGroupId ?? null;
  const group = groupId ? await deps.bookings.getGroup(groupId) : null;
  const paidCents = input.plan.paidDeliveryCents ?? null;
  if (!group || !group.paymentVerified || !group.paymentReference || paidCents === null) {
    for (const quoteId of input.unmarked) await deps.repo.setQuoteStatus(quoteId, ['active', 'expired'], 'superseded');
    return 0;
  }
  const marked = await markDeliveryQuotesPaid(
    {
      paymentReference: group.paymentReference,
      bookingGroupId: group.bookingGroupId,
      renterId: group.renterId,
      quoteIds: input.plan.onlineQuoteIds ?? input.unmarked,
      paidDeliveryCents: paidCents,
      forCancelledOrderRefund: true,
    },
    deps,
  );
  if (!marked.ok) {
    if (marked.code !== 'amount_mismatch') await deps.repo.post([], alert(`delivery_cancel_quotes_not_marked_${marked.code}`, group.bookingGroupId));
    return 0;
  }
  let refunded = 0;
  for (const quoteId of input.unmarked) {
    const r = await refundUnusedDeliveryQuote({ caller: input.caller, quoteId, reason: input.reason }, deps);
    if (r.ok && r.refundCents > 0) {
      refunded += r.refundCents;
      await submitKey(deliveryFeeRefundKey(`quote-${quoteId}`));
    } else if (!r.ok) await deps.repo.post([], alert(`delivery_quote_refund_failed_${r.code}`, quoteId));
  }
  return refunded;
}

/**
 * After a booking line's cancellation COMMITTED (finding 6): read the order
 * again and settle its delivery if no line is open any more. Two concurrent
 * cancellations of an order's last two lines each saw the other line open
 * before acting; both now see the order fully cancelled, and settling is
 * idempotent per leg and quote, so the fee is refunded exactly once. A read
 * that fails falls back to the plan taken before the cancellation and alerts
 * staff; the daily sweep (`sweepCancelledOrderDelivery`) catches the rest.
 * Never throws. Returns the delivery refund in cents.
 */
export async function settleAfterLineCancelled(
  db: Admin,
  input: { before: DeliveryCancellationPlan; bookingGroupId: string | null; bookingId: string; caller: DeliveryCaller; reason: string; refundKeptLegs?: boolean },
  read: (db: Admin, input: { bookingGroupId: string | null; bookingId: string }) => Promise<DeliveryCancellationPlan> = deliveryCancellationPlan,
  hooks?: Parameters<typeof settleOrderDeliveryOnCancel>[2],
): Promise<number> {
  let plan = input.before;
  try {
    plan = await read(db, { bookingGroupId: input.bookingGroupId, bookingId: input.bookingId });
  } catch (err) {
    console.error('[delivery] re-reading the order after a cancellation failed:', err instanceof Error ? err.message : 'unknown error');
    await Promise.resolve(
      db.rpc('outbox_enqueue', {
        p_notices: buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [input.bookingId], discriminator: `delivery:delivery_cancel_recheck_failed:${input.bookingId}`, data: { what: 'delivery_cancel_recheck_failed', reference: input.bookingId } }),
      }),
    ).catch(() => undefined);
  }
  return settleOrderDeliveryOnCancel(
    db,
    { plan, caller: input.caller, bookingId: input.bookingId, reason: input.reason, bookingGroupId: input.bookingGroupId, phase4AtCancel: input.before.phase4, refundKeptLegs: input.refundKeptLegs },
    hooks,
  );
}

/**
 * Daily safety net (finding 6): orders whose every line is cancelled but that
 * still have a live cancellable delivery leg or a paid quote no leg was made
 * from (two cancellations raced, or the settlement after a cancellation
 * failed). The database lists exactly those orders
 * (`delivery_cancelled_orders_to_settle`, oldest first), so live orders never
 * crowd them out of the batch. Each is settled through the same idempotent
 * path, as the system (a platform cancellation: the fee is refunded in full).
 * Quotes nobody marked paid are left to staff here (the cancellation itself
 * settles those; the sweep does not know which money rules it used). Bounded
 * by `limit` orders per run and the pipeline deadline. Empty before 076.
 */
export async function sweepCancelledOrderDelivery(
  db: Admin,
  opts: { limit: number; deadline?: number },
  hooks?: Parameters<typeof settleOrderDeliveryOnCancel>[2],
  read: (db: Admin, input: { bookingGroupId: string | null; bookingId: string }) => Promise<DeliveryCancellationPlan> = deliveryCancellationPlan,
): Promise<{ checked: number; settled: number; refundCents: number }> {
  const { data, error } = await db.rpc('delivery_cancelled_orders_to_settle', { p_limit: opts.limit });
  if (error) {
    if (isMissingPipeline(error)) return { checked: 0, settled: 0, refundCents: 0 };
    throw new Error(`cancelled-order sweep lookup failed: ${error.message}`);
  }
  const groups = ((data ?? []) as (string | { delivery_cancelled_orders_to_settle?: string })[])
    .map((r) => (typeof r === 'string' ? r : String(r.delivery_cancelled_orders_to_settle ?? '')))
    .filter((g) => g !== '')
    .slice(0, opts.limit);
  let checked = 0;
  let settled = 0;
  let refundCents = 0;
  for (const groupId of groups) {
    if (opts.deadline !== undefined && Date.now() > opts.deadline) break;
    checked += 1;
    try {
      const { data: lines, error } = await db.from('equipment_bookings').select('id, status').eq('checkout_group_id', groupId);
      if (error) throw new Error(error.message);
      const rows = (lines ?? []) as { id: string; status: string }[];
      if (rows.length === 0 || rows.some((l) => l.status !== 'cancelled')) continue;
      const plan = await read(db, { bookingGroupId: groupId, bookingId: rows[0].id });
      if (plan.shipmentIds.length === 0 && plan.unusedPaidQuoteIds.length === 0) continue;
      settled += 1;
      refundCents += await settleOrderDeliveryOnCancel(
        db,
        { plan: { ...plan, unmarkedQuoteIds: [] }, caller: { kind: 'system' }, bookingId: rows[0].id, reason: 'order fully cancelled: delivery settled by the daily check', bookingGroupId: groupId },
        hooks,
      );
    } catch (err) {
      console.error(`[delivery] cancelled-order sweep failed for ${groupId}:`, err instanceof Error ? err.message : 'unknown error');
    }
  }
  return { checked, settled, refundCents };
}

/**
 * What a staff cancellation of this line releases from the ledger, for orders
 * paid through the provider (a paid payment intent): its hire and deposit,
 * plus the order's LEGACY delivery fee when this is the last line still open.
 * An order with Phase 4 delivery never adds the fee here: its legs are
 * cancelled (and refunded once) through the delivery core, or the fee would
 * be released and refunded twice. Null when the order is outside the ledger
 * (manual payment, pre-070). Throws when it cannot tell (fail closed).
 */
export async function heldForStaffCancel(
  db: Admin,
  booking: { id: string; checkout_group_id: string | null },
  phase4Delivery: boolean,
): Promise<{ hireCents: number; depositCents: number } | null> {
  if (!booking.checkout_group_id) return null;
  const { data: intent, error: intentErr } = await db.from('rental_payment_intents').select('state').eq('checkout_group_id', booking.checkout_group_id).maybeSingle();
  // A failed lookup must not read as "outside the ledger" (no journal would be posted).
  if (intentErr) throw new Error(`heldForLine: intent lookup failed: ${intentErr.message}`);
  if ((intent as { state?: string } | null)?.state !== 'paid') return null;
  const { data: lines, error: linesErr } = await db
    .from('equipment_bookings')
    .select('id, status, hire_cents, deposit_cents, delivery_fee')
    .eq('checkout_group_id', booking.checkout_group_id);
  if (linesErr) throw new Error(`heldForLine: order lookup failed: ${linesErr.message}`);
  const rows = (lines ?? []) as { id: string; status: string; hire_cents: number | null; deposit_cents: number | null; delivery_fee: number | null }[];
  const me = rows.find((r) => r.id === booking.id);
  if (!me || me.hire_cents == null) return null;
  const othersOpen = rows.some((r) => r.id !== booking.id && r.status !== 'cancelled');
  const delivery = othersOpen || phase4Delivery ? 0 : rows.reduce((sum, r) => sum + toCents(Number(r.delivery_fee ?? 0)), 0);
  return { hireCents: me.hire_cents + delivery, depositCents: me.deposit_cents ?? 0 };
}
