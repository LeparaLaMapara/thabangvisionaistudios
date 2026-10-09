import type { SupabaseClient } from '@supabase/supabase-js';
import { refundWithOutcome, type RefundAttempt } from '@/lib/payments/routing';
import { checkServiceRefund } from '@/lib/core/services/fulfilment';
import { mentionsFulfilmentSchema, withoutFulfilmentColumns } from '@/lib/supabase/queries/service-bookings';

/**
 * Refunds on SERVICE bookings (bookings table), claimed before any money moves.
 *
 * The payment provider is not a lock: Paystack takes no idempotency key on a
 * refund (the PaymentPort adapter drops it), so two callers that both read
 * "no refund yet" would both send one. Every refund therefore goes:
 *
 *   1. claim   one conditional update sets cancellation_refund_status to
 *              'pending' (with the amount) only while the booking still holds
 *              exactly the states the caller read: its status, its payout
 *              status, and a refund status of none or 'failed'. Whoever loses
 *              gets nothing back and sends nothing (the route answers 409).
 *   2. send    refundWithOutcome (refunded / rejected / unknown / manual).
 *   3. record  the outcome is written only over 'pending' (compare-and-set),
 *              so a late or repeated result can never overwrite 'refunded' or
 *              'unknown' written by someone else, or a person's own record.
 *
 * If the process dies between 1 and 3 the booking stays 'pending'. 'pending'
 * already blocks every automatic refund and the creator payout, so nothing
 * moves twice: a person checks the provider's refunds for the payment
 * reference and records what happened (docs/marketplace/services.md).
 *
 * The client's own cancellation and the creator's decline claim the same way:
 * their status change (a compare-and-set on the old status) writes 'pending'
 * in the same update, then record through recordServiceRefundOutcome.
 */

export type RecordedRefund = 'refunded' | 'failed' | 'unknown' | 'manual_review';

/** Prefix on cancellation_refund_error for an unknown outcome. */
export const UNKNOWN_REFUND_NOTE = 'OUTCOME UNKNOWN, check the payment provider before refunding by hand';

export type CasResult =
  | { ok: true; updated: boolean }
  | { ok: false; error: string };

/**
 * Update one booking only while each column in `expect` still holds the value
 * read (null compares with IS NULL). Retries without the migration-073 columns
 * on a database that lacks them.
 */
export async function updateBookingWhere(
  db: SupabaseClient,
  id: string,
  expect: Record<string, string | null | undefined>,
  patch: Record<string, unknown>,
): Promise<CasResult> {
  const run = async (values: Record<string, unknown>) => {
    let q = db.from('bookings').update(values).eq('id', id);
    for (const [column, value] of Object.entries(expect)) {
      q = value === null || value === undefined ? q.is(column, null) : q.eq(column, value);
    }
    return q.select('id');
  };
  let { data, error } = await run(patch);
  if (error && mentionsFulfilmentSchema(error.message)) {
    ({ data, error } = await run(withoutFulfilmentColumns(patch)));
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true, updated: Array.isArray(data) && data.length > 0 };
}

/** What the caller read, exactly. The claim is a compare-and-set on all three. */
export interface ServiceRefundTarget {
  id: string;
  status: string | null;
  payoutStatus: string | null;
  refundStatus: string | null;
}

export type RefundClaim =
  /** This caller owns the refund: send it, then record the outcome. */
  | { claimed: true }
  /** Someone else changed the booking first (or the rules refuse it). Send nothing. */
  | { claimed: false; error: string | null };

/**
 * Step 1: claim the refund. `extra` is written in the same update (an admin
 * cancel writes the status change here, so a client cancellation racing it
 * fails its own status compare-and-set). Amount in whole rands, as stored.
 */
