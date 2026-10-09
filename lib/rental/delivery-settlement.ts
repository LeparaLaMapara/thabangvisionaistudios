import { createAdminClient } from '@/lib/supabase/server';
import type { DeliveryDeps, DeliveryRepository } from '@/lib/core/delivery/repository';
import { cancelDelivery, checkRentalSettlement, deliveryFeeRefundKey, refundUnusedDeliveryQuote, type DeliveryCaller, type SettlementCheck } from '@/lib/core/delivery/use-cases';
import { CANCELLABLE_STATES, FINAL_DELIVERY_STATES } from '@/lib/core/delivery/state';
import { buildNotices } from '@/lib/core/rental/notifications';
import { toCents } from '@/lib/core/pricing/money';
import { isMissingPipeline } from './repos';

/**
 * Where the gear-hire money paths meet Phase 4 delivery (risk register R-39,
 * R-40). Used by take-back, dispute settlement, owner payout eligibility and
 * cancellation.
 *
 * R-39: an order that uses Phase 4 delivery (it has shipment legs, or a paid
 * delivery quote) earns its delivery fee per leg through the delivery use
 * cases. The legacy order-level `deliveryEarned({ bookingGroupId })` journal
 * must not be posted for it, or the fee is earned twice. Orders without Phase 4
 * delivery keep the legacy behaviour unchanged.
 *
 * R-40: settlement (deposit, owner payout) waits for checkRentalSettlement:
 * an open delivery incident holds it (D29), a courier collection never
 * releases a deposit (D17, every returned item must be inspected), and a
 * provider-caused or unattributed delay stops an automatic late fee (D19).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Whether this order uses Phase 4 delivery. Throws when it cannot tell (callers fail closed). */
