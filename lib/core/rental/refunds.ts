import { assertCents } from '@/lib/core/pricing/money';

/**
 * Refund lifecycle (spec §7.7). Pure.
 *
 * One refund obligation per business reason: a booking's deposit settlement,
 * a cancellation, a late payment. The database enforces that with a unique
 * key, so a retry or a double click can never create a second obligation for
 * the same money (T13).
 *
 *   eligible ─► claimed ─► requested ─► pending ─► processing ─► processed
 *                  │           │           │            │
 *                  │           └───────────┴────────────┴─► failed ─► (staff) ─► claimed
 *                  │                                     └─► needs_attention
 *                  └─► disputed (inspection disagreed)
 *
 * `claimed` means a worker has taken the obligation and is about to call the
 * provider. If that call times out, the outcome is unknown. Then the
 * obligation must be reconciled with the provider before any retry. It is
 * never re-sent blind.
 */

export const REFUND_STATES = [
  'eligible',
  'claimed',
  'requested',
  'pending',
  'processing',
  'processed',
  'failed',
  'needs_attention',
  'disputed',
] as const;

export type RefundState = (typeof REFUND_STATES)[number];

export type RefundReason = 'deposit_settlement' | 'cancellation' | 'late_payment' | 'overpayment' | 'manual';

/** How far along the provider is. Events arrive out of order; never move backwards. */
const PROGRESS: Record<RefundState, number> = {
  eligible: 0,
  disputed: 0,
  claimed: 1,
  requested: 2,
  pending: 3,
  processing: 4,
  needs_attention: 5,
  failed: 6,
  processed: 7,
};

/** Paystack refund statuses and webhook suffixes (refund.pending, refund.processed, …). */
export function mapProviderRefundStatus(status: string): RefundState | null {
  switch (status.toLowerCase().replace(/_/g, '-')) {
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'processed':
      return 'processed';
    case 'failed':
      return 'failed';
    case 'needs-attention':
      return 'needs_attention';
    default:
      return null;
  }
}

export type RefundUpdate =
  | { apply: true; to: RefundState; alertStaff: boolean; notifyCustomer: 'initiated' | 'processed' | 'failed' | null }
  | { apply: false; reason: 'duplicate' | 'stale' | 'terminal' };

/**
 * What to do when the provider tells us a refund's status. A repeat is a
 * no-op (T09-style dedupe for refunds). A status older than the one we hold is
 * ignored. A processed refund is final.
 */
export function applyProviderRefundStatus(current: RefundState, incoming: RefundState): RefundUpdate {
  if (current === incoming) return { apply: false, reason: 'duplicate' };
  if (current === 'processed') return { apply: false, reason: 'terminal' };
  // A failed refund can still be reported processed later (provider retried).
  if (current === 'failed' && incoming !== 'processed') return { apply: false, reason: 'stale' };
  if (PROGRESS[incoming] < PROGRESS[current]) return { apply: false, reason: 'stale' };

  const alertStaff = incoming === 'failed' || incoming === 'needs_attention';
  const notifyCustomer =
    incoming === 'processed' ? 'processed' : incoming === 'failed' ? 'failed' : incoming === 'pending' && PROGRESS[current] < PROGRESS.pending ? 'initiated' : null;
  return { apply: true, to: incoming, alertStaff, notifyCustomer };
}

export interface RefundObligation {
  state: RefundState;
  amountCents: number;
  /** Set once the provider accepted the request. */
  providerRefundId: string | null;
  /** When a worker claimed it; used to spot calls that never came back. */
  claimedAt: string | null;
  attempts: number;
}

export type RefundNextAction =
  | { action: 'submit' }
  | { action: 'reconcile_first' }
  | { action: 'wait' }
  | { action: 'escalate'; why: string }
  | { action: 'none' };

/**
 * What a worker should do next with an obligation.
 *
 * - `eligible` → claim it and submit.
 * - `claimed` for longer than `claimTimeoutMinutes`, or `requested` with no
 *   provider id: the earlier call may have reached the provider. Ask the
 *   provider first (T13: never double-refund after a timeout).
 * - in flight with the provider → wait for the webhook, or poll.
 * - failed or needs_attention → a person decides (T15).
 */
