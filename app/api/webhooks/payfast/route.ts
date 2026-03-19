import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { payments, type WebhookResult } from '@/lib/payments';

export const dynamic = 'force-dynamic';

// ─── Payment handlers ────────────────────────────────────────────────────────

async function handlePaymentComplete(webhook: WebhookResult) {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const paymentType = raw.custom_str1 ?? '';

  // L3: Log only non-PII identifiers
  console.log(`[webhook] COMPLETE: provider=${providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

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
  } else if (paymentType === 'crew_request' || paymentType === 'crew_request_deposit') {
    const commissionRate = 15; // STUDIO.creators.commissionRate
    const commissionAmount = amountGross * (commissionRate / 100);

    // For deposits, just mark as paid but don't overwrite total_amount (it's already set at booking time)
    const updatePayload: Record<string, unknown> = {
      status: 'paid',
      payment_id: providerPaymentId,
      updated_at: new Date().toISOString(),
    };

    // Only set amounts if this is a full payment, not just deposit
    if (paymentType === 'crew_request') {
      updatePayload.total_amount = amountGross;
      updatePayload.commission_amount = commissionAmount;
    }

    const { error: crewErr } = await supabase
      .from('crew_requests')
      .update(updatePayload)
      .eq('id', paymentId);

    if (crewErr) {
      console.error('[webhook] Failed to update crew request payment:', crewErr.message);
    } else {
      console.log(`[webhook] Crew request ${paymentType === 'crew_request_deposit' ? 'deposit' : 'full'} paid: ref=${paymentId}`);
    }
  } else if (paymentType === 'service_booking') {
    // New service booking payment
    const bookingId = raw.custom_str2 ?? '';

    // Reconcile amount
    const { data: booking } = await supabase
      .from('bookings')
      .select('total, client_id, creator_id, project_category, reference')
      .eq('reference', paymentId)
      .single();

    if (booking && Math.abs(booking.total - amountGross) > 0.01) {
      console.error('[webhook] Service booking amount mismatch:', {
        expected: booking.total,
        received: amountGross,
        reference: paymentId,
      });
      // Flag for manual review
      await supabase
        .from('bookings')
        .update({
          admin_notes: `AMOUNT MISMATCH: expected ${booking.total}, received ${amountGross}. Manual review required.`,
          updated_at: new Date().toISOString(),
        })
        .eq('reference', paymentId);
      return;
    }

    const { error: bookingErr } = await supabase
      .from('bookings')
      .update({
        payment_status: 'paid',
        status: 'paid',
        paid_at: new Date().toISOString(),
        paystack_reference: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('reference', paymentId);

    if (bookingErr) {
      console.error('[webhook] Failed to confirm service booking:', bookingErr.message);
    } else {
      console.log(`[webhook] Service booking paid: ref=${paymentId} booking=${bookingId}`);

      // Notify client
      if (booking) {
        await supabase.from('notifications').insert({
          user_id: booking.client_id,
          type: 'payment_confirmed',
          title: 'Payment Confirmed',
          body: `Your payment for ${booking.project_category} (${booking.reference}) has been confirmed.`,
          link: '/dashboard/bookings',
        });

        // Notify creator if assigned
        if (booking.creator_id) {
          await supabase.from('notifications').insert({
            user_id: booking.creator_id,
            type: 'gig_paid',
            title: 'New Paid Gig',
            body: `A ${booking.project_category} gig (${booking.reference}) has been paid. Check your dashboard to accept.`,
            link: '/dashboard/gigs',
          });
        }
      }
    }
  }
}

// ─── Transfer event handlers (Paystack Transfers API) ────────────────────────

async function handleTransferSuccess(raw: Record<string, string>) {
  const reference = raw.reference ?? '';
  if (!reference) return;

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('bookings')
    .update({
      payout_status: 'paid',
      status: 'paid_out',
      paid_out_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('payout_reference', reference);

  if (error) {
    console.error('[webhook] Failed to update transfer success:', error.message);
  } else {
    console.log(`[webhook] Transfer success: ref=${reference}`);

    // Notify creator
    const { data: booking } = await supabase
      .from('bookings')
      .select('creator_id, creator_amount, project_category, reference')
      .eq('payout_reference', reference)
      .single();

    if (booking?.creator_id) {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'payout_complete',
        title: 'Payout Complete',
        body: `R${booking.creator_amount} has been transferred to your bank account for ${booking.project_category} (${booking.reference}).`,
        link: '/dashboard/gigs',
      });
    }
  }
}

async function handleTransferFailed(raw: Record<string, string>) {
  const reference = raw.reference ?? '';
  if (!reference) return;

  const supabase = createAdminClient();

  await supabase
    .from('bookings')
    .update({
      payout_status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('payout_reference', reference);

  console.error(`[webhook] Transfer failed: ref=${reference}`);
}

async function handlePaymentFailed(webhook: WebhookResult) {
  const { paymentId, raw } = webhook;
  const paymentType = raw.custom_str1 ?? '';

  console.log(`[webhook] FAILED: provider=${webhook.providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

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
  } else if (paymentType === 'crew_request' || paymentType === 'crew_request_deposit') {
    // Payment failed — keep status as confirmed so client can retry
    console.log(`[webhook] Crew request ${paymentType === 'crew_request_deposit' ? 'deposit' : ''} payment failed: ref=${paymentId}`);
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

  // Handle transfer events (Paystack sends these for payouts)
  const event = webhook.raw.event ?? '';
  if (event === 'transfer.success' || event === 'transfer.failed') {
    try {
      if (event === 'transfer.success') {
        await handleTransferSuccess(webhook.raw);
      } else {
        await handleTransferFailed(webhook.raw);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[webhook] Transfer event error: ${message}`);
    }
    return new NextResponse('OK', { status: 200 });
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