export async function usesPhase4Delivery(db: Admin, bookingGroupId: string | null): Promise<boolean> {
  if (!bookingGroupId) return false;
  const [ships, quotes] = await Promise.all([
    db.from('delivery_shipments').select('id').eq('booking_group_id', bookingGroupId).limit(1),
    db.from('delivery_quotes').select('id').eq('booking_group_id', bookingGroupId).in('status', ['paid', 'consumed', 'refunded']).limit(1),
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
 * counted to it (D-49). Lines without such a record are absent. Empty before
 * migration 076. Throws on any other failure.
 */
export async function returnCollectedAt(db: Admin, bookingIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (bookingIds.length === 0) return out;
  const { data: custody, error } = await db
    .from('delivery_custody_events')
    .select('booking_id, shipment_id, occurred_at')
    .in('booking_id', [...bookingIds])
    .in('kind', ['collected_by_courier', 'handed_to_return_courier']);
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
  /** Live legs (not cancelled or failed) to cancel when the last line goes. */
  shipmentIds: string[];
  /** A live leg is past the point where it can be cancelled (the gear is on its way). */
  tooLate: boolean;
  /** Paid delivery fees on those legs and unused paid quotes, in cents: refunded in full unless a courier was already booked (D-39). */
  feeCents: number;
  /** A courier job is booked on one of them: its cancellation fee may be passed on at cost, capped at the fee (D-39). */
  courierBooked: boolean;
  /** Paid quotes no leg was ever made from (after-payment prepare refused them): refunded with the order. */
  unusedPaidQuoteIds: string[];
}

/**
 * What cancelling this booking line means for its order's delivery (D-39).
 * Throws when the records cannot be read (callers fail closed).
 */
export async function deliveryCancellationPlan(
  db: Admin,
  input: { bookingGroupId: string | null; bookingId: string },
  repo?: Pick<DeliveryRepository, 'listShipments'>,
): Promise<DeliveryCancellationPlan> {
  const none: DeliveryCancellationPlan = { phase4: false, lastLine: false, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false, unusedPaidQuoteIds: [] };
  if (!input.bookingGroupId) return none;
  if (!(await usesPhase4Delivery(db, input.bookingGroupId))) return none;
  const { data: lines, error } = await db.from('equipment_bookings').select('id, status').eq('checkout_group_id', input.bookingGroupId);
  if (error) throw new Error(`order lines lookup failed: ${error.message}`);
  const lastLine = !((lines ?? []) as { id: string; status: string }[]).some((l) => l.id !== input.bookingId && l.status !== 'cancelled');
  if (!lastLine) return { ...none, phase4: true };
  const r = repo ?? new (await import('@/lib/delivery/repos')).SupabaseDeliveryRepository(db);
  const all = await r.listShipments(input.bookingGroupId);
  const live = all.filter((s) => !FINAL_DELIVERY_STATES.includes(s.status));
  // A paid quote with no leg made from it (after-payment prepare refused it):
  // its fee would otherwise be lost when the order goes.
  const { data: paid, error: paidErr } = await db.from('delivery_quotes').select('id, customer_fee_cents').eq('booking_group_id', input.bookingGroupId).eq('status', 'paid');
  if (paidErr && !isMissingPipeline(paidErr)) throw new Error(`delivery quotes lookup failed: ${paidErr.message}`);
  const used = new Set(all.map((s) => s.quoteId));
  const unused = ((paid ?? []) as { id: string; customer_fee_cents: number }[]).filter((q) => !used.has(q.id));
  return {
    phase4: true,
    lastLine: true,
    shipmentIds: live.map((s) => s.id),
    tooLate: live.some((s) => !CANCELLABLE_STATES.includes(s.status)),
    feeCents: live.filter((s) => s.paidReference).reduce((n, s) => n + s.customerFeeCents, 0) + unused.reduce((n, q) => n + Number(q.customer_fee_cents ?? 0), 0),
    courierBooked: live.some((s) => s.providerKind === 'courier' && !!s.providerReference),
    unusedPaidQuoteIds: unused.map((q) => q.id),
  };
}

/**
 * The order's last line was cancelled: cancel its live delivery legs and
 * refund paid quotes no leg was made from, each through the core (one refund
 * obligation per leg or quote, capped in the database at what is left of the
 * charge), then submit the obligations at once (the daily pipeline retries
 * them, never twice). A leg that cannot be cancelled is alerted to staff; the
 * booking stays cancelled. Never throws. Returns the delivery refund in cents.
 */
export async function settleOrderDeliveryOnCancel(
  db: Admin,
  input: { plan: DeliveryCancellationPlan; caller: DeliveryCaller; bookingId: string; reason: string },
  hooks: {
    deps?: () => Promise<DeliveryDeps>;
    submit?: (obligationId: string) => Promise<unknown>;
  } = {},
): Promise<number> {
  const { plan } = input;
  const unused = plan.unusedPaidQuoteIds ?? [];
  if (!plan.phase4 || !plan.lastLine || (plan.shipmentIds.length === 0 && unused.length === 0)) return 0;
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
    for (const shipmentId of plan.shipmentIds) {
      const r = await cancelDelivery({ caller: input.caller, shipmentId, reason: input.reason, initiatedBy: input.caller.kind === 'staff' ? 'platform' : undefined }, deps);
      if (r.ok && r.refundCents > 0) {
        refunded += r.refundCents;
        await submitKey(deliveryFeeRefundKey(shipmentId));
      } else if (!r.ok) await deps.repo.post([], alert(`delivery_cancel_failed_${r.code}`, shipmentId));
    }
    for (const quoteId of unused) {
      const r = await refundUnusedDeliveryQuote({ caller: input.caller, quoteId, reason: input.reason }, deps);
      if (r.ok && r.refundCents > 0) {
        refunded += r.refundCents;
        await submitKey(deliveryFeeRefundKey(`quote-${quoteId}`));
      } else if (!r.ok) await deps.repo.post([], alert(`delivery_quote_refund_failed_${r.code}`, quoteId));
    }
  } catch (err) {
    console.error('[delivery] order cancellation failed:', err instanceof Error ? err.message : 'unknown error');
    await db.rpc('outbox_enqueue', { p_notices: alert('delivery_cancel_error', input.bookingId) });
  }
  return refunded;
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
