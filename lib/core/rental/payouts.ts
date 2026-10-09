import { assertCents } from '@/lib/core/pricing/money';

/**
 * Owner payouts for community gear (spec §7.8). Pure.
 *
 * One payout obligation per completed booking, with one stable transfer
 * reference for its whole life. If a transfer request times out, the SAME
 * reference is queried or re-sent. Paystack treats a reference as unique, so a
 * repeat cannot pay twice (T16). A new reference is never invented for an
 * inconclusive transfer.
 */

export const PAYOUT_STATES = [
  'scheduled',
  'held',
  'approved',
  'claimed',
  'pending',
  'otp',
  'received',
  'success',
  'failed',
  'reversed',
  'blocked',
  'rejected',
  'abandoned',
  'needs_attention',
] as const;

export type PayoutState = (typeof PAYOUT_STATES)[number];

/** Paystack transfer statuses (and transfer.* webhook suffixes) to ours. */
export function mapProviderTransferStatus(status: string): PayoutState | null {
  const s = status.toLowerCase();
  return (['pending', 'otp', 'received', 'success', 'failed', 'reversed', 'blocked', 'rejected', 'abandoned'] as const).find((x) => x === s) ?? null;
}

const IN_FLIGHT: readonly PayoutState[] = ['claimed', 'pending', 'otp', 'received'];

export type PayoutUpdate =
  | { apply: true; to: PayoutState; ledger: 'completed' | 'reversed' | null; alertStaff: boolean; notifyOwner: 'completed' | 'failed' | null }
  | { apply: false; reason: 'duplicate' | 'stale' | 'unknown_payout' };

/**
 * Apply a provider-reported transfer status.
 *
 * - success is booked to the ledger once. A repeated success is a duplicate.
 * - reversed after success re-opens the owner's balance (T17), and a person
 *   looks at why.
 * - a late failure after success is ignored. Success is final unless the
 *   transfer is reversed.
 */
export function applyProviderTransferStatus(current: PayoutState, incoming: PayoutState): PayoutUpdate {
  if (current === incoming) return { apply: false, reason: 'duplicate' };
  if (current === 'reversed') return { apply: false, reason: 'stale' };
  if (current === 'success') {
    return incoming === 'reversed'
      ? { apply: true, to: 'reversed', ledger: 'reversed', alertStaff: true, notifyOwner: null }
      : { apply: false, reason: 'stale' };
  }
  if (incoming === 'success') return { apply: true, to: 'success', ledger: 'completed', alertStaff: false, notifyOwner: 'completed' };
  if (incoming === 'reversed') {
    // Reversal of a transfer we never saw succeed: nothing was booked, flag it.
    return { apply: true, to: 'reversed', ledger: null, alertStaff: true, notifyOwner: null };
  }
  if (['failed', 'blocked', 'rejected', 'abandoned'].includes(incoming)) {
    return { apply: true, to: incoming, ledger: null, alertStaff: true, notifyOwner: 'failed' };
  }
  // pending / otp / received: only forwards from earlier in-flight states.
  const order: PayoutState[] = ['approved', 'claimed', 'pending', 'otp', 'received'];
  if (order.indexOf(incoming) <= order.indexOf(current) && order.indexOf(current) >= 0) return { apply: false, reason: 'stale' };
  return { apply: true, to: incoming, ledger: null, alertStaff: incoming === 'otp', notifyOwner: null };
}

export interface PayoutEligibilityFacts {
  ownerVerified: boolean;
  /** Recipient created from a bank account validated against the owner. */
  payoutRecipientValidated: boolean;
  bookingStatus: string;
  /** The renter's payment for this booking was verified and not refunded/charged back. */
  rentalPaymentConfirmed: boolean;
  inspectionCompleted: boolean;
  openPayoutBlockingDisputes: number;
  depositSettled: boolean;
  /** A payout for this booking already succeeded or is in flight. */
  payoutAlreadyStarted: boolean;
  completedAt: string | null;
  /**
   * Phase 4: why delivery holds this line's settlement (checkRentalSettlement:
   * an open delivery incident, a return delivery not yet received and
   * inspected). Empty or absent = no delivery hold.
   */
  deliveryHoldReasons?: readonly string[];
}

export type PayoutEligibility =
  | { eligible: true; dueAt: Date }
  | { eligible: false; reasons: string[]; dueAt: Date | null };

