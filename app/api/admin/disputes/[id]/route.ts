export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isManualReference, refundPayment } from '@/lib/payments/routing';
import { toCents } from '@/lib/core/pricing/money';
import { refundObligationKey } from '@/lib/core/rental/refunds';
import { submitRefund } from '@/lib/core/rental/use-cases';
import { systemClock } from '@/lib/core/ports';
import { paymentPort } from '@/lib/payments/ports';
import { SupabaseRefunds, isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { chargeOfBooking } from '@/lib/rental/charges';
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
        // payment_reference does not exist on equipment_bookings; asking for it
        // failed the whole select, so the page never saw the booking. The
        // gateway reference lives in payfast_payment_id (legacy name).
        .select('id, user_id, rental_id, status, total_price, start_date, end_date, checkout_photos, return_photos, condition_at_checkout, condition_at_return, payfast_payment_id, smart_rentals(owner_id)')
        .eq('id', dispute.equipment_booking_id)
        .single();
      const owner = data ? ((Array.isArray(data.smart_rentals) ? data.smart_rentals[0] : data.smart_rentals) as { owner_id?: string | null } | null) : null;
      equipmentBookingDetails = data
        ? { ...data, payment_reference: (data as { payfast_payment_id?: string | null }).payfast_payment_id ?? null, owner_id: owner?.owner_id ?? null }
        : null;
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

  const { status, resolution, resolution_amount, resolution_notes, internal_notes, suspend_user_id } = body as {
    status?: string;
    resolution?: string;
    resolution_amount?: number;
    resolution_notes?: string;
    internal_notes?: string;
    /** Who to suspend for a user_suspended resolution: must be a party to the dispute. A person decides; it is never inferred. */
    suspend_user_id?: string;
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
          .select('id, user_id, checkout_group_id, payfast_payment_id, deposit_amount')
          .eq('id', dispute.equipment_booking_id)
          .single();
        // Legacy column name: this holds the gateway reference regardless of
        // which provider took the payment.
        paymentReference = eb?.payfast_payment_id ?? null;

        if (eb && paymentReference && !isManualReference(paymentReference)) {
          // One refund obligation per dispute, capped at what is left of the
          // charge (T13, T14), submitted now and reconciled by the pipeline if
          // the provider does not answer.
          const charge = await chargeOfBooking(supabase, eb);
          const amountCents = resolution === 'partial_refund' ? toCents(Number(resolution_amount ?? 0)) : charge.remainderCents;
          if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > charge.remainderCents) {
            return NextResponse.json({ error: `The refund must be between R0.01 and what is left of the charge (R${(charge.remainderCents / 100).toFixed(2)}).` }, { status: 400 });
          }
          const key = refundObligationKey('manual', `dispute:${id}`);
          const { error: obErr } = await supabase.from('refund_obligations').upsert({
            obligation_key: key,
            reason: 'manual',
            amount_cents: amountCents,
            charged_cents: charge.totalCents,
            transaction_reference: paymentReference,
            user_id: eb.user_id,
            booking_group_id: eb.checkout_group_id,
            booking_ids: [eb.id],
            evidence: { dispute_id: id, resolution, by: auth.user.id },
            created_by: auth.user.id,
          }, { onConflict: 'obligation_key', ignoreDuplicates: true });
          if (obErr && !isMissingPipeline(obErr)) {
            return NextResponse.json({ error: 'Could not record the refund. Nothing was sent.' }, { status: 500 });
          }
          if (obErr) {
            // Migration 070 not applied: the earlier direct refund.
            const refundResult = await refundPayment(paymentReference, resolution === 'partial_refund' ? resolution_amount : undefined);
            if (!refundResult.success) return NextResponse.json({ error: 'Refund failed at the payment provider.' }, { status: 502 });
          } else {
            const { data: ob } = await supabase.from('refund_obligations').select('id').eq('obligation_key', key).maybeSingle();
            if (ob) await submitRefund((ob as { id: string }).id, { refunds: new SupabaseRefunds(supabase), payments: paymentPort, clock: systemClock }).catch(() => 'unknown_outcome');
          }
        } else if (paymentReference) {
          // Paid by hand (EFT/cash): a person pays it back.
          update.resolution_notes = `${resolution_notes ?? ''}${resolution_notes ? ' | ' : ''}Refund to be paid back by hand (manual payment).`;
        }
      }
    }

    // A resolved gear dispute closes the booking, with the reason on record.
    if (dispute.equipment_booking_id && (status === 'resolved' || status === 'dismissed')) {
      await transitionBookings(supabase, {
        ids: [dispute.equipment_booking_id],
        from: ['disputed'],
        to: 'completed',
        actor: 'staff',
        actorId: auth.user.id,
        reason: `dispute ${status}: ${resolution ?? 'no resolution'}${resolution_notes ? ` (${String(resolution_notes).slice(0, 200)})` : ''}`,
        notices: [],
      }).catch(() => undefined);
    }

    // Suspend user if resolution requires it
    if (resolution === 'user_suspended') {
      // The admin names who is suspended. It used to be the person who FILED
      // the dispute, which suspended complainants. It must be a party to it.
      const parties = new Set<string>([dispute.filed_by]);
      if (dispute.equipment_booking_id) {
        const { data: eb } = await supabase.from('equipment_bookings').select('user_id, smart_rentals(owner_id)').eq('id', dispute.equipment_booking_id).maybeSingle();
        if (eb?.user_id) parties.add(eb.user_id);
        const r = (Array.isArray(eb?.smart_rentals) ? eb?.smart_rentals[0] : eb?.smart_rentals) as { owner_id?: string | null } | null;
        if (r?.owner_id) parties.add(r.owner_id);
      }
      if (dispute.booking_id) {
        const { data: sb } = await supabase.from('bookings').select('client_id, creator_id').eq('id', dispute.booking_id).maybeSingle();
        if (sb?.client_id) parties.add(sb.client_id);
        if (sb?.creator_id) parties.add(sb.creator_id);
      }
      if (!suspend_user_id || !parties.has(suspend_user_id)) {
        return NextResponse.json({ error: 'Choose which party to suspend; it must be someone in this dispute.' }, { status: 400 });
      }
      const targetUserId = suspend_user_id;
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
