export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { refundPayment } from '@/lib/payments/routing';
import { sendDisputeResolved } from '@/lib/email';
import { profileWithEmail } from '@/lib/supabase/profile-email';

const VALID_STATUSES = ['open', 'investigating', 'resolved', 'escalated', 'dismissed'];
const VALID_RESOLUTIONS = [
  'full_refund', 'partial_refund', 'deposit_forfeit',
  'warning_issued', 'user_suspended', 'no_action', 'custom',
];

// ─── GET — Admin get dispute detail ─────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = createAdminClient();

    const { data: dispute, error } = await supabase
      .from('disputes')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !dispute) {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });
    }

    // Fetch comments (including internal)
    const { data: comments } = await supabase
      .from('dispute_comments')
      .select('*')
      .eq('dispute_id', id)
      .order('created_at', { ascending: true });

    // Fetch related booking details
    let bookingDetails = null;
    let equipmentBookingDetails = null;

    if (dispute.booking_id) {
      const { data } = await supabase
        .from('bookings')
        .select('id, reference, client_id, client_email, creator_id, project_category, status, total, payment_status, paystack_reference')
        .eq('id', dispute.booking_id)
        .single();
      bookingDetails = data;
    }

    if (dispute.equipment_booking_id) {
      const { data } = await supabase
        .from('equipment_bookings')
        .select('id, user_id, rental_id, status, total_price, start_date, end_date, checkout_photos, return_photos, condition_at_checkout, condition_at_return, payment_reference')
        .eq('id', dispute.equipment_booking_id)
        .single();
      equipmentBookingDetails = data;
    }

    // Fetch filer profile
    const filerProfile = await profileWithEmail(dispute.filed_by);

    return NextResponse.json({
      ...dispute,
      comments: comments ?? [],
      booking: bookingDetails,
      equipment_booking: equipmentBookingDetails,
      filer: filerProfile,
    });
  } catch (err) {
    console.error('[admin/disputes/[id]] GET error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ─── PATCH — Admin resolve dispute ──────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { status, resolution, resolution_amount, resolution_notes, internal_notes } = body as {
    status?: string;
    resolution?: string;
    resolution_amount?: number;
    resolution_notes?: string;
    internal_notes?: string;
  };

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  if (resolution && !VALID_RESOLUTIONS.includes(resolution)) {
    return NextResponse.json({ error: 'Invalid resolution.' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    // Fetch dispute
    const { data: dispute, error: fetchError } = await supabase
      .from('disputes')
      .select('*, booking_id, equipment_booking_id, filed_by')
      .eq('id', id)
      .single();

    if (fetchError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { updated_at: now };

    if (status) update.status = status;
    if (resolution) {
      update.resolution = resolution;
      update.resolved_by = auth.user.id;
      update.resolved_at = now;
    }
    if (resolution_amount !== undefined) update.resolution_amount = resolution_amount;
    if (resolution_notes) update.resolution_notes = resolution_notes;

    // Process refund if applicable
    if (resolution === 'full_refund' || resolution === 'partial_refund') {
      let paymentReference: string | null = null;

      if (dispute.booking_id) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('paystack_reference, total')
          .eq('id', dispute.booking_id)
          .single();
        paymentReference = booking?.paystack_reference ?? null;

        if (paymentReference) {
          const refundAmount = resolution === 'partial_refund' ? resolution_amount : undefined;
          const refundResult = await refundPayment(paymentReference, refundAmount ?? undefined);
          if (!refundResult.success) {
            return NextResponse.json(
              { error: `Refund failed: ${refundResult.error}` },
              { status: 500 },
            );
          }
        }
      }

      if (dispute.equipment_booking_id) {
        const { data: eb } = await supabase
          .from('equipment_bookings')
          .select('payfast_payment_id, total_price')
          .eq('id', dispute.equipment_booking_id)
          .single();
        // Legacy column name: this holds the gateway reference regardless of
        // which provider took the payment.
        paymentReference = eb?.payfast_payment_id ?? null;

        if (paymentReference) {
          const refundAmount = resolution === 'partial_refund' ? resolution_amount : undefined;
          const refundResult = await refundPayment(paymentReference, refundAmount ?? undefined);
          if (!refundResult.success) {
            return NextResponse.json(
              { error: `Refund failed: ${refundResult.error}` },
              { status: 500 },
            );
          }
        }
      }
    }

    // Suspend user if resolution requires it
    if (resolution === 'user_suspended') {
      const targetUserId = dispute.filed_by;
      // Determine the offending user — for now, suspend the party against whom the dispute was filed
      // For gear disputes, that's the renter; for service disputes, depends on type
      await supabase
        .from('profiles')
        .update({
          is_suspended: true,
          suspended_at: now,
          suspended_by: auth.user.id,
          suspension_reason: resolution_notes || 'Suspended due to dispute resolution',
        })
        .eq('id', targetUserId);

      // Deactivate listings
      await supabase
        .from('smart_rentals')
        .update({ is_available: false })
        .eq('owner_id', targetUserId);
    }

    // Update dispute record
    const { error: updateError } = await supabase
      .from('disputes')
      .update(update)
      .eq('id', id);

    if (updateError) {
      console.error('[admin/disputes/[id]] Update error:', updateError.message);
      return NextResponse.json({ error: 'Failed to update dispute.' }, { status: 500 });
    }

    // Add internal note as comment if provided
    if (internal_notes && internal_notes.trim()) {
      await supabase.from('dispute_comments').insert({
        dispute_id: id,
        author_id: auth.user.id,
        comment: internal_notes.trim(),
        is_internal: true,
      });
    }

    // Notify parties
    try {
      const notifyIds: string[] = [dispute.filed_by];

      if (dispute.booking_id) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('client_id, creator_id')
          .eq('id', dispute.booking_id)
          .single();
        if (booking?.client_id) notifyIds.push(booking.client_id);
        if (booking?.creator_id) notifyIds.push(booking.creator_id);
      }

      if (dispute.equipment_booking_id) {
        const { data: eb } = await supabase
          .from('equipment_bookings')
          .select('user_id')
          .eq('id', dispute.equipment_booking_id)
          .single();
        if (eb?.user_id) notifyIds.push(eb.user_id);
      }

      const uniqueIds = [...new Set(notifyIds)];
      const statusLabel = status === 'resolved' ? 'resolved' : 'updated';

      for (const userId of uniqueIds) {
        await supabase.from('notifications').insert({
          user_id: userId,
          type: 'dispute_updated',
          title: `Dispute ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}`,
          body: resolution
            ? `Your dispute has been resolved: ${resolution.replace(/_/g, ' ')}.`
            : `Your dispute status has been updated to: ${status ?? dispute.status}.`,
          link: `/dashboard/disputes/${id}`,
        });
      }
    } catch {
      // Don't block on notification failure
    }

    // Log to moderation_log for warnings and suspensions
    if (resolution === 'warning_issued' || resolution === 'user_suspended') {
      try {
        await supabase.from('moderation_log').insert({
          user_id: dispute.filed_by,
          action: resolution === 'user_suspended' ? 'suspended' : 'warning_issued',
          reason: resolution_notes || `Dispute resolution: ${resolution}`,
          admin_id: auth.user.id,
          dispute_id: id,
          metadata: { dispute_type: dispute.dispute_type },
        });
      } catch {
        // Don't block
      }
    }

    // Send resolution email to filer
    if (resolution && status === 'resolved') {
      try {
        const filerProfile = await profileWithEmail(dispute.filed_by);

        if (filerProfile?.email) {
          await sendDisputeResolved({
            email: filerProfile.email,
            displayName: filerProfile.display_name || '',
            disputeType: dispute.dispute_type,
            resolution,
            resolutionNotes: resolution_notes ?? undefined,
            refundAmount: resolution_amount ?? undefined,
          });
        }
      } catch {
        // Email failure shouldn't block
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/disputes/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
