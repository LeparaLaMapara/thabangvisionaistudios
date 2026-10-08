/**
 * Deciding what a payment event means for a gear order (spec §7.5, §7.6). Pure.
 *
 * An order (one checkout) has one payment intent. The intent records what the
 * server expects: amount in cents, currency, reference, customer. The browser
 * never states an amount, and a redirect back from the payment page proves
 * nothing (T08). Only a verified provider event, or a provider lookup made by
 * the server, moves money state.
 *
 * Covers the twelve webhook scenarios of spec §7.6:
 *   1 duplicate              → `duplicate`, no second confirmation (T09)
 *   2 out of order           → state only moves forward; a failure never undoes a payment
 *   3 paid after expiry      → `confirm_late` (re-reserve under lock, else refund) (T11)
 *   4 failed after paid      → `ignore` (T12)
 *   5 refund repeated        → refunds.ts applyProviderRefundStatus
 *   6 provider ok, DB failed → the inbox row stays unprocessed and is retried
 *   7 DB ok, client timeout  → the client polls; state is already right
 *   8 bad signature          → rejected before it gets here (T10)
 *   9 wrong amount           → `hold_mismatch` (never confirms, money owed back)
 *  10 wrong currency/ref     → `hold_mismatch` / `unknown_reference`
 *  11 paid but cancelled     → `refund_paid_cancelled`
 *  12 transfer after retry   → payouts.ts applyProviderTransferStatus
 */

export const INTENT_STATES = ['initiated', 'paid', 'failed', 'expired', 'mismatch', 'refund_due', 'refunded'] as const;
export type IntentState = (typeof INTENT_STATES)[number];

export interface PaymentIntent {
  reference: string;
  state: IntentState;
  expectedAmountCents: number;
  currency: 'ZAR';
  userId: string;
  /** Provider's transaction id once paid; the duplicate check. */
  providerTransactionId: string | null;
  holdExpiresAt: string;
}

/** A provider charge event, already signature-checked and parsed. */
export interface ChargeEvent {
  kind: 'charge.success' | 'charge.failed';
  reference: string;
  providerTransactionId: string;
  amountCents: number;
  currency: string;
  /** The user id the server put in the payment metadata, if present. */
  metadataUserId: string | null;
}

/** What the order's booking lines look like right now. */
export interface OrderLinesState {
  /** Count of lines per status. */
  statuses: Partial<Record<string, number>>;
  /** Lines cancelled only because their hold ran out (not by a person). */
  cancelledByExpiry: number;
}

export type ChargeDecision =
  | { action: 'confirm' }
  /** Paid after the hold lapsed: reserve again under lock; if stock is gone, refund in full. */
  | { action: 'confirm_late' }
  | { action: 'duplicate' }
  | { action: 'ignore'; why: string }
  | { action: 'record_failure' }
  | { action: 'hold_mismatch'; why: 'amount' | 'currency' | 'customer'; refundCents: number }
  | { action: 'refund_paid_cancelled'; refundCents: number }
  | { action: 'unknown_reference' };

export function decideCharge(intent: PaymentIntent | null, event: ChargeEvent, lines: OrderLinesState, now: Date): ChargeDecision {
  if (!intent) return { action: 'unknown_reference' };
  if (event.reference !== intent.reference) return { action: 'unknown_reference' };

  if (event.kind === 'charge.failed') {
    // A failure says one attempt failed. It never cancels a payment that
    // succeeded, and it does not release the hold early: the customer may try
    // another card before the hold expires.
    if (intent.state === 'initiated') return { action: 'record_failure' };
    return { action: 'ignore', why: `charge.failed while intent is ${intent.state}` };
  }

  // charge.success
  if (intent.providerTransactionId && intent.providerTransactionId === event.providerTransactionId) {
    return { action: 'duplicate' };
  }
  if (intent.state === 'paid' || intent.state === 'refund_due' || intent.state === 'refunded' || intent.state === 'mismatch') {
    // A second, different successful transaction on the same reference should
    // not happen (Paystack references are unique). If it does, the money is
    // owed back and a person looks.
    return { action: 'hold_mismatch', why: 'amount', refundCents: event.amountCents };
  }

  if (event.currency.toUpperCase() !== intent.currency) {
    return { action: 'hold_mismatch', why: 'currency', refundCents: event.amountCents };
  }
  if (!Number.isSafeInteger(event.amountCents) || event.amountCents !== intent.expectedAmountCents) {
    return { action: 'hold_mismatch', why: 'amount', refundCents: event.amountCents };
  }
  if (event.metadataUserId && event.metadataUserId !== intent.userId) {
    return { action: 'hold_mismatch', why: 'customer', refundCents: event.amountCents };
  }

  const pending = lines.statuses.pending ?? 0;
  const cancelled = lines.statuses.cancelled ?? 0;
  const total = Object.values(lines.statuses).reduce<number>((s, n) => s + (n ?? 0), 0);

  if (total > 0 && cancelled === total) {
    // Every line was cancelled. Only expiry cancellations are reinstated;
    // a booking a person cancelled stays cancelled and the money goes back.
    return cancelled === lines.cancelledByExpiry ? { action: 'confirm_late' } : { action: 'refund_paid_cancelled', refundCents: event.amountCents };
  }
  if (pending === 0 && cancelled === 0) {
    // Already confirmed by another path (e.g. a server-side verify). Record
    // the transaction, but nothing changes state twice.
    return { action: 'duplicate' };
  }
  if (cancelled > 0 && cancelled !== lines.cancelledByExpiry) {
    // Part of the order was cancelled by a person while payment was in flight.
    // Partial confirmation would leave the order inconsistent, so a person decides.
    return { action: 'hold_mismatch', why: 'amount', refundCents: event.amountCents };
  }
  const expired = new Date(intent.holdExpiresAt).getTime() <= now.getTime();
  return expired || cancelled > 0 ? { action: 'confirm_late' } : { action: 'confirm' };
}

/**
 * Stable de-duplication key for a provider event (spec §7.6). Paystack sends
 * no event id, so the documented fallback is event name + the object's id +
 * the object's status: a redelivery of the same event collides, while a later
 * status change of the same object (refund pending → processed) does not.
 */
export function eventDedupeKey(provider: string, event: string, objectId: string | number | null | undefined, status: string | null | undefined): string {
  const id = objectId === null || objectId === undefined || objectId === '' ? 'noid' : String(objectId);
  return `${provider}:${event}:${id}:${status ?? 'nostatus'}`;
}
