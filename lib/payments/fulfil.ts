import { createAdminClient } from '@/lib/supabase/server';
import type { WebhookResult } from '@/lib/payments';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';

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
      console.error('[payment-webhook] Failed to confirm cart bookings:', updateErr.message);
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
    const { data: booking } = await supabase
      .from('equipment_bookings')
      .select('total_price')
      .eq('id', paymentId)
      .single();

    if (booking && Math.abs(booking.total_price - amountGross) > 0.01) {
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
      console.error('[payment-webhook] Failed to confirm booking:', bookingErr.message);
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
      console.error('[payment-webhook] Failed to activate subscription:', subErr.message);
    } else {
      console.log(`[payment-webhook] Subscription activated: ref=${paymentId}`);
    }
  }
}

export async function handlePaymentFailed(webhook: WebhookResult) {
  const { paymentId, raw } = webhook;
  const paymentType = raw.custom_str1 ?? raw.customStr1 ?? '';

  console.log(`[payment-webhook] FAILED: provider=${webhook.providerPaymentId} ref=${paymentId} type=${paymentType}`);

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