export function nextRefundAction(o: RefundObligation, now: Date, claimTimeoutMinutes = 10, maxAttempts = 3): RefundNextAction {
  switch (o.state) {
    case 'eligible':
      return o.attempts >= maxAttempts ? { action: 'escalate', why: 'too many attempts' } : { action: 'submit' };
    case 'claimed': {
      const at = o.claimedAt ? new Date(o.claimedAt).getTime() : 0;
      return now.getTime() - at > claimTimeoutMinutes * 60_000 ? { action: 'reconcile_first' } : { action: 'wait' };
    }
    case 'requested':
      return o.providerRefundId ? { action: 'wait' } : { action: 'reconcile_first' };
    case 'pending':
    case 'processing':
      return { action: 'wait' };
    case 'failed':
      return { action: 'escalate', why: 'provider reported the refund failed' };
    case 'needs_attention':
      return { action: 'escalate', why: 'provider needs more information' };
    case 'disputed':
      return { action: 'escalate', why: 'inspection is disputed' };
    case 'processed':
      return { action: 'none' };
  }
}

/**
 * The most that may still be refunded against one charge: what was charged
 * minus everything already refunded or in flight. Every new refund is capped
 * here (T14).
 */
export function refundableRemainder(params: { chargedCents: number; refundedOrInFlightCents: number }): number {
  assertCents(params.chargedCents, 'chargedCents');
  assertCents(params.refundedOrInFlightCents, 'refundedOrInFlightCents');
  return Math.max(0, params.chargedCents - params.refundedOrInFlightCents);
}

export type DepositRefundPlan =
  | { ok: true; refundCents: number; keptCents: number; damageCents: number; lateFeeCents: number }
  | { ok: false; code: 'inspection_required' | 'disputed' | 'exceeds_charge' | 'deductions_exceed_deposit' | 'unsupported_deduction'; message: string };

/**
 * The deposit refund after inspection.
 *
 * Deductions must be documented: a damage amount needs evidence and a late
 * fee needs the published rule that produced it. Nothing is kept without one
 * (spec §7.13: never confiscate a whole deposit automatically).
 */
export function planDepositRefund(p: {
  depositCents: number;
  inspection: 'clean' | 'damage' | 'missing_parts' | 'not_returned' | null;
  disputed: boolean;
  damageCents: number;
  damageEvidenceCount: number;
  lateFeeCents: number;
  /** What remains refundable on the original charge. */
  refundableRemainderCents: number;
}): DepositRefundPlan {
  if (p.inspection === null) return { ok: false, code: 'inspection_required', message: 'The deposit is settled only after the return is inspected.' };
  if (p.disputed) return { ok: false, code: 'disputed', message: 'The return is disputed; a person settles the deposit.' };
  if (p.inspection === 'not_returned') {
    return { ok: false, code: 'disputed', message: 'Unreturned gear is handled by the recovery process, not an automatic deduction.' };
  }
  for (const [label, v] of [['deposit', p.depositCents], ['damage', p.damageCents], ['late fee', p.lateFeeCents]] as const) {
    assertCents(v, label);
    if (v < 0) return { ok: false, code: 'unsupported_deduction', message: `${label} cannot be negative` };
  }
  if (p.damageCents > 0 && p.damageEvidenceCount === 0) {
    return { ok: false, code: 'unsupported_deduction', message: 'A damage deduction needs photographs or a written assessment.' };
  }
  if (p.damageCents > 0 && p.inspection === 'clean') {
    return { ok: false, code: 'unsupported_deduction', message: 'A clean inspection cannot carry a damage deduction.' };
  }
  const kept = p.damageCents + p.lateFeeCents;
  if (kept > p.depositCents) return { ok: false, code: 'deductions_exceed_deposit', message: 'Deductions above the deposit are invoiced separately, not taken.' };
  const refundCents = p.depositCents - kept;
  if (refundCents > p.refundableRemainderCents) {
    return { ok: false, code: 'exceeds_charge', message: 'The refund would exceed what remains of the original charge.' };
  }
  return { ok: true, refundCents, keptCents: kept, damageCents: p.damageCents, lateFeeCents: p.lateFeeCents };
}

/** Stable key for one refund obligation. Same reason + subject ⇒ same obligation. */
export function refundObligationKey(reason: RefundReason, subjectId: string): string {
  return `refund:${reason}:${subjectId}`;
}
