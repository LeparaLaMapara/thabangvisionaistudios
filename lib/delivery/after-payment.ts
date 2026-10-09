import { buildNotices, type OutboxMessage } from '@/lib/core/rental/notifications';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import {
  commitDelivery,
  isManualPaymentReference,
  markDeliveryQuotesPaid,
  markDeliveryQuotesPaidByStaff,
  prepareDelivery,
  refundUnusedDeliveryQuote,
  type DeliveryCaller,
} from '@/lib/core/delivery/use-cases';
import type { QuoteLinkStore } from './checkout';

/**
 * After a rental payment is VERIFIED (webhook, missed-payment recovery, or a
 * person recording a payment): book the order's delivery legs (spec §4.8).
 *
 *   mark the paid quotes  →  prepare each leg (eligibility re-checked on
 *   today's facts)  →  commit as the system (the manual adapter creates the
 *   staff task; a courier adapter would book the job).
 *
 * Nothing is dispatched unless the order's payment is verified server-side
 * (the booking port reads the payment intent). Every step is idempotent, so a
 * replayed webhook or a second recovery run changes nothing: paid quotes stay
 * paid, prepare returns the live leg, commit answers already_dispatched.
 *
 * It never throws and never undoes the payment confirmation: a failure is
 * recorded as a staff alert (ops queue) and returned for the logs.
 *
 * A paid leg that cannot be prepared for a lasting reason (no longer
 * eligible, the booking changed, the provider is gone) has its fee refunded
 * at once (refundUnusedDeliveryQuote: obligation capped at the charge), so the
 * money is never left stuck on a delivery that will not run. A quote already
 * refunded, or used by a leg that was cancelled, is never dispatched again.
 *
 * Review fix round 2:
 *  - finding 1: an order whose every line is cancelled stops here with a
 *    staff alert and NO refund. Its cancellation settled the delivery money
 *    (Phase 4 rules: the legs and paid or charged quotes; legacy rules: the
 *    line's delivery fee with the hire). Refunding again on a replay would pay
 *    the fee back twice.
 *  - finding 7: a quote paid BY HAND (a `manual:` reference, e.g. a return
 *    pickup staff confirmed) was never part of the online payment: it is left
 *    out of the amount check, so a replay does not raise a false mismatch.
 */

export type AfterPaymentOutcome =
  | { outcome: 'no_delivery' }
  | { outcome: 'payment_not_verified' }
  | { outcome: 'not_marked'; code: string }
  | { outcome: 'order_cancelled' }
  | { outcome: 'done'; legs: { leg: string; result: string }[] }
  | { outcome: 'error'; message: string };

function alert(what: string, reference: string): OutboxMessage[] {
  return buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [], discriminator: `delivery:${what}:${reference}`, data: { what, reference } });
}

/** Sends a staff alert; an alert that cannot be stored is logged, never thrown. */
async function tellStaff(deps: Pick<DeliveryDeps, 'repo'>, what: string, reference: string): Promise<void> {
  try {
    await deps.repo.post([], alert(what, reference));
  } catch (err) {
    console.error(`[delivery] staff alert ${what} for ${reference} not stored:`, err instanceof Error ? err.message : err);
  }
}

/** Quotes that were part of the order's payment (superseded ones never were). */
export const LIVE_QUOTE: readonly CustomerDeliveryQuote['status'][] = ['active', 'expired', 'paid', 'consumed', 'refunded'];

/**
 * The order's quotes that its ONLINE (provider-verified) payment paid for:
 * linked, not superseded, and not paid by hand (finding 7).
 */
export function onlinePaymentQuotes(quotes: readonly CustomerDeliveryQuote[]): CustomerDeliveryQuote[] {
  return quotes.filter((q) => LIVE_QUOTE.includes(q.status) && !isManualPaymentReference(q.paidReference));
}

/** Prepare refusals that will not go away by retrying: the paid fee is owed back now. */
const REFUND_ON: readonly string[] = ['not_eligible', 'provider_excluded', 'provider_unavailable', 'items_mismatch', 'booking_state', 'too_many_attempts', 'dates_mismatch'];

