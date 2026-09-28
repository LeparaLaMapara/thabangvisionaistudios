import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { paystack } from '@/lib/payments/paystack';
import { handlePaymentComplete, handlePaymentFailed } from '@/lib/payments/fulfil';
import { recordConfirmation } from '@/lib/payments/routing';
import { logEvent } from '@/lib/data/events';

export const dynamic = 'force-dynamic';

// ─── Transfer (payout) handlers ──────────────────────────────────────────────

async function handleTransferSuccess(raw: Record<string, unknown>) {
  const reference = (raw.reference as string) || '';
  if (!reference) return;

  console.log(`[paystack-webhook] TRANSFER SUCCESS: ref=${reference}`);

  const supabase = createAdminClient();

  // Idempotency: skip if already paid out
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, payout_status')
    .eq('payout_reference', reference)
    .single();

  if (existing?.payout_status === 'paid') {
    console.log(`[paystack-webhook] Transfer already processed: ref=${reference}`);
    return;
  }

  const now = new Date().toISOString();

  const { data: booking, error: updateError } = await supabase
    .from('bookings')
    .update({
      payout_status: 'paid',
      status: 'paid_out',
      paid_out_at: now,
      updated_at: now,
    })
    .eq('payout_reference', reference)
    .select('id, reference, creator_id, creator_amount, project_category')
    .single();

  if (updateError) {
    console.error('[paystack-webhook] Transfer success update failed:', updateError.message);
    return;
  }

  // Notify creator
  if (booking?.creator_id) {
    try {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'payout_complete',
        title: 'Payout Complete',
        body: `R${booking.creator_amount} has been transferred to your bank account for ${booking.project_category} (${booking.reference}).`,
        link: '/dashboard/gigs',
      });
    } catch { /* don't block */ }
  }
}

async function handleTransferFailed(raw: Record<string, unknown>) {
  const reference = (raw.reference as string) || '';
  if (!reference) return;

  console.error(`[paystack-webhook] TRANSFER FAILED: ref=${reference}`);

  const supabase = createAdminClient();

  // Idempotency: skip if already paid (success arrived first) or already marked failed
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, payout_status')
    .eq('payout_reference', reference)
    .single();

  if (existing?.payout_status === 'paid' || existing?.payout_status === 'failed') {
    console.log(`[paystack-webhook] Transfer already processed (${existing.payout_status}): ref=${reference}`);
    return;
  }

  const { error } = await supabase
    .from('bookings')
    .update({
      payout_status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('payout_reference', reference);

  if (error) {
    console.error('[paystack-webhook] Transfer failed update error:', error.message);
  }
}

// ─── POST handler (receives webhook from Paystack) ──────────────────────────

export async function POST(request: NextRequest) {
  if (!paystack.isConfigured()) {
    return NextResponse.json(
      { error: 'Payment provider is not configured' },
      { status: 503 },
    );
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

  // ── Handle transfer (payout) events before charge events ──
  const event = (webhook.raw.event as string) ?? '';
  if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
    logEvent({
      eventType: event === 'transfer.success' ? 'transfer_success' : 'transfer_failed',
      eventCategory: 'payout',
      metadata: { reference: webhook.raw.reference, event, provider: 'paystack' },
    });

    try {
      if (event === 'transfer.success') {
        await handleTransferSuccess(webhook.raw);
      } else {
        await handleTransferFailed(webhook.raw);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[paystack-webhook] Transfer event error: ${message}`);
    }

    return new NextResponse('OK', { status: 200 });
  }

  // ── Handle charge (payment) events ──
  logEvent({
    eventType: `payment_${webhook.status.toLowerCase()}`,
    eventCategory: 'payment',
    metadata: { paymentId: webhook.paymentId, status: webhook.status, provider: 'paystack', amount: webhook.amountGross },
  });

  await recordConfirmation({
    provider: 'paystack',
    reference: webhook.providerPaymentId,
    paymentId: webhook.paymentId,
    amount: webhook.amountGross,
    status: webhook.status,
    eventType: event,
  });

  try {
    switch (webhook.status) {
      case 'COMPLETE':
        await handlePaymentComplete(webhook);
        break;
      case 'FAILED':
        await handlePaymentFailed(webhook);
        break;
      case 'PENDING':
        console.log(`[paystack-webhook] PENDING: ref=${webhook.paymentId}`);
        break;
      default:
        console.log(`[paystack-webhook] Unknown status: ${webhook.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[paystack-webhook] Error processing ${webhook.status}: ${message}`);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  // Paystack expects 200 OK
  return new NextResponse('OK', { status: 200 });
}
