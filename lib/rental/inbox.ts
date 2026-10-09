import { createAdminClient } from '@/lib/supabase/server';
import { lateConfirmationAllowed } from '@/lib/rental/eligibility-server';
import type { WebhookResult } from '@/lib/payments/types';
import { handlePaymentComplete, handlePaymentFailed } from '@/lib/payments/fulfil';
import { recordConfirmation } from '@/lib/payments/routing';
import { handleServiceTransferEvent } from '@/lib/payments/service-transfers';
import { eventDedupeKey } from '@/lib/core/rental/payments';
import { processChargeEvent, processRefundEvent, processTransferEvent } from '@/lib/core/rental/use-cases';
import { trackFunnel } from '@/lib/analytics/funnel';
import { systemClock } from '@/lib/core/ports';
import { SupabasePayouts, SupabaseRefunds, SupabaseRentalPayments, isMissingPipeline } from './repos';

/**
 * Durable payment-event inbox (spec §7.6).
 *
 *   verify signature (route) → parse → STORE → acknowledge → process → mark
 *
 * An event is acknowledged only once it is stored. Processing failures leave
 * the row `failed` with a back-off, and the rental-pipeline job retries it.
 * After 8 attempts it goes `dead` and shows up in the admin queue.
 */

type Json = Record<string, unknown>;

