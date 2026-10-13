import type { ProviderCallResult } from '@/lib/core/ports';
import type { WebhookResult } from './types';
import { paystackPayments } from './paystack-ports';
import { confirmServiceBookingPayment, type ServiceBookingConfirmation } from './fulfil';

/**
 * Asking Paystack, server to server, whether a service (creator) booking was
 * paid, so the booking no longer depends on the webhook alone.
 *
 * Used by the page Paystack sends the customer back to
 * (app/api/service-bookings/callback) and by the daily job before it closes
 * an unpaid booking. Both confirm through confirmServiceBookingPayment, the
 * same guarded compare-and-set the webhook uses (amount in cents, ZAR, only
 * from pending + unpaid), so a webhook arriving later is a harmless repeat.
 *
 * What a check can say:
 *   paid        - Paystack reports status "success";
 *   not_paid    - definitely not paid: failed, abandoned, reversed, or no such
 *                 transaction ("Transaction reference not found");
 *   pending     - still in progress (ongoing, pending, processing, queued):
 *                 the customer may still finish;
 *   unreachable - no clear answer (timeout, 5xx, refused key): assume nothing.
 */

export type ChargeCheck =
  | { state: 'paid'; providerTransactionId: string; amountCents: number; currency: string }
  | { state: 'not_paid'; reason: string }
  | { state: 'pending'; status: string }
  | { state: 'unreachable'; message: string };

type ChargeValue = { status: string; amountCents: number; currency: string; providerTransactionId: string };

const NOT_PAID = new Set(['failed', 'abandoned', 'reversed']);

/** Pure: turn Paystack's verify answer into what we know. */
export function classifyCharge(r: ProviderCallResult<ChargeValue>): ChargeCheck {
  if (!r.ok) {
    // A 4xx "not found" is a definite answer: no transaction was ever started
    // under this reference. Any other refusal (a bad key, say) proves nothing.
    if (r.kind === 'rejected' && /not\s*found/i.test(r.message)) return { state: 'not_paid', reason: 'not_found' };
    return { state: 'unreachable', message: r.message };
  }
  const status = r.value.status.toLowerCase();
  if (status === 'success') {
    return { state: 'paid', providerTransactionId: r.value.providerTransactionId, amountCents: r.value.amountCents, currency: r.value.currency };
  }
  if (NOT_PAID.has(status)) return { state: 'not_paid', reason: status };
  return { state: 'pending', status: status || 'unknown' };
}

/** Ask Paystack about a reference. Never throws. */
export async function checkPaystackCharge(reference: string): Promise<ChargeCheck> {
  try {
    return classifyCharge(await paystackPayments.verifyCharge(reference));
  } catch (err) {
    // e.g. PAYSTACK_SECRET_KEY missing: no answer, so assume nothing.
    return { state: 'unreachable', message: err instanceof Error ? err.message : 'verify error' };
  }
}

/** The WebhookResult the shared confirmation expects, built from a verified charge. */
export function webhookFromCharge(reference: string, charge: Extract<ChargeCheck, { state: 'paid' }>): WebhookResult {
  return {
    valid: true,
    status: 'COMPLETE',
    providerPaymentId: charge.providerTransactionId,
    paymentId: reference,
    amountGross: charge.amountCents / 100,
    raw: {
      event: 'charge.success',
      reference,
      currency: charge.currency,
      custom_str1: 'service_booking',
    },
  };
}

export type ServicePaymentOutcome =
  | { state: 'paid'; confirmation: ServiceBookingConfirmation }
  | Exclude<ChargeCheck, { state: 'paid' }>;

/**
 * Check a service booking's payment with Paystack and, when it was paid,
 * confirm the booking exactly as the webhook would. Idempotent.
 * Throws only when the confirmation itself hits a database error.
 */
export async function verifyAndConfirmServiceBooking(
  reference: string,
  deps: { check?: (ref: string) => Promise<ChargeCheck>; confirm?: (w: WebhookResult) => Promise<ServiceBookingConfirmation> } = {},
): Promise<ServicePaymentOutcome> {
  const check = deps.check ?? checkPaystackCharge;
  const confirm = deps.confirm ?? confirmServiceBookingPayment;
  const charge = await check(reference);
  if (charge.state !== 'paid') return charge;
  const confirmation = await confirm(webhookFromCharge(reference, charge));
  return { state: 'paid', confirmation };
}

/**
 * Where the return page sends the customer, by outcome. A payment we took
 * but could not apply (wrong amount, booking cancelled meanwhile) is "held":
 * a person reviews it, and the customer is told so rather than "failed".
 */
export function callbackStatus(outcome: ServicePaymentOutcome): 'success' | 'held' | 'failed' | 'pending' | 'error' {
  switch (outcome.state) {
    case 'paid':
      return outcome.confirmation === 'confirmed' || outcome.confirmation === 'already_paid' ? 'success' : 'held';
    case 'not_paid':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'error';
  }
}

/** Paystack references are letters, digits, "-", "." and "=" only. */
const REFERENCE = /^[A-Za-z0-9.=-]{1,100}$/;

/**
 * The reference from the return URL. Paystack adds ?trxref=&reference= to the
 * callback URL, and ours already carries ?reference=, so read either and drop
 * anything glued on after a stray "?".
 */
export function referenceFromCallback(params: URLSearchParams): string | null {
  for (const key of ['reference', 'trxref']) {
    const raw = params.get(key);
    if (!raw) continue;
    const ref = raw.split('?')[0].trim();
    if (REFERENCE.test(ref)) return ref;
  }
  return null;
}

/**
 * The daily job's sort of service bookings left unpaid past 72 hours. Each is
 * checked with Paystack first, one at a time:
 *   paid        -> confirmed (by the check itself), never cancelled;
 *   not_paid    -> cancelled;
 *   pending     -> left for the next run (the customer may be mid-payment);
 *   unreachable -> left for the next run: no answer is not "unpaid".
 * Without any Paystack key no Paystack charge can exist, so all are cancelled
 * as before. A confirmation error leaves that booking alone.
 */
export async function sortUnpaidServiceBookings(
  bookings: { id: string; reference: string }[],
  verify: (reference: string) => Promise<ServicePaymentOutcome>,
  opts: { providerAvailable?: boolean } = {},
): Promise<{ cancel: string[]; outcomes: Record<string, number> }> {
  const providerAvailable = opts.providerAvailable ?? Boolean(process.env.PAYSTACK_SECRET_KEY);
  const outcomes: Record<string, number> = {};
  const count = (k: string) => { outcomes[k] = (outcomes[k] ?? 0) + 1; };
  if (!providerAvailable) {
    bookings.forEach(() => count('no_provider'));
    return { cancel: bookings.map((b) => b.id), outcomes };
  }
  const cancel: string[] = [];
  for (const b of bookings) {
    try {
      const outcome = await verify(b.reference);
      if (outcome.state === 'paid') count(`paid_${outcome.confirmation}`);
      else count(outcome.state);
      if (outcome.state === 'not_paid') cancel.push(b.id);
    } catch {
      count('confirm_error');
    }
  }
  return { cancel, outcomes };
}