export async function dispatchDeliveryAfterPayment(
  input: { bookingGroupId: string; paidDeliveryCents: number | null },
  deps: { delivery: DeliveryDeps; links: QuoteLinkStore },
): Promise<AfterPaymentOutcome> {
  const groupId = input.bookingGroupId;
  try {
    const quotes = onlinePaymentQuotes(await deps.links.quotesForGroup(groupId));
    if (quotes.length === 0) return { outcome: 'no_delivery' };

    const group = await deps.delivery.bookings.getGroup(groupId);
    if (group && group.lines.length > 0 && group.lines.every((l) => l.status === 'cancelled')) {
      // Cancelled before (or while) this ran: the cancellation settled the delivery fee.
      await tellStaff(deps.delivery, 'delivery_after_payment_order_cancelled', groupId);
      return { outcome: 'order_cancelled' };
    }
    if (!group || !group.paymentVerified || !group.paymentReference || input.paidDeliveryCents === null) {
      // e.g. a payment recorded by hand: the provider never verified it, so no
      // automatic dispatch. A person arranges this delivery.
      await tellStaff(deps.delivery, 'delivery_needs_staff_dispatch_payment_not_verified', groupId);
      return { outcome: 'payment_not_verified' };
    }

    const marked = await markDeliveryQuotesPaid(
      { paymentReference: group.paymentReference, bookingGroupId: groupId, renterId: group.renterId, quoteIds: quotes.map((q) => q.id), paidDeliveryCents: input.paidDeliveryCents },
      deps.delivery,
    );
    if (!marked.ok) {
      // amount_mismatch already alerts staff inside the use case.
      if (marked.code !== 'amount_mismatch') await tellStaff(deps.delivery, `delivery_quotes_not_marked_${marked.code}`, groupId);
      return { outcome: 'not_marked', code: marked.code };
    }

    const legs: { leg: string; result: string }[] = [];
    const ordered = [...quotes].sort((a, b) => (a.leg === b.leg ? 0 : a.leg === 'outbound' ? -1 : 1));
    for (const q of ordered) {
      // Settled already (cancelled and refunded): a replay never dispatches it again.
      const current = await deps.delivery.repo.getQuote(q.id);
      if (current?.status === 'refunded') {
        legs.push({ leg: q.leg, result: 'refunded' });
        continue;
      }
      const prepared = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.id, bookingGroupId: groupId }, deps.delivery);
      if (!prepared.ok) {
        // Paid but not prepared. For a lasting reason the fee goes back now
        // (capped at the charge); otherwise a person arranges it. Never
        // dispatched silently.
        await tellStaff(deps.delivery, `delivery_prepare_failed_${prepared.code}`, `${groupId}:${q.leg}`);
        if (REFUND_ON.includes(prepared.code)) {
          const refunded = await refundUnusedDeliveryQuote({ caller: { kind: 'system' }, quoteId: q.id, reason: `prepare refused: ${prepared.code}` }, deps.delivery);
          legs.push({ leg: q.leg, result: refunded.ok ? `refunded_${prepared.code}` : `prepare_${prepared.code}` });
          continue;
        }
        legs.push({ leg: q.leg, result: `prepare_${prepared.code}` });
        continue;
      }
      const committed = await commitDelivery({ caller: { kind: 'system' }, shipmentId: prepared.shipment.id }, deps.delivery);
      if (committed.ok) {
        legs.push({ leg: q.leg, result: committed.outcome });
        continue;
      }
      // dispatch_unknown / dispatch_rejected / reconcile_pending alert inside the use case.
      if (!['dispatch_unknown', 'dispatch_rejected', 'reconcile_pending', 'in_progress'].includes(committed.code)) {
        await tellStaff(deps.delivery, `delivery_commit_failed_${committed.code}`, `${groupId}:${q.leg}`);
      }
      legs.push({ leg: q.leg, result: `commit_${committed.code}` });
    }
    return { outcome: 'done', legs };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
    console.error(`[delivery] after-payment dispatch failed for ${groupId}: ${message}`);
    await tellStaff(deps.delivery, 'delivery_after_payment_error', groupId);
    return { outcome: 'error', message };
  }
}

