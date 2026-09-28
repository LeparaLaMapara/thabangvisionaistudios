export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { yoco } from '@/lib/payments/yoco';
import { handlePaymentComplete, handlePaymentFailed } from '@/lib/payments/fulfil';
import { recordConfirmation } from '@/lib/payments/routing';
import { logEvent } from '@/lib/data/events';

/**
 * Yoco payment events. Register this address with Yoco once
 * (POST https://payments.yoco.com/api/webhooks) and put the returned secret in
 * YOCO_WEBHOOK_SECRET. Every event is signature-checked before anything moves.
 */
export async function POST(request: NextRequest) {
  if (!process.env.YOCO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Yoco is not configured' }, { status: 503 });
  }

  const body = await request.text();
  const webhook = await yoco.validateWebhook({
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
    body,
    headers: Object.fromEntries(request.headers.entries()),
  });
  if (!webhook.valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const eventType = webhook.raw.event ?? '';
  // Refund events and anything else carry no order to fulfil.
  if (!eventType.startsWith('payment.')) {
    logEvent({ eventType: 'yoco_event', eventCategory: 'payment', metadata: { event: eventType, reference: webhook.providerPaymentId } });
    return new NextResponse('OK', { status: 200 });
  }

  logEvent({
    eventType: `payment_${webhook.status.toLowerCase()}`,
    eventCategory: 'payment',
    metadata: { paymentId: webhook.paymentId, status: webhook.status, provider: 'yoco', amount: webhook.amountGross },
  });

  await recordConfirmation({
    provider: 'yoco',
    reference: webhook.providerPaymentId,
    paymentId: webhook.paymentId,
    amount: webhook.amountGross,
    status: webhook.status,
    eventType,
  });

  try {
    if (webhook.status === 'COMPLETE') await handlePaymentComplete(webhook);
    else if (webhook.status === 'FAILED') await handlePaymentFailed(webhook);
  } catch (err) {
    console.error('[yoco-webhook] handler error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return new NextResponse('OK', { status: 200 });
}
