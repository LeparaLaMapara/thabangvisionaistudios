import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { payments, type WebhookResult } from '@/lib/payments';
import { logEvent } from '@/lib/data/events';

export const dynamic = 'force-dynamic';

// ─── Transfer (payout) handlers ──────────────────────────────────────────────

async function handleTransferSuccess(raw: Record<string, unknown>) {
  const reference = (raw.reference as string) || '';
  if (!reference) return;

  console.log(`[paystack-webhook] TRANSFER SUCCESS: ref=${reference}`);

  const supabase = createAdminClient();
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

// ─── Payment handlers ────────────────────────────────────────────────────────

async function handlePaymentComplete(webhook: WebhookResult) {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[paystack-webhook] COMPLETE: provider=${providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

  if (paymentType === 'equipment_booking') {
    // Reconcile payment amount before confirming
    const { data: booking } = await supabase
      .from('equipment_bookings')
      .select('total_price')
      .eq('id', paymentId)
      .single();

    if (booking && Math.abs(booking.total_price - amountGross) > 0.01) {
      console.error('[paystack-webhook] Amount mismatch:', {
        expected: booking.total_price,
        received: amountGross,
        bookingId: paymentId,
      });
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
      console.error('[paystack-webhook] Failed to confirm booking:', bookingErr.message);
    } else {
      await supabase.from('booking_payments').insert({
        booking_id: paymentId,
        payfast_payment_id: providerPaymentId,
        amount: amountGross,
        currency: 'ZAR',
        status: 'complete',
      });

      console.log(`[paystack-webhook] Booking confirmed: ref=${paymentId}`);
    }
  } else if (paymentType === 'service_booking') {
    // Service booking — confirm payment by reference
    const bookingId = raw.custom_str2 ?? raw.customStr2 ?? '';

    const { error: bookingErr } = await supabase
      .from('bookings')
      .update({
        status: 'paid',
        payment_status: 'paid',
        paystack_reference: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('reference', paymentId);

    if (bookingErr) {
      console.error('[paystack-webhook] Failed to confirm service booking:', bookingErr.message);
    } else {
      console.log(`[paystack-webhook] Service booking confirmed: ref=${paymentId} booking=${bookingId}`);
    }
  } else if (paymentType === 'subscription') {
    const userId = raw.custom_str2 ?? raw.customStr2 ?? '';

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
      console.error('[paystack-webhook] Failed to activate subscription:', subErr.message);
    } else {
      console.log(`[paystack-webhook] Subscription activated: ref=${paymentId}`);
    }
  }
}

async function handlePaymentFailed(webhook: WebhookResult) {
  const { paymentId, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[paystack-webhook] FAILED: provider=${webhook.providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

  if (paymentType === 'equipment_booking') {
    await supabase
      .from('equipment_bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  } else if (paymentType === 'service_booking') {
    await supabase
      .from('bookings')
      .update({ status: 'cancelled', payment_status: 'failed', updated_at: new Date().toISOString() })
      .eq('reference', paymentId);
  } else if (paymentType === 'subscription') {
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  }
}

// ─── POST handler (receives webhook from Paystack) ──────────────────────────

export async function POST(request: NextRequest) {
  if (!payments.isConfigured()) {
    return NextResponse.json(
      { error: 'Payment provider is not configured' },
      { status: 503 },
    );
  }

  const body = await request.text();

  const webhook = await payments.validateWebhook({
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
