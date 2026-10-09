import { createAdminClient } from '@/lib/supabase/server';
import type { PaymentProvider } from './types';
import { paystack, verifyPayment as verifyPaystack } from './paystack';
import { yoco, isYocoReference } from './yoco';
import { paystackPayments } from './paystack-ports';

/**
 * Money that already moved stays with the provider that moved it. Switching
 * PAYMENT_PROVIDER changes where NEW checkouts go; a refund or a payment check
 * on an older booking must still go to the provider that took that payment.
 * The stored reference says which: Yoco checkout ids start "ch_", anything
 * else is Paystack's.
 */
export function providerForReference(reference: string): PaymentProvider {
  return isYocoReference(reference) ? yoco : paystack;
}

/** A payment the team took by hand (EFT, cash, a card link) and recorded as "manual:<method>:<ref>". */
export function isManualReference(reference: string | null | undefined): boolean {
  return typeof reference === 'string' && reference.startsWith('manual:');
}

export function manualReference(method: 'eft' | 'cash' | 'card_link', ref: string): string {
  const clean = ref.replace(/[^\w\-./]/g, '').slice(0, 60) || 'none';
  return `manual:${method}:${clean}`;
}

/**
 * Refund through whichever provider took the payment. Amount in rands.
 * Money taken by hand goes back by hand: this says so rather than asking a
 * payment provider to refund a payment it never saw.
 */
export async function refundPayment(reference: string, amount?: number): Promise<{ success: boolean; error?: string; manual?: boolean }> {
  if (isManualReference(reference)) {
    return { success: false, manual: true, error: 'Paid by EFT or cash: refund it by hand and record it.' };
  }
  return providerForReference(reference).refund(reference, amount);
}

/**
 * What we KNOW after asking for a refund:
 *   refunded — the provider accepted it;
 *   rejected — the provider refused it, so nothing moved (safe to try again);
 *   unknown  — no clear answer (timeout, network error, 5xx): it MAY have gone
 *              through. Never refund again until someone has checked the
 *              provider (its refund list for the reference, or the dashboard);
 *   manual   — paid by EFT or cash: a person refunds it by hand.
 */
export type RefundAttempt =
  | { outcome: 'refunded'; providerRefundId: string | null }
  | { outcome: 'rejected'; message: string }
  | { outcome: 'unknown'; message: string }
  | { outcome: 'manual'; message: string };

/**
 * Refund part or all of a payment, classifying the result. Amount in whole
 * rands (as bookings store it), sent to the provider in integer cents.
 *
 * A Paystack payment goes through the Paystack PaymentPort adapter (the one
 * lib/payments/ports.ts selects for PAYMENT_PROVIDER=paystack), which tells a
 * refusal apart from an unknown outcome. It is chosen by the reference, not by
 * PAYMENT_PROVIDER, for the reason given at the top of this file.
 *
 * Yoco's refund call answers only success or failure, so any Yoco failure is
 * treated as unknown: a person checks before refunding by hand.
 */
export async function refundWithOutcome(params: {
  reference: string;
  amountRands: number;
  /** Stable per obligation, e.g. "service-cancel:<booking id>". Sent where the provider supports it. */
  idempotencyKey: string;
}): Promise<RefundAttempt> {
  const { reference, amountRands, idempotencyKey } = params;
  if (isManualReference(reference)) {
    return { outcome: 'manual', message: 'Paid by EFT or cash: refund it by hand and record it.' };
  }
  const amountCents = Math.round(Number(amountRands) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { outcome: 'rejected', message: 'invalid refund amount' };
  }
  if (isYocoReference(reference)) {
    try {
      const r = await yoco.refund(reference, amountCents / 100);
      return r.success
        ? { outcome: 'refunded', providerRefundId: null }
        : { outcome: 'unknown', message: r.error ?? 'Yoco did not confirm the refund' };
    } catch (err) {
      return { outcome: 'unknown', message: err instanceof Error ? err.message : 'Yoco refund error' };
    }
  }
  try {
    const r = await paystackPayments.refund({ transactionReference: reference, amountCents, idempotencyKey });
    if (r.ok) {
      // Paystack answers a refund it will not make with status "failed".
      if (r.value.status === 'failed') return { outcome: 'rejected', message: 'provider reports the refund failed' };
      return { outcome: 'refunded', providerRefundId: r.value.providerRefundId || null };
    }
    return r.kind === 'rejected' ? { outcome: 'rejected', message: r.message } : { outcome: 'unknown', message: r.message };
  } catch (err) {
    // Not expected (the adapter classifies its own errors); assume the worst.
    return { outcome: 'unknown', message: err instanceof Error ? err.message : 'refund error' };
  }
}

/**
 * Whether a payment really happened, and for how much (rands).
 *
 * Paystack is asked directly. Yoco has no "look up a checkout" call, so a Yoco
 * payment counts only once its signed webhook has been recorded in
 * payment_confirmations (only the server can write that table).
 */
export async function verifyPayment(reference: string): Promise<{ success: boolean; amount: number }> {
  if (isManualReference(reference)) {
    // Recorded by an admin in /admin/bookings (mark as paid); trusted as such.
    const { data } = await createAdminClient()
      .from('payment_confirmations')
      .select('status, amount')
      .eq('reference', reference)
      .maybeSingle();
    return { success: data?.status === 'COMPLETE', amount: Number(data?.amount ?? 0) };
  }
  if (!isYocoReference(reference)) {
    const out = await verifyPaystack(reference);
    return { success: out.success, amount: out.amount };
  }
  const { data } = await createAdminClient()
    .from('payment_confirmations')
    .select('status, amount')
    .eq('reference', reference)
    .maybeSingle();
  return { success: data?.status === 'COMPLETE', amount: Number(data?.amount ?? 0) };
}

/** Records a verified provider webhook, once per reference. */
export async function recordConfirmation(params: {
  provider: string;
  reference: string;
  paymentId: string;
  amount: number;
  status: string;
  eventType: string;
}): Promise<void> {
  if (!params.reference) return;
  const { error } = await createAdminClient()
    .from('payment_confirmations')
    .upsert(
      {
        reference: params.reference,
        provider: params.provider,
        payment_id: params.paymentId,
        amount: params.amount,
        status: params.status,
        event_type: params.eventType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'reference' },
    );
  if (error) console.error('[payments] could not record confirmation:', error.message);
}
