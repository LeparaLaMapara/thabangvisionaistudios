import { createAdminClient } from '@/lib/supabase/server';
import type { WebhookResult } from '@/lib/payments';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import {
  decideSubscriptionConfirmation,
  periodEnd,
  type BillingInterval,
  type PendingSubscriptionRow,
} from '@/lib/payments/subscriptions';
import { recordServiceBookingEvent } from '@/lib/supabase/queries/service-bookings';
import { logEvent } from '@/lib/data/events';

/**
 * What happens once a payment provider tells us, with a verified signature,
 * that a payment completed or failed. Shared by every provider's webhook
 * (app/api/webhooks/paystack, app/api/webhooks/yoco): the provider only has
 * to turn its payload into a WebhookResult carrying our own metadata keys
 * (custom_str1 = what was paid for, and so on).
 */

// ─── Payment handlers ────────────────────────────────────────────────────────

export async function handlePaymentComplete(webhook: WebhookResult) {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[payment-webhook] COMPLETE: provider=${providerPaymentId} ref=${paymentId} type=${paymentType}`);

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
      console.error('[payment-webhook] No bookings found for checkout group:', checkoutGroupId);
      return;
    }

    // Reconcile against what we asked the gateway to charge, recorded in
    // booking_payments at checkout. Re-deriving it from total_price was wrong:
    // that column holds the undiscounted hire and excludes deposits, the bulk
    // discount and any delivery fee, so a correct payment looked like a
    // mismatch and the booking was pushed back to pending.
    const bookingIds = groupBookings.map((b) => b.id);
    const { data: groupPayments } = await supabase
      .from('booking_payments')
      .select('amount')
      .in('booking_id', bookingIds);

    const expectedTotal = (groupPayments ?? []).reduce(
      (sum, p) => sum + Number(p.amount ?? 0),
      0,
    );

    if (!groupPayments?.length) {
      console.error('[payment-webhook] No payment records for checkout group:', checkoutGroupId);
      return;
    }
    if (Math.abs(expectedTotal - amountGross) > 0.01) {
      console.error('[payment-webhook] Cart checkout amount mismatch:', {
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
        .eq('checkout_group_id', checkoutGroupId)
        // A booking already confirmed by another payment is never pushed back.
        .eq('status', 'pending');
      return;
    }

    // Guarded: only lines still pending are confirmed. A line already
    // released (hold expired, cancelled) is never revived here, and a
    // duplicate webhook confirms nothing twice. Late payments for released
    // stock are handled by the Phase 1 pipeline (rental_payment_intents).
    const { data: confirmed, error: updateErr } = await supabase
      .from('equipment_bookings')
      .update({
        status: 'confirmed',
        payfast_payment_id: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('checkout_group_id', checkoutGroupId)
      .eq('status', 'pending')
      .select('id');

    if (updateErr) {
      console.error('[payment-webhook] Failed to confirm cart bookings:', updateErr.message);
    } else if (!confirmed || confirmed.length === 0) {
      console.error('[payment-webhook] Cart payment matched no pending bookings; needs manual review:', checkoutGroupId);
    } else {
      for (const booking of groupBookings) {
        await supabase
          .from('booking_payments')
          .update({ status: 'succeeded', payfast_payment_id: providerPaymentId })
          .eq('booking_id', booking.id)
          .eq('status', 'pending');
      }
      console.log(`[payment-webhook] Cart checkout confirmed: group=${checkoutGroupId} count=${groupBookings.length}`);
      await sendGearNotice('confirmed', await loadNoticeBookings(groupBookings.map((b: { id: string }) => b.id)));
    }
  } else if (paymentType === 'equipment_booking') {
    // Reconcile payment amount before confirming
    const { data: booking, error: lookupErr } = await supabase
      .from('equipment_bookings')
      .select('total_price')
      .eq('id', paymentId)
      .single();

    // Without the booking there is nothing to check the amount against: never confirm blind.
    if (lookupErr || !booking) {
      console.error('[payment-webhook] Could not load the booking to check the amount; not confirmed:', paymentId);
      throw new Error('equipment booking lookup failed');
    }
    if (Math.abs(booking.total_price - amountGross) > 0.01) {
      console.error('[payment-webhook] Amount mismatch:', {
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
        .eq('id', paymentId)
        .eq('status', 'pending');
      return;
    }

    // Update booking status to confirmed
    const { data: confirmedRow, error: bookingErr } = await supabase
      .from('equipment_bookings')
      .update({
        status: 'confirmed',
        payfast_payment_id: providerPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('status', 'pending')
      .select('id');

    if (bookingErr) {
      console.error('[payment-webhook] Failed to confirm booking:', bookingErr.message);
    } else if (!confirmedRow || confirmedRow.length === 0) {
      console.error('[payment-webhook] Payment matched no pending booking; needs manual review:', paymentId);
    } else {
      await sendGearNotice('confirmed', await loadNoticeBookings([paymentId]));
      const { data: existingPayment } = await supabase
        .from('booking_payments')
        .select('id')
        .eq('booking_id', paymentId)
        .eq('payfast_payment_id', providerPaymentId)
        .maybeSingle();

      if (existingPayment) {
        console.log(`[payment-webhook] Payment already recorded: booking=${paymentId} provider=${providerPaymentId}`);
      } else {
        await supabase.from('booking_payments').insert({
          booking_id: paymentId,
          payfast_payment_id: providerPaymentId,
          amount: amountGross,
          currency: 'ZAR',
          status: 'succeeded',
        });
      }

      console.log(`[payment-webhook] Booking confirmed: ref=${paymentId}`);
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
      console.error('[payment-webhook] Failed to confirm service booking:', bookingErr.message);
    } else {
      console.log(`[payment-webhook] Service booking confirmed: ref=${paymentId} booking=${bookingId}`);

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
    await confirmSubscriptionPayment(webhook);
  }
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

/**
 * Confirmation + fulfilment for a subscription payment. The pending row is
 * found by the provider reference written at initiation, and activated only
 * when the webhook's amount (in cents), currency, reference, plan and user all
 * match what was recorded there. Activation is a guarded pending → active
 * update, so a duplicate webhook is a no-op. A mismatch is logged and leaves
 * the row pending for review. Active rows are never re-priced.
 *
 * Exported so every provider's webhook route can share it.
 */
export async function confirmSubscriptionPayment(
  webhook: WebhookResult,
): Promise<'activated' | 'already_active' | 'rejected'> {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const supabase = createAdminClient();

  const { data: sub, error: readErr } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_id, status, expected_amount_cents, currency, provider_reference, billing_interval')
    .eq('provider_reference', paymentId)
    .maybeSingle();

  if (readErr) {
    console.error('[payment-webhook] Subscription lookup failed:', readErr.message);
    return 'rejected';
  }

  const decision = decideSubscriptionConfirmation(
    (sub as PendingSubscriptionRow | null) ?? null,
    {
      reference: paymentId,
      amountGross,
      currency: raw.currency,
      planId: raw.custom_str3 ?? raw.customStr3,
      userId: raw.custom_str2 ?? raw.customStr2,
    },
  );

  if (decision.action === 'already_active') {
    console.log(`[payment-webhook] Subscription already active, ignoring duplicate: ref=${paymentId}`);
    return 'already_active';
  }
  if (decision.action === 'reject' || !sub) {
    console.error('[payment-webhook] Subscription NOT activated:', {
      reference: paymentId,
      reason: decision.action === 'reject' ? decision.reason : 'no row',
    });
    return 'rejected';
  }

  const now = new Date();
  const interval: BillingInterval = sub.billing_interval === 'annual' ? 'annual' : 'monthly';
  const { data: activated, error: subErr } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      payfast_token: providerPaymentId,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd(now, interval).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', sub.id)
    .eq('status', 'pending')
    .select('id');

  if (subErr) {
    console.error('[payment-webhook] Failed to activate subscription:', subErr.message);
    return 'rejected';
  }
  if (!activated || activated.length === 0) {
    console.log(`[payment-webhook] Subscription no longer pending, nothing changed: ref=${paymentId}`);
    return 'already_active';
  }
  console.log(`[payment-webhook] Subscription activated: ref=${paymentId}`);
  return 'activated';
}

export async function handlePaymentFailed(webhook: WebhookResult) {
  const { paymentId, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[payment-webhook] FAILED: provider=${webhook.providerPaymentId} ref=${paymentId} type=${paymentType}`);

  const supabase = createAdminClient();

  // A failed attempt never cancels a booking that was paid (T12), and it does
  // not release a pending hold early either: the customer may retry with
  // another card before the hold runs out. Expiry releases the stock.
  if (paymentType === 'cart_checkout' || paymentType === 'equipment_booking') {
    return;
  } else if (paymentType === 'service_booking') {
    // Same rule for service bookings. This used to write payment_status
    // 'failed', which bookings_payment_status_check does not allow (only
    // unpaid / paid / refunded), so the write was refused and the attempt was
    // lost; had it succeeded it would have cancelled a booking that may yet be
    // paid, or already was. Now the booking is left as it is (an unpaid one
    // is closed by the daily job after 72 hours) and the failed attempt is
    // recorded in the booking's history.
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, status, payment_status')
      .eq('reference', paymentId)
      .maybeSingle();
    if (booking) {
      await recordServiceBookingEvent(supabase, {
        bookingId: booking.id,
        event: 'payment_failed',
        from: booking.status,
        to: booking.status,
        actor: 'system',
        actorId: null,
        reason: `provider ${webhook.providerPaymentId || 'unknown'}${booking.payment_status === 'paid' ? ' (booking already paid; ignored)' : ''}`,
      });
    }
    logEvent({
      eventType: 'service_payment_failed',
      eventCategory: 'payment',
      metadata: { reference: paymentId, provider_payment_id: webhook.providerPaymentId, booking_found: Boolean(booking) },
    });
  } else if (paymentType === 'subscription') {
    // Only a still-pending attempt is cancelled; a failed charge event can
    // never cancel an active subscription.
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('provider_reference', paymentId)
      .eq('status', 'pending');
  }
}

