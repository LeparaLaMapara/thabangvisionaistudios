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
import { STUDIO } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';
import { email as emailProvider } from '@/lib/email';
import { newPaidJobEmail, newPaidJobNoticeBody } from '@/lib/bookings/creator-job-emails';

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

    const { data: groupBookings, error: groupErr } = await supabase
      .from('equipment_bookings')
      .select('id, total_price')
      .eq('checkout_group_id', checkoutGroupId)
      .eq('user_id', userId);

    // A read error is not "no bookings": throw so the provider retries.
    if (groupErr) {
      console.error('[payment-webhook] Could not load the checkout group; not confirmed:', checkoutGroupId, groupErr.message);
      throw new Error('cart checkout lookup failed');
    }
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
    const { data: groupPayments, error: paymentsErr } = await supabase
      .from('booking_payments')
      .select('amount')
      .in('booking_id', bookingIds);

    if (paymentsErr) {
      console.error('[payment-webhook] Could not load the payment records; not confirmed:', checkoutGroupId, paymentsErr.message);
      throw new Error('cart payment records lookup failed');
    }

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
      const { error: flagErr } = await supabase
        .from('equipment_bookings')
        .update({
          status: 'pending',
          notes: `AMOUNT MISMATCH: expected ${expectedTotal}, received ${amountGross}. Requires manual review.`,
          updated_at: new Date().toISOString(),
        })
        .eq('checkout_group_id', checkoutGroupId)
        // A booking already confirmed by another payment is never pushed back.
        .eq('status', 'pending');
      // The note is how a person finds the mismatch: retry until it is written.
      if (flagErr) {
        console.error('[payment-webhook] Could not flag the amount mismatch:', checkoutGroupId, flagErr.message);
        throw new Error('cart mismatch flag failed');
      }
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

    // A paid order must never stay pending because a write failed: throw so
    // the provider retries (the confirm is guarded, so a retry is safe).
    if (updateErr) {
      console.error('[payment-webhook] Failed to confirm cart bookings:', updateErr.message);
      throw new Error('cart checkout confirmation failed');
    }

    // Close the payment lines in one write. Retried on failure: the retry finds
    // the bookings already confirmed by this payment and finishes this step.
    const markGroupPaid = async (ids: string[]) => {
      const { error: payErr } = await supabase
        .from('booking_payments')
        .update({ status: 'succeeded', payfast_payment_id: providerPaymentId })
        .in('booking_id', ids)
        .eq('status', 'pending');
      if (payErr) {
        console.error('[payment-webhook] Bookings confirmed but payment records not updated:', checkoutGroupId, payErr.message);
        throw new Error('cart payment records update failed');
      }
    };

    if (!confirmed || confirmed.length === 0) {
      // A retry of a payment already applied: finish closing its payment lines.
      const { data: mine, error: mineErr } = await supabase
        .from('equipment_bookings')
        .select('id')
        .eq('checkout_group_id', checkoutGroupId)
        .eq('payfast_payment_id', providerPaymentId);
      if (mineErr) {
        console.error('[payment-webhook] Could not re-read the checkout group:', checkoutGroupId, mineErr.message);
        throw new Error('cart checkout re-read failed');
      }
      if (mine && mine.length > 0) {
        await markGroupPaid(mine.map((b: { id: string }) => b.id));
        console.log(`[payment-webhook] Cart checkout already confirmed by this payment: group=${checkoutGroupId}`);
      } else {
        console.error('[payment-webhook] Cart payment matched no pending bookings; needs manual review:', checkoutGroupId);
      }
    } else {
      console.log(`[payment-webhook] Cart checkout confirmed: group=${checkoutGroupId} count=${groupBookings.length}`);
      await sendGearNotice('confirmed', await loadNoticeBookings(groupBookings.map((b: { id: string }) => b.id)));
      await markGroupPaid(bookingIds);
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
      const { error: flagErr } = await supabase
        .from('equipment_bookings')
        .update({
          status: 'pending',
          notes: `AMOUNT MISMATCH: expected ${booking.total_price}, received ${amountGross}. Requires manual review.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId)
        .eq('status', 'pending');
      if (flagErr) {
        console.error('[payment-webhook] Could not flag the amount mismatch:', paymentId, flagErr.message);
        throw new Error('equipment mismatch flag failed');
      }
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
      throw new Error('equipment booking confirmation failed');
    }

    // Record the payment once. Retried on failure: the retry finds the booking
    // already confirmed by this payment and finishes this step.
    const recordPayment = async () => {
      const { data: existingPayment, error: existingErr } = await supabase
        .from('booking_payments')
        .select('id')
        .eq('booking_id', paymentId)
        .eq('payfast_payment_id', providerPaymentId)
        .maybeSingle();
      if (existingErr) {
        console.error('[payment-webhook] Could not check the payment record:', paymentId, existingErr.message);
        throw new Error('equipment payment record lookup failed');
      }
      if (existingPayment) {
        console.log(`[payment-webhook] Payment already recorded: booking=${paymentId} provider=${providerPaymentId}`);
        return;
      }
      const { error: insertErr } = await supabase.from('booking_payments').insert({
        booking_id: paymentId,
        payfast_payment_id: providerPaymentId,
        amount: amountGross,
        currency: 'ZAR',
        status: 'succeeded',
      });
      // 23505: a concurrent delivery recorded it first (unique index, 040).
      if (insertErr && (insertErr as { code?: string }).code !== '23505') {
        console.error('[payment-webhook] Booking confirmed but payment not recorded:', paymentId, insertErr.message);
        throw new Error('equipment payment record insert failed');
      }
    };

    if (!confirmedRow || confirmedRow.length === 0) {
      const { data: mine, error: mineErr } = await supabase
        .from('equipment_bookings')
        .select('id')
        .eq('id', paymentId)
        .eq('payfast_payment_id', providerPaymentId)
        .maybeSingle();
      if (mineErr) {
        console.error('[payment-webhook] Could not re-read the booking:', paymentId, mineErr.message);
        throw new Error('equipment booking re-read failed');
      }
      if (mine) {
        await recordPayment();
        console.log(`[payment-webhook] Booking already confirmed by this payment: ref=${paymentId}`);
      } else {
        console.error('[payment-webhook] Payment matched no pending booking; needs manual review:', paymentId);
      }
    } else {
      await sendGearNotice('confirmed', await loadNoticeBookings([paymentId]));
      await recordPayment();
      console.log(`[payment-webhook] Booking confirmed: ref=${paymentId}`);
    }
  } else if (paymentType === 'service_booking') {
    await confirmServiceBookingPayment(webhook);
  } else if (paymentType === 'subscription') {
    await confirmSubscriptionPayment(webhook);
  }
}

// ─── Service bookings ────────────────────────────────────────────────────────

export type ServiceBookingConfirmation = 'confirmed' | 'already_paid' | 'rejected' | 'not_awaiting_payment';

/**
 * Confirmation of a creative service booking (bookings table) from a verified
 * payment webhook. Like the gear and subscription branches, it confirms only
 * when the payment matches what the booking asked for, and only from the
 * awaiting-payment state:
 *
 *   - the booking is found by our reference, and the metadata booking id (when
 *     present) is that booking;
 *   - currency is ZAR and the amount, compared in integer cents, equals
 *     bookings.total (whole rands, the amount sent to createCheckout);
 *   - the update is a compare-and-set from status 'pending' + payment_status
 *     'unpaid'. Zero rows changes nothing: a duplicate webhook for a paid
 *     booking is a no-op, and a payment for a cancelled or refunded booking
 *     never revives it; it is logged for a person to refund or review.
 *
 * Phase 6 security MONEY-1 (no amount check: R1 confirmed an R5 000 booking)
 * and MONEY-2 (no state guard: a late charge revived a refunded booking).
 */
export async function confirmServiceBookingPayment(webhook: WebhookResult): Promise<ServiceBookingConfirmation> {
  const { paymentId, providerPaymentId, amountGross, raw } = webhook;
  const metadataBookingId = raw.custom_str2 ?? raw.customStr2 ?? '';
  const supabase = createAdminClient();

  const { data: booking, error: lookupErr } = await supabase
    .from('bookings')
    .select('id, reference, status, payment_status, total, creator_amount, creator_id, client_id, project_category, duration_hours, shoot_date, location, created_at')
    .eq('reference', paymentId)
    .maybeSingle();

  // Without the booking there is nothing to check the amount against: never
  // confirm blind. A read error is retried by the provider (throw).
  if (lookupErr) {
    console.error('[payment-webhook] Could not load the service booking; not confirmed:', paymentId, lookupErr.message);
    throw new Error('service booking lookup failed');
  }
  if (!booking) {
    console.error('[payment-webhook] Service payment for an unknown reference; nothing changed:', paymentId);
    return 'rejected';
  }

  const reject = (reason: string): ServiceBookingConfirmation => {
    console.error('[payment-webhook] Service booking NOT confirmed:', { reference: paymentId, reason });
    logEvent({
      eventType: 'service_payment_rejected',
      eventCategory: 'payment',
      userId: booking.client_id ?? null,
      metadata: { reference: paymentId, bookingId: booking.id, providerPaymentId, reason },
    });
    return 'rejected';
  };

  if (metadataBookingId && metadataBookingId !== booking.id) {
    return reject(`metadata booking ${metadataBookingId} is not ${booking.id}`);
  }
  const currency = (raw.currency ?? '').toUpperCase();
  if (currency !== STUDIO.currency.code) {
    return reject(`currency mismatch: received ${raw.currency ?? 'none'}`);
  }
  const expectedCents = Number.isFinite(Number(booking.total)) ? toCents(Number(booking.total)) : NaN;
  const receivedCents = Number.isFinite(amountGross) ? toCents(amountGross) : NaN;
  if (!Number.isSafeInteger(expectedCents) || expectedCents <= 0 || receivedCents !== expectedCents) {
    // Flag a booking still awaiting payment for review; never touch one that
    // has moved on.
    const { error: flagErr } = await supabase
      .from('bookings')
      .update({
        admin_notes: `AMOUNT MISMATCH: expected ${expectedCents} cents, received ${receivedCents} cents (${providerPaymentId}). Manual review required.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)
      .eq('status', 'pending')
      .eq('payment_status', 'unpaid');
    if (flagErr) {
      // Not confirmed either way; reject() below still records the rejection as an event.
      console.error('[payment-webhook] Could not flag the service amount mismatch:', paymentId, flagErr.message);
    }
    return reject(`amount mismatch: expected ${expectedCents} cents, received ${receivedCents} cents`);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({
      status: 'paid',
      payment_status: 'paid',
      paid_at: now,
      paystack_reference: providerPaymentId,
      updated_at: now,
    })
    .eq('id', booking.id)
    .eq('status', 'pending')
    .eq('payment_status', 'unpaid')
    .select('id');

  if (updateErr) {
    console.error('[payment-webhook] Failed to confirm service booking:', updateErr.message);
    throw new Error('service booking confirmation failed');
  }
  if (!updated || updated.length === 0) {
    if (booking.payment_status === 'paid') {
      console.log(`[payment-webhook] Service booking already paid, nothing changed: ref=${paymentId}`);
      return 'already_paid';
    }
    // Paid for a booking that is cancelled, refunded or otherwise no longer
    // awaiting payment: the money needs a person (refund), the booking stays.
    console.error('[payment-webhook] Service payment for a booking no longer awaiting payment; needs manual review:', {
      reference: paymentId,
      status: booking.status,
      paymentStatus: booking.payment_status,
      providerPaymentId,
    });
    logEvent({
      eventType: 'service_payment_not_awaiting',
      eventCategory: 'payment',
      userId: booking.client_id ?? null,
      metadata: { reference: paymentId, bookingId: booking.id, providerPaymentId, status: booking.status, paymentStatus: booking.payment_status },
    });
    return 'not_awaiting_payment';
  }

  console.log(`[payment-webhook] Service booking confirmed: ref=${paymentId} booking=${booking.id}`);

  // Tell the creator they have a new paid job: what THEY earn
  // (creator_amount), never the client total, and the answer-by deadline.
  if (booking.creator_id) {
    const job = { ...booking, paid_at: now };
    try {
      await supabase.from('notifications').insert({
        user_id: booking.creator_id,
        type: 'gig_request',
        title: 'New Paid Gig',
        body: newPaidJobNoticeBody(job),
        link: '/dashboard/gigs',
      });
    } catch { /* don't block webhook */ }
    // And by email, so a creator who is not on the site does not lose the
    // job when the answer window closes.
    try {
      const { data: creator } = await supabase.auth.admin.getUserById(String(booking.creator_id));
      const to = creator?.user?.email;
      if (to) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || STUDIO.meta.url;
        await emailProvider.sendEmail({ to, ...newPaidJobEmail(job, baseUrl) });
      }
    } catch (err) {
      console.error('[payment-webhook] New job email to the creator failed:', err instanceof Error ? err.message : err);
    }
  }

  // Notify the client that payment was confirmed
  if (booking.client_id) {
    try {
      await supabase.from('notifications').insert({
        user_id: booking.client_id,
        type: 'booking_confirmed',
        title: 'Payment Confirmed',
        body: `Your ${booking.project_category} booking (${booking.reference}) is confirmed. The creator will be notified.`,
        link: '/dashboard/bookings',
      });
    } catch { /* don't block webhook */ }
  }
  return 'confirmed';
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

  // A database error is not a rejection: throw so the provider retries,
  // or a paid subscription would stay pending.
  if (readErr) {
    console.error('[payment-webhook] Subscription lookup failed:', readErr.message);
    throw new Error('subscription lookup failed');
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
    throw new Error('subscription activation failed');
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
    const { error: cancelErr } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('provider_reference', paymentId)
      .eq('status', 'pending');
    if (cancelErr) {
      console.error('[payment-webhook] Could not close the failed subscription attempt:', paymentId, cancelErr.message);
    }
  }
}

