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

// ─── Payment handlers ────────────────────────────────────────────────────────

async function handlePaymentComplete(webhook: WebhookResult) {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[paystack-webhook] COMPLETE: provider=${providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

  if (paymentType === 'cart_checkout') {
    // Cart checkout — confirm all bookings in the checkout group
    const checkoutGroupId = paymentId;
    const userId = raw.custom_str2 ?? raw.customStr2 ?? '';

    const { data: groupBookings } = await supabase
      .from('equipment_bookings')
      .select('id, total_price')
      .eq('checkout_group_id', checkoutGroupId)
      .eq('user_id', userId);

    if (!groupBookings || groupBookings.length === 0) {
      console.error('[paystack-webhook] No bookings found for checkout group:', checkoutGroupId);
      return;
    }

    const expectedTotal = groupBookings.reduce((sum, b) => sum + (b.total_price ?? 0), 0);
    if (Math.abs(expectedTotal - amountGross) > 0.01) {
      console.error('[paystack-webhook] Cart checkout amount mismatch:', {
        expected: expectedTotal,
        received: amountGross,
        checkoutGroupId,
      });
      await supabase
        .from('equipment_bookings')
        .update({
          status: 'pending',
          notes: `AMOUNT MISMATCH: expected ${expectedTotal}, received ${amountGross}. Requires manual review.`,
          updated_at: new Date().toISOString(),
        })
        .eq('checkout_group_id', checkoutGroupId);
      return;
    }

    const { error: updateErr } = await supabase
      .from('equipment_bookings')
      .update({
        status: 'confirmed',
        payfast_payment_id: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('checkout_group_id', checkoutGroupId);

    if (updateErr) {
      console.error('[paystack-webhook] Failed to confirm cart bookings:', updateErr.message);
    } else {
      for (const booking of groupBookings) {
        await supabase
          .from('booking_payments')
          .update({ status: 'complete', payfast_payment_id: providerPaymentId })
          .eq('booking_id', booking.id)
          .eq('status', 'pending');
      }
      console.log(`[paystack-webhook] Cart checkout confirmed: group=${checkoutGroupId} count=${groupBookings.length}`);
    }
  } else if (paymentType === 'equipment_booking') {
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

    const { data: updatedBooking, error: bookingErr } = await supabase
      .from('bookings')
      .update({
        status: 'paid',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        paystack_reference: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('reference', paymentId)
      .select('id, reference, creator_id, client_id, project_category, total, duration_hours')
      .single();

    if (bookingErr) {
      console.error('[paystack-webhook] Failed to confirm service booking:', bookingErr.message);
    } else {
      console.log(`[paystack-webhook] Service booking confirmed: ref=${paymentId} booking=${bookingId}`);

      // Notify the creator they have a new paid gig
      if (updatedBooking?.creator_id) {
        try {
          await supabase.from('notifications').insert({
            user_id: updatedBooking.creator_id,
            type: 'gig_request',
            title: 'New Paid Gig',
            body: `You have a new ${updatedBooking.project_category} booking (${updatedBooking.reference}). R${updatedBooking.total} — ${updatedBooking.duration_hours}hrs. Accept it in your gigs dashboard.`,
            link: '/dashboard/gigs',
          });
        } catch { /* don't block webhook */ }
      }

      // Notify the client that payment was confirmed
      if (updatedBooking?.client_id) {
        try {
          await supabase.from('notifications').insert({
            user_id: updatedBooking.client_id,
            type: 'booking_confirmed',
            title: 'Payment Confirmed',
            body: `Your ${updatedBooking.project_category} booking (${updatedBooking.reference}) is confirmed. The creator will be notified.`,
            link: '/dashboard/bookings',
          });
        } catch { /* don't block webhook */ }
      }
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

  if (paymentType === 'cart_checkout') {
    await supabase
      .from('equipment_bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('checkout_group_id', paymentId);
  } else if (paymentType === 'equipment_booking') {
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
