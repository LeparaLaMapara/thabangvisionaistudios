export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logEvent } from '@/lib/data/events';
import { dispatchOutbox } from '@/lib/rental/notify';
import { DELIVERY_OPS } from '@/lib/constants';
import { handleDeliveryWebhook, headerRecord, readBodyWithin } from '@/lib/delivery/webhooks';
import '@/lib/delivery/webhook-adapters';

/**
 * Delivery-provider webhooks (spec Phase 4 §4.15–4.16, D11–D13).
 *
 * Generic for every courier: the provider's parser (signature scheme and
 * payload shape) comes from the registry in lib/delivery/webhooks.ts.
 *
 * 1. Unknown provider → 404. Body over the limit → 413, decided from the
 *    Content-Length before reading and enforced while streaming (never more
 *    than the limit is read into memory).
 * 2. Signature over the RAW body, constant time. Fails → 401; nothing is
 *    stored or applied (D11).
 * 3. Store a minimal copy in the durable inbox (unique dedupe key, so a
 *    replay is stored and applied once, D12). Cannot store → 500 so the
 *    provider retries.
 * 4. Process it once; the result never changes the 200. Failures are retried
 *    by the daily pipeline (drainDeliveryInbox) and dead-lettered for a
 *    person. Provider states only ever move a leg forward (D13).
 *
 * Server-to-server: the proxy exempts /api/webhooks/ from its Origin check,
 * and there is no session. Logs carry ids and outcomes only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await readBodyWithin(request, DELIVERY_OPS.webhookMaxBodyBytes);
  if (rawBody === null) {
    logEvent({ eventType: 'delivery_webhook', eventCategory: 'delivery', metadata: { provider, status: 413, outcome: 'too_large' } });
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const result = await handleDeliveryWebhook({ providerId: provider, rawBody, headers: headerRecord(request.headers) });

  if (result.status !== 404) {
    logEvent({ eventType: 'delivery_webhook', eventCategory: 'delivery', metadata: { provider, status: result.status, outcome: result.outcome } });
  }

  if (result.status === 200 && result.outcome === 'applied') {
    // Send what this event queued now rather than at the next daily pass.
    try {
      await dispatchOutbox(20);
    } catch (err) {
      console.error('[delivery-webhook] outbox dispatch deferred:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  if (result.status === 200) return new NextResponse('OK', { status: 200 });
  const message: Record<number, string> = {
    400: 'Invalid payload',
    401: 'Invalid signature',
    404: 'Unknown delivery provider',
    413: 'Payload too large',
    500: 'Temporarily unable to accept event',
    503: 'Delivery provider is not configured',
  };
  return NextResponse.json({ error: message[result.status] ?? 'Error' }, { status: result.status });
}
