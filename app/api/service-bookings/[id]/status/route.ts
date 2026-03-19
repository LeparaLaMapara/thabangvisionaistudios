export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';

// Allowed status transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  paid: ['accepted', 'cancelled'],
  accepted: ['completed', 'cancelled'],
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
    .select('id, client_id, client_email, creator_id, project_category, status, total, creator_amount, reference')
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

  // Creator can accept paid bookings, client can mark complete or cancel
  if (isCreator && !isClient) {
    if (status === 'accepted' && booking.status !== 'paid') {
      return NextResponse.json({ error: 'Can only accept paid bookings' }, { status: 400 });
    }
    if (status !== 'accepted') {
      return NextResponse.json({ error: 'Creators can only accept bookings' }, { status: 403 });
    }
  }

  if (isClient && !isCreator) {
    if (status === 'completed' && booking.status !== 'accepted') {
      return NextResponse.json({ error: 'Can only complete accepted bookings' }, { status: 400 });
    }
    if (status === 'cancelled' && !['paid', 'accepted'].includes(booking.status)) {
      return NextResponse.json({ error: 'Cannot cancel this booking' }, { status: 400 });
    }
    if (!['completed', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Clients can only complete or cancel bookings' }, { status: 403 });
    }
  }

  // Validate transition
  const allowed = ALLOWED_TRANSITIONS[booking.status];
  if (!allowed || !allowed.includes(status)) {
    return NextResponse.json(
      { error: `Cannot transition from '${booking.status}' to '${status}'` },
      { status: 400 },
    );
  }

  // Build update
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'accepted') update.accepted_at = new Date().toISOString();
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

  // Notifications
  try {
    if (status === 'accepted' && isCreator) {
      // Notify client
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

    if (status === 'completed' && isClient) {
      // Notify creator
      if (booking.creator_id) {
        await supabase.from('notifications').insert({
          user_id: booking.creator_id,
          type: 'booking_completed',
          title: 'Gig Marked Complete',
          body: `Your ${booking.project_category} gig (${booking.reference}) has been marked complete. Payout of R${booking.creator_amount} is pending admin approval.`,
          link: '/dashboard/gigs',
        });
      }

      // Notify admin
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `Booking completed: ${booking.reference} — ready for payout`,
        text: `Booking ${booking.reference} (${booking.project_category}) has been marked complete by the client.\n\nCreator payout: R${booking.creator_amount}\n\nTrigger payout from admin dashboard.`,
      });
    }

    if (status === 'cancelled') {
      // Notify the other party
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

      // Notify admin for potential refund
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `Booking cancelled: ${booking.reference} — review refund`,
        text: `Booking ${booking.reference} has been cancelled.\n\nTotal paid: R${booking.total}\nCancelled by: ${isClient ? 'Client' : 'Creator'}\nReason: ${body.reason || 'Not provided'}\n\nReview if a refund is needed.`,
      });
    }
  } catch { /* notification failure shouldn't block */ }

  return NextResponse.json({ success: true, status });
}
