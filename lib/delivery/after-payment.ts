import { buildNotices, type OutboxMessage } from '@/lib/core/rental/notifications';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import { commitDelivery, markDeliveryQuotesPaid, prepareDelivery } from '@/lib/core/delivery/use-cases';
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
 */

export type AfterPaymentOutcome =
  | { outcome: 'no_delivery' }
  | { outcome: 'payment_not_verified' }
  | { outcome: 'not_marked'; code: string }
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

const LIVE_QUOTE: readonly CustomerDeliveryQuote['status'][] = ['active', 'expired', 'paid', 'consumed'];

export async function dispatchDeliveryAfterPayment(
  input: { bookingGroupId: string; paidDeliveryCents: number | null },
  deps: { delivery: DeliveryDeps; links: QuoteLinkStore },
): Promise<AfterPaymentOutcome> {
  const groupId = input.bookingGroupId;
  try {
    const quotes = (await deps.links.quotesForGroup(groupId)).filter((q) => LIVE_QUOTE.includes(q.status));
    if (quotes.length === 0) return { outcome: 'no_delivery' };

    const group = await deps.delivery.bookings.getGroup(groupId);
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
      const prepared = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.id, bookingGroupId: groupId }, deps.delivery);
      if (!prepared.ok) {
        // Paid but not prepared (for example no longer eligible): the fee is
        // owed back or a person arranges it. Never dispatched silently.
        await tellStaff(deps.delivery, `delivery_prepare_failed_${prepared.code}`, `${groupId}:${q.leg}`);
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