export async function claimServiceRefund(
  db: SupabaseClient,
  target: ServiceRefundTarget,
  opts: { amountRands: number; now: Date; extra?: Record<string, unknown> },
): Promise<RefundClaim> {
  // Defensive: the routes check first, but never claim what the rules refuse.
  if (!checkServiceRefund(target).ok) return { claimed: false, error: null };
  const res = await updateBookingWhere(
    db,
    target.id,
    {
      status: target.status,
      payout_status: target.payoutStatus,
      cancellation_refund_status: target.refundStatus,
    },
    {
      ...(opts.extra ?? {}),
      cancellation_refund_status: 'pending',
      cancellation_refund_amount: opts.amountRands,
      cancellation_refunded_at: null,
      cancellation_refund_error: null,
      updated_at: opts.now.toISOString(),
    },
  );
  if (!res.ok) return { claimed: false, error: res.error };
  return res.updated ? { claimed: true } : { claimed: false, error: null };
}

export function recordedRefund(attempt: RefundAttempt): RecordedRefund {
  return attempt.outcome === 'refunded' ? 'refunded'
    : attempt.outcome === 'unknown' ? 'unknown'
      : attempt.outcome === 'manual' ? 'manual_review'
        : 'failed';
}

export interface RecordResult {
  outcome: RecordedRefund;
  /** False when the row was no longer 'pending' (or the write failed): nothing was overwritten. */
  recorded: boolean;
  error: string | null;
}

/**
 * Step 3: write the outcome, only over this booking's 'pending' claim.
 * A full refund (amount at least the total) also marks the payment refunded.
 */
export async function recordServiceRefundOutcome(
  db: SupabaseClient,
  p: { bookingId: string; attempt: RefundAttempt; amountRands: number; total: number; now?: Date },
): Promise<RecordResult> {
  const outcome = recordedRefund(p.attempt);
  const ok = p.attempt.outcome === 'refunded';
  const at = (p.now ?? new Date()).toISOString();
  const message = p.attempt.outcome === 'refunded' ? null : p.attempt.message;
  const patch: Record<string, unknown> = {
    cancellation_refund_status: outcome,
    cancellation_refunded_at: ok ? at : null,
    cancellation_refund_error: ok ? null : (outcome === 'unknown' ? `${UNKNOWN_REFUND_NOTE}: ${message}` : String(message)).slice(0, 500),
    ...(ok && p.amountRands >= p.total ? { payment_status: 'refunded' } : {}),
    updated_at: at,
  };
  let res = await updateBookingWhere(db, p.bookingId, { cancellation_refund_status: 'pending' }, patch);
  if (!res.ok && outcome === 'unknown' && /cancellation_refund_status/.test(res.error)) {
    // Before migration 073 'unknown' is not an allowed value. 'pending' plus
    // the note keeps it out of every automatic refund path all the same.
    res = await updateBookingWhere(db, p.bookingId, { cancellation_refund_status: 'pending' }, { ...patch, cancellation_refund_status: 'pending' });
  }
  if (!res.ok) return { outcome, recorded: false, error: res.error };
  return { outcome, recorded: res.updated, error: null };
}

/**
 * Steps 2 and 3 for a refund this caller has claimed. Amount in whole rands;
 * refundWithOutcome sends it to the provider in integer cents.
 */
export async function sendClaimedServiceRefund(
  db: SupabaseClient,
  p: { bookingId: string; reference: string; amountRands: number; total: number; idempotencyKey: string; now?: Date },
): Promise<RecordResult & { attempt: RefundAttempt }> {
  const attempt = await refundWithOutcome({ reference: p.reference, amountRands: p.amountRands, idempotencyKey: p.idempotencyKey });
  const rec = await recordServiceRefundOutcome(db, { bookingId: p.bookingId, attempt, amountRands: p.amountRands, total: p.total, now: p.now });
  if (!rec.recorded) {
    // No booking data or provider message here: the outcome is in the return value.
    console.error('[service-refunds] refund outcome not recorded:', rec.outcome, rec.error ? 'write failed' : 'claim no longer pending');
  }
  return { ...rec, attempt };
}