/** Every condition in spec §7.8 must hold. Each failed one is listed. */
export function checkPayoutEligibility(f: PayoutEligibilityFacts, now: Date, delayHours: number): PayoutEligibility {
  const reasons: string[] = [];
  if (!f.ownerVerified) reasons.push('owner_not_verified');
  if (!f.payoutRecipientValidated) reasons.push('payout_account_not_validated');
  if (f.bookingStatus !== 'completed') reasons.push('booking_not_completed');
  if (!f.rentalPaymentConfirmed) reasons.push('payment_not_confirmed');
  if (!f.inspectionCompleted) reasons.push('inspection_not_completed');
  if (f.openPayoutBlockingDisputes > 0) reasons.push('open_dispute');
  if (!f.depositSettled) reasons.push('deposit_not_settled');
  if (f.payoutAlreadyStarted) reasons.push('payout_already_started');
  for (const r of f.deliveryHoldReasons ?? []) reasons.push(`delivery_${r}`);

  const dueAt = f.completedAt ? new Date(new Date(f.completedAt).getTime() + delayHours * 3_600_000) : null;
  if (!dueAt) reasons.push('no_completion_time');
  else if (dueAt.getTime() > now.getTime()) reasons.push('delay_not_elapsed');

  return reasons.length ? { eligible: false, reasons, dueAt } : { eligible: true, dueAt: dueAt as Date };
}

export interface PayoutInstruction {
  reference: string;
  amountCents: number;
  recipientCode: string;
  state: PayoutState;
}

/**
 * Paystack Transfer Approval URL: the provider asks us to confirm each
 * transfer before sending it. Approve only a transfer that matches an
 * instruction we created and approved: same reference, exact amount, same
 * recipient, and currently being sent. Anything else is refused. That covers
 * a leaked secret key, a replay, or a tampered amount.
 */
export function approveTransferRequest(
  request: { reference: string; amountCents: number; recipientCode: string; currency: string },
  instruction: PayoutInstruction | null,
): { approve: boolean; reason: string } {
  if (!instruction) return { approve: false, reason: 'unknown_reference' };
  if (request.currency !== 'ZAR') return { approve: false, reason: 'currency_mismatch' };
  if (!Number.isSafeInteger(request.amountCents) || request.amountCents !== instruction.amountCents) return { approve: false, reason: 'amount_mismatch' };
  if (request.recipientCode !== instruction.recipientCode) return { approve: false, reason: 'recipient_mismatch' };
  if (!IN_FLIGHT.includes(instruction.state)) return { approve: false, reason: `not_in_flight:${instruction.state}` };
  return { approve: true, reason: 'matched' };
}

export type PayoutNextAction = { action: 'submit' } | { action: 'reconcile_first' } | { action: 'wait' } | { action: 'escalate'; why: string } | { action: 'none' };

export function nextPayoutAction(
  p: { state: PayoutState; providerTransferCode: string | null; claimedAt: string | null; updatedAt?: string | null },
  now: Date,
  claimTimeoutMinutes = 10,
  pollAfterHours = 1,
): PayoutNextAction {
  switch (p.state) {
    case 'approved':
      return { action: 'submit' };
    case 'claimed': {
      const at = p.claimedAt ? new Date(p.claimedAt).getTime() : 0;
      // Same reference is safe to look up; never send under a new one.
      return now.getTime() - at > claimTimeoutMinutes * 60_000 ? { action: 'reconcile_first' } : { action: 'wait' };
    }
    case 'pending':
    case 'received': {
      if (!p.providerTransferCode) return { action: 'reconcile_first' };
      // A transfer the provider accepted is normally finished by its webhook.
      // If none arrives, look it up by our stable reference.
      const at = p.updatedAt ? new Date(p.updatedAt).getTime() : NaN;
      return !Number.isNaN(at) && now.getTime() - at > pollAfterHours * 3_600_000 ? { action: 'reconcile_first' } : { action: 'wait' };
    }
    case 'otp':
      return { action: 'escalate', why: 'transfer needs OTP approval in the provider dashboard (configuration issue)' };
    case 'failed':
    case 'blocked':
    case 'rejected':
    case 'abandoned':
    case 'reversed':
    case 'needs_attention':
      return { action: 'escalate', why: `transfer ${p.state}` };
    case 'scheduled':
    case 'held':
      return { action: 'none' };
    case 'success':
      return { action: 'none' };
  }
}

/** Stable transfer reference: one per booking, forever. Paystack allows 16–50 chars of a-z0-9_-. */
export function payoutReference(bookingId: string): string {
  const ref = `tvpo_${bookingId.replace(/-/g, '').toLowerCase()}`;
  if (!/^[a-z0-9_-]{16,50}$/.test(ref)) throw new RangeError('invalid payout reference');
  return ref;
}

/** Owner amount = owner share; provider transfer fee is recorded separately, never silently deducted (spec §3.4). */
export function payoutAmount(p: { ownerShareCents: number; adjustmentsCents?: number }): number {
  assertCents(p.ownerShareCents, 'ownerShareCents');
  const adj = p.adjustmentsCents ?? 0;
  assertCents(adj, 'adjustmentsCents');
  const amount = p.ownerShareCents + adj;
  if (amount < 0) throw new RangeError('payout cannot be negative');
  return amount;
}
