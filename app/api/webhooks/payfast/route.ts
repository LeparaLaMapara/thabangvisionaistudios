import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { payments, type WebhookResult } from '@/lib/payments';

export const dynamic = 'force-dynamic';

// ─── Payment handlers ────────────────────────────────────────────────────────

async function handlePaymentComplete(webhook: WebhookResult) {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const paymentType = raw.custom_str1 ?? '';

  // L3: Log only non-PII identifiers
  console.log(`[webhook] COMPLETE: provider=${providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = await createClient();

  if (paymentType === 'equipment_booking') {
    // M7: Reconcile payment amount before confirming
    const { data: booking } = await supabase
      .from('equipment_bookings')
      .select('total_price')
      .eq('id', paymentId)
      .single();

    if (booking && Math.abs(booking.total_price - amountGross) > 0.01) {
      console.error('[webhook] Amount mismatch:', {
        expected: booking.total_price,
        received: amountGross,
        bookingId: paymentId,
      });
      // Flag for manual review — do not auto-confirm
      await supabase
        .from('equipment_bookings')
        .update({
          status: 'pending',
          notes: `AMOUNT MISMATCH: expected ${booking.total_price}, received ${amountGross}. Requires manual review.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
      return;
    }

    // Update booking status to confirmed
    const { error: bookingErr } = await supabase
      .from('equipment_bookings')
      .update({
        status: 'confirmed',
        payfast_payment_id: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (bookingErr) {
      console.error('[webhook] Failed to confirm booking:', bookingErr.message);
    } else {
      await supabase.from('booking_payments').insert({
        booking_id: paymentId,
        payfast_payment_id: providerPaymentId,
        amount: amountGross,
        currency: 'ZAR',
        status: 'complete',
      });

      console.log(`[webhook] Booking confirmed: ref=${paymentId}`);
    }
  } else if (paymentType === 'subscription') {
    const userId = raw.custom_str2 ?? '';

    const { error: subErr } = await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        payfast_token: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('user_id', userId);

    if (subErr) {
      console.error('[webhook] Failed to activate subscription:', subErr.message);
    } else {
      console.log(`[webhook] Subscription activated: ref=${paymentId}`);
    }
  }
}

async function handlePaymentFailed(webhook: WebhookResult) {
  const { paymentId, raw } = webhook;
  const paymentType = raw.custom_str1 ?? '';

  console.log(`[webhook] FAILED: provider=${webhook.providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = await createClient();

  if (paymentType === 'equipment_booking') {
    await supabase
      .from('equipment_bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  } else if (paymentType === 'subscription') {
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  }
}

async function handlePaymentPending(webhook: WebhookResult) {
  console.log(`[webhook] PENDING: provider=${webhook.providerPaymentId} ref=${webhook.paymentId} type=${webhook.raw.custom_str1}`);
}

// ─── POST handler (receives webhook from payment provider) ───────────────────

export async function POST(request: NextRequest) {
  if (!payments.isConfigured()) {
    return NextResponse.json(
      { error: 'Payment provider is not configured' },
      { status: 503 },
    );
  }

  // Validate webhook (IP, signature, server-to-server) via provider abstraction
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? '';
  const body = await request.text();

  const webhook = await payments.validateWebhook({
    ip,
    body,
    headers: Object.fromEntries(request.headers.entries()),
  });

  if (!webhook.valid) {
    return NextResponse.json({ error: 'Webhook validation failed' }, { status: 400 });
  }

  // Process payment based on status
  try {
    switch (webhook.status) {
      case 'COMPLETE':
        await handlePaymentComplete(webhook);
        break;
      case 'FAILED':
        await handlePaymentFailed(webhook);
        break;
      case 'PENDING':
        await handlePaymentPending(webhook);
        break;
      default:
        console.log(`[webhook] Unknown payment status: ${webhook.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[webhook] Error processing ${webhook.status}: ${message}`);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 },
    );
  }

  // Payment provider expects a 200 OK response
  return new NextResponse('OK', { status: 200 });
}
