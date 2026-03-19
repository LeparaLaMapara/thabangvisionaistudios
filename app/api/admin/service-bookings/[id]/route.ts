export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { refundPayment } from '@/lib/payments/paystack';

// ─── PATCH — Admin update booking (assign creator, cancel, add notes) ───────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();
  const body = await request.json();
  const { creator_id, status, admin_notes, cancellation_reason } = body;

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, reference, client_id, client_email, creator_id, project_category, status, total, payment_status, paystack_reference')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

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

      // Trigger refund if paid
      if (booking.payment_status === 'paid' && booking.paystack_reference) {
        try {
          const result = await refundPayment(booking.paystack_reference);
          if (result.success) {
            update.payment_status = 'refunded';
          } else {
            console.error('[admin/service-bookings] Refund failed:', result.error);
          }
        } catch (err) {
          console.error('[admin/service-bookings] Refund error:', err);
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
      update.completed_at = new Date().toISOString();
    }
  }

  if (admin_notes !== undefined) {
    update.admin_notes = admin_notes;
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', id);

  if (updateError) {
    console.error('[admin/service-bookings] Update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
