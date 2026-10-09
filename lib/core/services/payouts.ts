import type { ProviderCallResult, ProviderTransfer } from '@/lib/core/ports';

/**
 * Creator payouts for service bookings: which reference, and what to do next.
 * Pure.
 *
 * One booking, one transfer reference, for life (`tvsp_<booking id>`). Paystack
 * treats a reference as unique, so sending the same one again cannot pay
 * twice. Before anything is sent again, the reference on record is looked up
 * with the provider: a transfer that may have gone through is never repeated
 * under a new reference.
 *
 * Older bookings carry a `payout-<ref>-<time>` reference from before this
 * scheme, when every attempt invented a new one. Those are looked up the same
 * way; when the provider has never heard of it, the stable reference is used.
 * When earlier attempts may exist under references we no longer hold, a person
 * decides.
 */

const PREFIX = 'tvsp_';

/** Stable transfer reference: one per booking, forever. Paystack allows 16–50 chars of a-z0-9_-. */
export function servicePayoutReference(bookingId: string): string {
  const ref = `${PREFIX}${bookingId.replace(/-/g, '').toLowerCase()}`;
  if (!/^[a-z0-9_-]{16,50}$/.test(ref)) throw new RangeError('invalid service payout reference');
  return ref;
}

export function isStableServicePayoutReference(reference: string | null | undefined): boolean {
  return typeof reference === 'string' && reference.startsWith(PREFIX);
}

export interface ServicePayoutState {
  bookingId: string;
  /** bookings.payout_status: null | pending | processing | paid | failed */
  payoutStatus: string | null;
  payoutReference: string | null;
  /** When the current attempt was claimed. Falls back to updated_at on older rows. */
  claimedAt: string | null;
  /** Automatic attempts already made (bookings.payout_retry_count). */
  attempts: number;
}

export type ServicePayoutStep =
  /** Nothing was ever sent: send under the stable reference. */
  | { step: 'send'; reference: string }
  /** Something may have been sent: ask the provider about this reference first. */
  | { step: 'lookup'; reference: string }
  | { step: 'wait'; why: string }
  | { step: 'escalate'; why: string }
  | { step: 'done' };

export function nextServicePayoutStep(
  p: ServicePayoutState,
  now: Date,
  opts: { maxAttempts: number; claimTimeoutMinutes?: number },
): ServicePayoutStep {
  const stable = servicePayoutReference(p.bookingId);
  const claimTimeoutMs = (opts.claimTimeoutMinutes ?? 10) * 60_000;

  if (p.payoutStatus === 'paid') return { step: 'done' };

  if (p.payoutStatus === 'processing') {
    if (!p.payoutReference) return { step: 'escalate', why: 'payout marked processing with no reference on record' };
    const at = p.claimedAt ? new Date(p.claimedAt).getTime() : NaN;
    if (!Number.isNaN(at) && now.getTime() - at < claimTimeoutMs) return { step: 'wait', why: 'a payout attempt is in progress' };
    return { step: 'lookup', reference: p.payoutReference };
  }

  // pending, failed, or never set.
  if (p.attempts >= opts.maxAttempts) {
    return { step: 'escalate', why: `${p.attempts} automatic payout attempts made; a person must check the provider and pay by hand` };
  }
  if (!p.payoutReference) {
    if (p.payoutStatus === 'failed') {
      return { step: 'escalate', why: 'payout marked failed with no reference on record' };
    }
    return { step: 'send', reference: stable };
  }
  if (!isStableServicePayoutReference(p.payoutReference) && p.attempts > 0) {
    // The old scheme replaced the reference on every retry: earlier attempts
    // may exist under references we no longer hold.
    return { step: 'escalate', why: `legacy payout reference ${p.payoutReference} after ${p.attempts} retries; earlier attempts cannot be checked automatically` };
  }
  return { step: 'lookup', reference: p.payoutReference };
}

export type AfterLookup =
  | { then: 'send'; reference: string }
  | { then: 'mark_paid' }
  | { then: 'mark_in_flight' }
  | { then: 'wait'; why: string }
  | { then: 'escalate'; why: string };

/**
 * What to do once the provider has answered about a reference.
 * - not found: nothing was ever sent, so send under the stable reference;
 * - success: record it (the webhook was missed);
 * - pending / received: in flight, wait for the webhook;
 * - otp: the provider wants a manual approval, a configuration problem;
 * - failed / reversed / rejected / blocked / abandoned: a person decides.
 *   Re-sending could repeat a mistake (a wrong account), and the provider
 *   refuses a used reference anyway;
 * - no answer: try again on the next run.
 */
export function afterServicePayoutLookup(
  lookup: ProviderCallResult<ProviderTransfer | null>,
  bookingId: string,
): AfterLookup {
  if (!lookup.ok) return { then: 'wait', why: `provider lookup failed (${lookup.kind}): ${lookup.message}` };
  if (lookup.value === null) return { then: 'send', reference: servicePayoutReference(bookingId) };
  const status = lookup.value.status.toLowerCase();
  if (status === 'success') return { then: 'mark_paid' };
  if (['pending', 'received', 'processing', 'queued'].includes(status)) return { then: 'mark_in_flight' };
  if (status === 'otp') return { then: 'escalate', why: 'transfer needs OTP approval in the provider dashboard (configuration issue)' };
  return { then: 'escalate', why: `provider reports the transfer ${status || 'in an unknown state'}` };
}
