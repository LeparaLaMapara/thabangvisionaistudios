export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { refundWithOutcome } from '@/lib/payments/routing';
import { payoutDueAt, refundAlreadyStarted } from '@/lib/core/services/fulfilment';
import { mentionsFulfilmentSchema, recordServiceBookingEvent, withoutFulfilmentColumns } from '@/lib/supabase/queries/service-bookings';

// ─── PATCH — Admin update booking (assign creator, cancel, add notes) ───────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  const supabase = createAdminClient();
  const body = await request.json();
  const { creator_id, status, admin_notes, cancellation_reason } = body;

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, reference, client_id, client_email, creator_id, project_category, status, total, payment_status, paystack_reference, cancellation_refund_status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  /** What happened to the refund on an admin cancel, for the response. */
  let refundResult: 'refunded' | 'failed' | 'unknown' | 'manual_review' | 'already_started' | null = null;

  // Assign creator
  if (creator_id) {
    update.creator_id = creator_id;

    try {
      await supabase.from('notifications').insert({
        user_id: creator_id,
        type: 'booking_assigned',
        title: 'New Gig Assigned',
        body: `You've been assigned a ${booking.project_category} booking (${booking.reference}). Check your gigs dashboard.`,
        link: '/dashboard/gigs',
      });
    } catch { /* don't block */ }
  }

  // Admin status override
  if (status) {
    update.status = status;

    if (status === 'cancelled') {
      update.cancelled_at = new Date().toISOString();
      update.cancellation_reason = cancellation_reason || 'Cancelled by admin';

      // Refund the full total if paid, unless a refund is already recorded as
      // made or possibly made (a client cancellation, a creator decline, or an
      // earlier admin cancel). Refunding again could pay the client twice.
      if (booking.payment_status === 'paid' && booking.paystack_reference) {
        if (refundAlreadyStarted(booking.cancellation_refund_status)) {
          refundResult = 'already_started';
        } else {
          const amount = Math.round(Number(booking.total ?? 0));
          const result = await refundWithOutcome({
            reference: booking.paystack_reference,
            amountRands: amount,
            idempotencyKey: `service-admin-cancel:${id}`,
          });
          refundResult = result.outcome === 'refunded' ? 'refunded'
            : result.outcome === 'unknown' ? 'unknown'
              : result.outcome === 'manual' ? 'manual_review'
                : 'failed';
          update.cancellation_refund_status = refundResult;
          update.cancellation_refund_amount = amount;
          update.cancellation_refund_percent = 100;
          if (result.outcome === 'refunded') {
            update.payment_status = 'refunded';
            update.cancellation_refunded_at = new Date().toISOString();
            update.cancellation_refund_error = null;
          } else {
            update.cancellation_refund_error = result.outcome === 'unknown'
              ? `OUTCOME UNKNOWN, check the payment provider before refunding by hand: ${result.message}`
              : result.message;
            console.error('[admin/service-bookings] refund not completed:', refundResult);
          }
        }
      }

      // Notify client
      try {
        await supabase.from('notifications').insert({
          user_id: booking.client_id,
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          body: `Your ${booking.project_category} booking (${booking.reference}) has been cancelled. ${booking.payment_status === 'paid' ? 'A refund is being processed.' : ''}`,
          link: '/dashboard/bookings',
        });

        await emailProvider.sendEmail({
          to: booking.client_email,
          subject: `Booking Cancelled — ${STUDIO.name}`,
          text: `Hi,\n\nYour ${booking.project_category} booking (${booking.reference}) has been cancelled.\n\n${booking.payment_status === 'paid' ? 'A refund of R' + booking.total + ' is being processed to your original payment method.' : ''}\n\nReason: ${cancellation_reason || 'Not specified'}\n\nIf you have questions, contact us at ${STUDIO.email}.\n\nThank you,\n${STUDIO.name}`,
        });
      } catch { /* don't block */ }
    }

    if (status === 'completed') {
      // An admin completing a booking (e.g. resolving a dispute for the
      // creator) starts the same payout clock as a client approval. The
      // payout is sent by the daily job once due; nothing is paid here.
      const at = new Date();
      const due = payoutDueAt(at).toISOString();
      update.completed_at = at.toISOString();
      update.payout_due_at = due;
      update.dispute_window_ends_at = due;
    }
  }

  if (admin_notes !== undefined) {
    update.admin_notes = admin_notes;
  }

  let { error: updateError } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', id);
  // Before migration 073 'unknown' is not an allowed refund status: 'pending'
  // (with the note in cancellation_refund_error) blocks a repeat refund too.
  if (updateError && update.cancellation_refund_status === 'unknown' && /cancellation_refund_status/.test(updateError.message)) {
    update.cancellation_refund_status = 'pending';
    ({ error: updateError } = await supabase
      .from('bookings')
      .update(update)
      .eq('id', id));
  }
  // Before migration 073 the payout timing columns do not exist yet.
  if (updateError && mentionsFulfilmentSchema(updateError.message)) {
    ({ error: updateError } = await supabase
      .from('bookings')
      .update(withoutFulfilmentColumns(update))
      .eq('id', id));
  }

  if (updateError) {
    console.error('[admin/service-bookings] Update error:', updateError.message);
    if (refundResult === 'refunded' || refundResult === 'unknown') {
      // Money moved (or may have) but could not be recorded: say so loudly so
      // nobody cancels again and refunds twice.
      try {
        await emailProvider.sendEmail({
          to: STUDIO.bookingEmail,
          subject: `[Action Required] Refund not recorded — ${booking.reference}`,
          text: `An admin cancelled booking ${booking.reference} and a refund of R${booking.total} was ${refundResult === 'refunded' ? 'sent' : 'attempted with no clear answer (it may have gone through)'}, but the booking could not be updated.\n\nCheck the payment provider for reference ${booking.paystack_reference} and record the refund on the booking by hand. Do NOT cancel it again from the admin panel until it is recorded.`,
        });
      } catch { /* logged above */ }
    }
    return NextResponse.json({ error: 'Failed to update booking', refund_status: refundResult }, { status: 500 });
  }

  if (refundResult === 'unknown' || refundResult === 'failed') {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Refund ${refundResult === 'unknown' ? 'outcome unknown' : 'failed'} — ${booking.reference}`,
        text: refundResult === 'unknown'
          ? `An admin cancelled booking ${booking.reference}. The refund of R${booking.total} got no clear answer from the payment provider, so it MAY already have gone through.\n\nCHECK the provider first (its refunds for payment reference ${booking.paystack_reference}, or the dashboard). Refund by hand ONLY if no refund is there, then record it. Cancelling again will not send another refund.`
          : `An admin cancelled booking ${booking.reference}. The payment provider refused the refund of R${booking.total}; nothing was refunded. Refund it by hand and record it.`,
      });
    } catch { /* don't block */ }
  }

  if (status && status !== booking.status) {
    await recordServiceBookingEvent(supabase, {
      bookingId: id, event: 'admin_status', from: booking.status, to: String(status), actor: 'admin', actorId: auth.user.id,
      reason: typeof cancellation_reason === 'string' ? cancellation_reason : null,
    });
  }

  return NextResponse.json({ success: true, ...(refundResult ? { refund_status: refundResult } : {}) });
}
