import { NextRequest, NextResponse } from 'next/server';
import { paystack } from '@/lib/payments/paystack';
import { logEvent } from '@/lib/data/events';
import { parsePaystackEvent, processPaystackEvent, processStoredEvent, storeEvent } from '@/lib/rental/inbox';
import { dispatchOutbox } from '@/lib/rental/notify';

export const dynamic = 'force-dynamic';

/**
 * Paystack webhook (spec §7.6).
 *
 * 1. Verify the HMAC signature over the raw body; anything else is 401 (T10).
 * 2. Store the event in the durable inbox (payment_events, unique per event).
 *    If it cannot be stored we answer 500, so Paystack delivers it again: an
 *    event is never acknowledged before it is safely kept.
 * 3. Process it. A processing failure is recorded on the inbox row and
 *    retried by the rental-pipeline job; Paystack still gets 200 because the
 *    event is durable.
 *
 * While migration 070 is not applied, events are processed directly as
 * before (the inbox table does not exist yet).
 */
export async function POST(request: NextRequest) {
  if (!paystack.isConfigured()) {
    return NextResponse.json({ error: 'Payment provider is not configured' }, { status: 503 });
  }

  const body = await request.text();
  const webhook = await paystack.validateWebhook({
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
    body,
    headers: Object.fromEntries(request.headers.entries()),
  });
  if (!webhook.valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const parsed = parsePaystackEvent(body);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  logEvent({
    eventType: `paystack_${parsed.event.replace(/\./g, '_')}`,
    eventCategory: parsed.event.startsWith('transfer.') ? 'payout' : 'payment',
    metadata: { reference: parsed.reference, event: parsed.event, provider: 'paystack', amountCents: parsed.amountCents },
  });

  let stored;
  try {
    stored = await storeEvent('paystack', parsed);
  } catch (err) {
    console.error('[paystack-webhook] could not store event:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Temporarily unable to accept event' }, { status: 500 });
  }

  if (!stored.stored && 'duplicate' in stored) {
    // Already stored. If its processing failed, the pipeline job retries it.
    return new NextResponse('OK', { status: 200 });
  }

  if (!stored.stored && 'missingPipeline' in stored) {
    try {
      await processPaystackEvent(parsed);
    } catch (err) {
      console.error('[paystack-webhook] legacy processing failed:', err instanceof Error ? err.message : 'unknown error');
      return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }
    return new NextResponse('OK', { status: 200 });
  }

  if (stored.stored) {
    await processStoredEvent(stored.id, parsed);
    // Send what this event queued now rather than at the next daily pass.
    // Failures stay in the outbox for the pipeline job.
    try {
      await dispatchOutbox(20);
    } catch (err) {
      console.error('[paystack-webhook] outbox dispatch deferred:', err instanceof Error ? err.message : 'unknown error');
    }
  }
  return new NextResponse('OK', { status: 200 });
}
