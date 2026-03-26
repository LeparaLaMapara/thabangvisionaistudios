export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';
import { triggerCreatorPayout } from '@/lib/payments/payout';
import { logEvent } from '@/lib/data/events';

// Allowed status transitions per role
const CREATOR_TRANSITIONS: Record<string, string[]> = {
  paid: ['accepted'],
  accepted: ['delivered'],
};

const CLIENT_TRANSITIONS: Record<string, string[]> = {
  delivered: ['completed'],
  paid: ['cancelled'],
  accepted: ['cancelled'],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkRateLimit(`booking-status:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await request.json();
  const { status } = body;

  if (!status || typeof status !== 'string') {
    return NextResponse.json({ error: 'Status is required' }, { status: 400 });
  }

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, client_id, client_email, creator_id, project_category, status, total, creator_amount, reference, payment_status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const isCreator = booking.creator_id === user.id;
  const isClient = booking.client_id === user.id;

  if (!isCreator && !isClient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Block users who are both creator and client (should not happen, but prevents self-payout exploit)
  if (isCreator && isClient) {
    return NextResponse.json({ error: 'Cannot update status on self-assigned bookings' }, { status: 403 });
  }

  // Validate transitions based on role
  if (isCreator) {
    const allowed = CREATOR_TRANSITIONS[booking.status];
    if (!allowed || !allowed.includes(status)) {
      return NextResponse.json(
        { error: `Creators cannot transition from '${booking.status}' to '${status}'` },
        { status: 400 },
      );
    }
  }

  if (isClient) {
    const allowed = CLIENT_TRANSITIONS[booking.status];
    if (!allowed || !allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from '${booking.status}' to '${status}'` },
        { status: 400 },
      );
    }
  }

  // Build update
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'accepted') update.accepted_at = new Date().toISOString();
  if (status === 'delivered') update.delivered_at = new Date().toISOString();
  if (status === 'completed') update.completed_at = new Date().toISOString();
  if (status === 'cancelled') {
    update.cancelled_at = new Date().toISOString();
    update.cancellation_reason = body.reason || null;
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', id);

  if (updateError) {
    console.error('[service-bookings/status] Update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
  }

  logEvent({
    eventType: `booking_${status}`,
    eventCategory: 'booking',
    userId: user.id,
    metadata: { bookingId: id, reference: booking.reference, from: booking.status, to: status, role: isCreator ? 'creator' : 'client' },
  });

  // ─── Side effects ────────────────────────────────────────────────────────
  try {
    if (status === 'accepted' && isCreator) {
      await supabase.from('notifications').insert({
        user_id: booking.client_id,
        type: 'booking_accepted',
        title: 'Creator Accepted Your Booking',
        body: `Your ${booking.project_category} booking (${booking.reference}) has been accepted!`,
        link: '/dashboard/bookings',
      });

      await emailProvider.sendEmail({
        to: booking.client_email,
        subject: `Booking Accepted — ${STUDIO.name}`,
        text: `Great news! Your ${booking.project_category} booking (${booking.reference}) has been accepted by the creator.\n\nWe'll be in touch with next steps.\n\nThank you,\n${STUDIO.name}`,
      });
    }

    if (status === 'delivered' && isCreator) {
      await supabase.from('notifications').insert({
        user_id: booking.client_id,
        type: 'booking_delivered',
        title: 'Work Delivered — Review Required',
        body: `Your ${booking.project_category} booking (${booking.reference}) has been delivered! Please review and approve.`,
        link: '/dashboard/bookings',
      });

      await emailProvider.sendEmail({
        to: booking.client_email,
        subject: `Delivery Ready — ${STUDIO.name}`,
        text: `Your ${booking.project_category} booking (${booking.reference}) has been delivered by the creator.\n\nPlease log in to review the deliverables and approve the work.\n\nIf you don't respond within 7 days, the delivery will be auto-approved.\n\nThank you,\n${STUDIO.name}`,
      });
    }

    if (status === 'completed' && isClient) {
      // Auto-trigger payout
      if (booking.creator_id && booking.payment_status === 'paid') {
        const payoutResult = await triggerCreatorPayout({
          bookingId: booking.id,
          reference: booking.reference,
          creatorId: booking.creator_id,
          creatorAmount: booking.creator_amount,
          projectCategory: booking.project_category,
        });

        if (!payoutResult.success) {
          // Payout failed — notify admin for manual intervention
          console.error('[auto-payout] Failed:', payoutResult.error);
          await emailProvider.sendEmail({
            to: STUDIO.bookingEmail,
            subject: `Auto-payout failed: ${booking.reference}`,
            text: `Auto-payout failed for booking ${booking.reference}.\n\nCreator amount: R${booking.creator_amount}\nReason: ${payoutResult.error}\n\nPlease trigger manually from admin dashboard.`,
          });
        }
      }

      // Notify creator
      if (booking.creator_id) {
        await supabase.from('notifications').insert({
          user_id: booking.creator_id,
          type: 'booking_completed',
          title: 'Client Approved Your Work',
          body: `Your ${booking.project_category} gig (${booking.reference}) has been approved! Payout of R${booking.creator_amount} is being processed.`,
          link: '/dashboard/gigs',
        });
      }
    }

    if (status === 'cancelled') {
      const notifyUserId = isClient ? booking.creator_id : booking.client_id;
      if (notifyUserId) {
        await supabase.from('notifications').insert({
          user_id: notifyUserId,
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          body: `The ${booking.project_category} booking (${booking.reference}) has been cancelled.`,
          link: '/dashboard/bookings',
        });
      }

      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `Booking cancelled: ${booking.reference} — review refund`,
        text: `Booking ${booking.reference} has been cancelled.\n\nTotal paid: R${booking.total}\nCancelled by: ${isClient ? 'Client' : 'Creator'}\nReason: ${body.reason || 'Not provided'}\n\nReview if a refund is needed.`,
      });
    }
  } catch { /* notification failure shouldn't block */ }

  return NextResponse.json({ success: true, status });
}