/**
 * The production entry point, called after a rental payment is confirmed.
 * Cheap when the order has no delivery (one query). Never throws.
 */
export async function afterRentalPayment(bookingGroupId: string, source: 'webhook' | 'recovery' | 'manual'): Promise<AfterPaymentOutcome> {
  try {
    const [{ SupabaseQuoteLinks }, { deliveryDeps }, { SupabaseRentalPayments }] = await Promise.all([import('./checkout'), import('./server'), import('@/lib/rental/repos')]);
    const links = new SupabaseQuoteLinks();
    const quotes = await links.quotesForGroup(bookingGroupId);
    if (quotes.length === 0) return { outcome: 'no_delivery' };
    const intent = await new SupabaseRentalPayments().getIntent(bookingGroupId).catch(() => null);
    const paidDeliveryCents = intent && intent.state === 'paid' ? intent.deliveryCents : null;
    const r = await dispatchDeliveryAfterPayment({ bookingGroupId, paidDeliveryCents }, { delivery: await deliveryDeps(), links });
    if (r.outcome !== 'no_delivery') console.info(`[delivery] after ${source} payment ${bookingGroupId}: ${JSON.stringify(r)}`);
    return r;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
    console.error(`[delivery] after-payment hook failed for ${bookingGroupId}: ${message}`);
    return { outcome: 'error', message };
  }
}

// ── Dispatch after a payment taken by hand (F-2, F-3, D-50) ─────────────────

export type ManualDispatchOutcome =
  | { ok: true; marked: number; legs: { leg: string; result: string }[] }
  | { ok: false; code: string; message: string };

/**
 * Staff confirm that a delivery fee was paid by hand and dispatch it:
 *
 *   mark the quotes paid with the manual reference (core, staff only: the
 *   order must be confirmed, the quotes this renter's, the amount exact)
 *   → prepare each leg (eligibility re-checked) → commit as STAFF.
 *
 * Two uses: an order paid by EFT/cash at checkout (its linked quotes, the
 * order's own manual reference, the delivery total recorded on the order),
 * and a return pickup the renter requested during the hire (the requested
 * quote, a new manual reference, the amount received). Never dispatches an
 * unpaid leg: the core refuses unless the fee is marked paid. Every step goes
 * through the core with the staff caller; the route logs the action.
 */
export async function dispatchAfterManualPayment(
  input: { staffId: string; bookingGroupId: string; quoteIds: readonly string[]; reference: string; receivedCents: number },
  deps: DeliveryDeps,
): Promise<ManualDispatchOutcome> {
  const staff: DeliveryCaller = { kind: 'staff', userId: input.staffId };
  const marked = await markDeliveryQuotesPaidByStaff({ caller: staff, bookingGroupId: input.bookingGroupId, quoteIds: input.quoteIds, reference: input.reference, receivedCents: input.receivedCents }, deps);
  if (!marked.ok) return { ok: false, code: marked.code, message: marked.message };
  const legs: { leg: string; result: string }[] = [];
  const quotes = (await Promise.all(input.quoteIds.map((id) => deps.repo.getQuote(id)))).filter((q): q is CustomerDeliveryQuote => !!q);
  const ordered = [...quotes].sort((a, b) => (a.leg === b.leg ? 0 : a.leg === 'outbound' ? -1 : 1));
  for (const q of ordered) {
    const prepared = await prepareDelivery({ caller: staff, quoteId: q.id, bookingGroupId: input.bookingGroupId }, deps);
    if (!prepared.ok) {
      legs.push({ leg: q.leg, result: `prepare_${prepared.code}` });
      continue;
    }
    const committed = await commitDelivery({ caller: staff, shipmentId: prepared.shipment.id }, deps);
    legs.push({ leg: q.leg, result: committed.ok ? committed.outcome : `commit_${committed.code}` });
  }
  return { ok: true, marked: marked.marked, legs };
}