export interface ParsedPaystackEvent {
  event: string;
  dataId: string | null;
  status: string | null;
  reference: string | null;
  amountCents: number | null;
  currency: string | null;
  metadataUserId: string | null;
  paymentType: string | null;
  /** Refund events: the charge the refund belongs to. */
  transactionReference: string | null;
  /** Transfer events. */
  transferCode: string | null;
  /** Minimal copy kept in the inbox: ids, amounts, statuses, our own metadata. No card, bank or customer details. */
  minimal: Json;
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function parsePaystackEvent(body: string): ParsedPaystackEvent | null {
  let payload: Json;
  try {
    payload = JSON.parse(body) as Json;
  } catch {
    return null;
  }
  const event = s(payload.event);
  const data = (payload.data ?? {}) as Json;
  if (!event || typeof data !== 'object') return null;

  const meta = (typeof data.metadata === 'object' && data.metadata !== null ? data.metadata : {}) as Json;
  const tx = (typeof data.transaction === 'object' && data.transaction !== null ? data.transaction : {}) as Json;
  const amount = Number(data.amount);
  const ourMeta: Json = {};
  for (const k of ['customStr1', 'customStr2', 'customStr3', 'customStr4', 'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'payment_id']) {
    if (typeof meta[k] === 'string') ourMeta[k] = meta[k];
  }

  const transactionReference = s(data.transaction_reference) ?? s(tx.reference) ?? (event.startsWith('refund.') ? s(data.transaction) : null);
  const minimal: Json = {
    event,
    data: {
      id: data.id ?? null,
      reference: data.reference ?? null,
      status: data.status ?? null,
      amount: Number.isFinite(amount) ? amount : null,
      currency: data.currency ?? null,
      transfer_code: data.transfer_code ?? null,
      transaction_reference: transactionReference,
      transaction_id: tx.id ?? (event.startsWith('refund.') && typeof data.transaction !== 'object' ? data.transaction : null) ?? null,
      refund_reference: data.refund_reference ?? null,
      metadata: ourMeta,
    },
  };

  return {
    event,
    dataId: s(data.id),
    status: s(data.status),
    reference: s(data.reference),
    amountCents: Number.isSafeInteger(amount) ? amount : null,
    currency: s(data.currency),
    metadataUserId: s(meta.customStr2 ?? meta.custom_str2),
    paymentType: s(meta.customStr1 ?? meta.custom_str1),
    transactionReference,
    transferCode: s(data.transfer_code),
    minimal,
  };
}

export type StoreResult = { stored: true; id: string } | { stored: false; duplicate: true } | { stored: false; missingPipeline: true };

/** Persist an event. Throws if the database is unavailable, so the route can answer 500 and Paystack retries. */
export async function storeEvent(provider: string, parsed: ParsedPaystackEvent): Promise<StoreResult> {
  const db = createAdminClient();
  const dedupeKey = eventDedupeKey(provider, parsed.event, parsed.dataId, parsed.status);
  const { data, error } = await db
    .from('payment_events')
    .upsert(
      {
        provider,
        provider_event_id: parsed.dataId,
        dedupe_key: dedupeKey,
        event_type: parsed.event,
        provider_reference: parsed.reference ?? parsed.transactionReference,
        payload: parsed.minimal,
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('id');
  if (error) {
    if (isMissingPipeline(error)) return { stored: false, missingPipeline: true };
    throw new Error(`payment_events insert failed: ${error.message}`);
  }
  if (!data || data.length === 0) return { stored: false, duplicate: true };
  return { stored: true, id: (data[0] as { id: string }).id };
}

/** Build the legacy WebhookResult for code paths that predate the pipeline (subscriptions, service bookings, legacy checkouts). */
function legacyWebhook(p: ParsedPaystackEvent): WebhookResult {
  const meta = ((p.minimal.data as Json).metadata ?? {}) as Record<string, string>;
  const raw: Record<string, string> = {
    event: p.event,
    reference: p.reference ?? '',
    paystack_id: p.dataId ?? '',
    amount: String((p.amountCents ?? 0) / 100),
    currency: p.currency ?? 'ZAR',
    status: p.status ?? '',
    ...meta,
  };
  return {
    valid: true,
    status: p.event === 'charge.success' ? 'COMPLETE' : p.event === 'charge.failed' ? 'FAILED' : 'PENDING',
    providerPaymentId: p.dataId ?? '',
    paymentId: p.reference ?? '',
    amountGross: (p.amountCents ?? 0) / 100,
    raw,
  };
}

/** Process one parsed event. Returns a short outcome for the inbox row and logs. */
export async function processPaystackEvent(p: ParsedPaystackEvent): Promise<string> {
  if (p.event === 'charge.success' || p.event === 'charge.failed') {
    const repo = new SupabaseRentalPayments();
    const intent = p.reference ? await repo.getIntent(p.reference) : null;
    if (intent) {
      if (p.amountCents === null || !p.dataId) return 'invalid_charge_payload';
      const outcome = await processChargeEvent(
        {
          kind: p.event,
          reference: p.reference as string,
          providerTransactionId: p.dataId,
          amountCents: p.amountCents,
          currency: p.currency ?? '',
          metadataUserId: p.metadataUserId,
        },
        { repo, clock: systemClock, lateAllowed: (i) => lateConfirmationAllowed(createAdminClient(), i) },
      );
      if (outcome === 'confirmed' || outcome === 'confirmed_late') {
        trackFunnel('payment_confirmed', { userId: intent.userId, meta: { groupId: intent.checkoutGroupId, source: 'webhook' } });
      }
      return outcome;
    }
    // Everything without a rental intent keeps its existing (now guarded) path.
    const webhook = legacyWebhook(p);
    await recordConfirmation({
      provider: 'paystack',
      reference: webhook.providerPaymentId,
      paymentId: webhook.paymentId,
      amount: webhook.amountGross,
      status: webhook.status,
      eventType: p.event,
    });
    if (webhook.status === 'COMPLETE') await handlePaymentComplete(webhook);
    else await handlePaymentFailed(webhook);
    return `legacy_${webhook.status.toLowerCase()}`;
  }

  if (p.event.startsWith('refund.')) {
    const status = p.status ?? p.event.slice('refund.'.length);
    return processRefundEvent(
      { providerRefundId: p.dataId, transactionReference: p.transactionReference, amountCents: p.amountCents, status },
      { refunds: new SupabaseRefunds() },
    );
  }

  if (p.event.startsWith('transfer.')) {
    const reference = p.reference;
    if (!reference) return 'transfer_without_reference';
    const status = p.event.slice('transfer.'.length) || (p.status ?? '');
    const outcome = await processTransferEvent({ reference, status, transferCode: p.transferCode }, { payouts: new SupabasePayouts() });
    if (outcome !== 'unknown_payout') return outcome;
    // Not a gear payout: the creator (service booking) payout path.
    await handleServiceTransferEvent(p.event, reference);
    return 'service_transfer';
  }

  return 'ignored_event_type';
}

const TERMINAL_IGNORED = new Set(['ignored_event_type', 'unknown_reference', 'unknown_refund', 'unknown_status', 'transfer_without_reference', 'invalid_charge_payload']);

/** Process a stored inbox row and record the result. Never throws. */
export async function processStoredEvent(id: string, parsed: ParsedPaystackEvent): Promise<string> {
  const db = createAdminClient();
  try {
    const outcome = await processPaystackEvent(parsed);
    await db
      .from('payment_events')
      .update({
        processing_status: TERMINAL_IGNORED.has(outcome) ? 'ignored' : 'processed',
        processed_at: new Date().toISOString(),
        outcome,
        last_error: null,
      })
      .eq('id', id);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
    const { data: row } = await db.from('payment_events').select('retry_count').eq('id', id).maybeSingle();
    const tries = (row as { retry_count?: number } | null)?.retry_count ?? 0;
    // Back off 1, 2, 4 … minutes, capped at an hour.
    const delayMs = Math.min(60, 2 ** tries) * 60_000;
    await db
      .from('payment_events')
      .update({ processing_status: 'failed', last_error: message, next_attempt_at: new Date(Date.now() + delayMs).toISOString() })
      .eq('id', id);
    console.error(`[payment-inbox] event ${id} failed: ${message}`);
    return 'failed';
  }
}

/** Retry stored events that are due (called by the rental-pipeline job). */
export async function drainInbox(limit = 50): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc('claim_payment_events', { p_limit: limit, p_max_retries: 8 });
  if (error) {
    if (isMissingPipeline(error)) return { claimed: 0, outcomes: {} };
    throw new Error(`claim_payment_events failed: ${error.message}`);
  }
  const outcomes: Record<string, number> = {};
  for (const row of (data ?? []) as { id: string; payload: Json; provider: string }[]) {
    if (row.provider !== 'paystack') continue;
    const parsed = parsePaystackEvent(JSON.stringify(row.payload));
    if (!parsed) continue;
    const outcome = await processStoredEvent(row.id, parsed);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { claimed: (data ?? []).length, outcomes };
}
