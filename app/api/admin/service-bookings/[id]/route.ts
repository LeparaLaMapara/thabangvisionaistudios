export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { adminCancelRefundLines, checkServiceRefund, payoutAlreadySent, payoutDueAt } from '@/lib/core/services/fulfilment';
import { recordServiceBookingEvent } from '@/lib/supabase/queries/service-bookings';
import { claimServiceRefund, sendClaimedServiceRefund, updateBookingWhere, type CasResult } from '@/lib/payments/service-refunds';

// ─── PATCH — Admin update booking (assign creator, cancel, add notes) ───────

/** Statuses in which an admin may choose or change the creator. */
const ASSIGNABLE = new Set(['paid', 'pending_reassignment']);

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
    .select('id, reference, client_id, client_email, creator_id, project_category, status, total, payment_status, payout_status, paystack_reference, cancellation_refund_status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const now = new Date();
  const update: Record<string, unknown> = {
    updated_at: now.toISOString(),
  };
  /** What happened to the refund on an admin cancel, for the response. */
  let refundResult: 'refunded' | 'failed' | 'unknown' | 'manual_review' | 'already_started' | 'not_claimed' | null = null;
  /** The refund this request claims with the cancel itself, in whole rands. */
  let claimAmount: number | null = null;
  const statusRead = (booking.status ?? null) as string | null;
  const payoutStatusRead = (booking.payout_status ?? null) as string | null;
  const refundStatusRead = (booking.cancellation_refund_status ?? null) as string | null;

  // Assign (or swap) the creator. Only while nobody has started the work:
  // paid and not yet accepted, or waiting for a new creator after the first
  // one did not answer (daily-maintenance moves those to pending_reassignment).
  // The booking goes back to "paid", waiting for the new creator to accept.
  const previousCreator = (booking.creator_id ?? null) as string | null;
  if (creator_id) {
    if (typeof creator_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(creator_id)) {
      return NextResponse.json({ error: 'Choose a creator from the list.' }, { status: 400 });
    }
    if (status) {
      return NextResponse.json({ error: 'Assign a creator on its own, not together with a status change.' }, { status: 400 });
    }
    if (!ASSIGNABLE.has(String(booking.status))) {
      return NextResponse.json(
        { error: `A creator can only be chosen before the work starts. This booking is ${String(booking.status).replace(/_/g, ' ')}.`, code: 'NOT_ASSIGNABLE' },
        { status: 409 },
      );
    }
    if (creator_id === booking.client_id) {
      return NextResponse.json({ error: 'The client cannot be the creator on their own booking.' }, { status: 400 });
    }
    if (creator_id === previousCreator) {
      return NextResponse.json({ error: 'That creator already has this booking.' }, { status: 400 });
    }
    const { data: creator } = await supabase
      .from('profiles')
      .select('id, verification_status, is_suspended')
      .eq('id', creator_id)
      .maybeSingle();
    if (!creator || creator.verification_status !== 'verified' || creator.is_suspended) {
      return NextResponse.json({ error: 'That person is not an ID-checked, active creator.' }, { status: 400 });
    }
    update.creator_id = creator_id;
    update.status = 'paid';
    update.accepted_at = null;
  }

  // Admin status override
  if (status) {
    update.status = status;

    if (status === 'cancelled') {
      // The creator has been paid, or the payout is with the provider: a
      // cancel would refund the client while the creator keeps the money.
      // A person decides; nothing is written.
      if (payoutAlreadySent({ status: statusRead, payoutStatus: payoutStatusRead })) {
        return NextResponse.json(
          {
            error: 'The creator has already been paid for this booking (or the payout is with the provider), so it is not cancelled or refunded here. A person decides: check the payout and the payment provider, and refund by hand if the client should get money back.',
            code: 'PAYOUT_ALREADY_SENT',
          },
          { status: 409 },
        );
      }
      update.cancelled_at = now.toISOString();
      update.cancellation_reason = cancellation_reason || 'Cancelled by admin';

      // Refund the full total if paid, unless a refund is already recorded as
      // made or possibly made (a client cancellation, a creator decline, an
      // earlier admin cancel) or is with a person (manual_review). Refunding
      // again could pay the client twice.
      if (booking.payment_status === 'paid' && booking.paystack_reference) {
        const check = checkServiceRefund({ status: statusRead, payoutStatus: payoutStatusRead, refundStatus: refundStatusRead });
        if (check.ok) {
          claimAmount = Math.round(Number(booking.total ?? 0));
          update.cancellation_refund_percent = 100;
        } else {
          refundResult = check.code === 'REFUND_ALREADY_STARTED' ? 'already_started' : 'not_claimed';
        }
      }
    }

    if (status === 'completed') {
      // An admin completing a booking (e.g. resolving a dispute for the
      // creator) starts the same payout clock as a client approval. The
      // payout is sent by the daily job once due; nothing is paid here.
      const due = payoutDueAt(now).toISOString();
      update.completed_at = now.toISOString();
      update.payout_due_at = due;
      update.dispute_window_ends_at = due;
    }
  }

  if (admin_notes !== undefined) {
    update.admin_notes = admin_notes;
  }

  // ── Write: compare-and-set on what was read ──────────────────────────────
  // A status change only lands while the booking is still in the status read
  // (and, for a cancel, the payout status read). A cancel that refunds claims
  // the refund in the same update: status, payout status and refund status
  // must all still be as read. A double click, a second admin, the client
  // cancelling or the payout run starting at the same moment: whoever writes
  // second gets a 409 and sends nothing.
  let written: CasResult;
  if (claimAmount !== null) {
    const claim = await claimServiceRefund(
      supabase,
      { id, status: statusRead, payoutStatus: payoutStatusRead, refundStatus: refundStatusRead },
      { amountRands: claimAmount, now, extra: update },
    );
    written = claim.claimed ? { ok: true, updated: true } : claim.error ? { ok: false, error: claim.error } : { ok: true, updated: false };
  } else {
    const expect: Record<string, string | null> = {};
    if (status || creator_id) expect.status = statusRead;
    if (status === 'cancelled') expect.payout_status = payoutStatusRead;
    written = await updateBookingWhere(supabase, id, expect, update);
  }

  if (!written.ok) {
    console.error('[admin/service-bookings] Update error:', written.error);
    return NextResponse.json({ error: 'Failed to update booking. Nothing was refunded.' }, { status: 500 });
  }
  if (!written.updated) {
    return NextResponse.json(
      {
        error: 'This booking was changed by someone else (another admin, the client, or the payout run) while you were looking at it. Nothing was refunded. Refresh and check it before trying again.',
        code: 'BOOKING_CHANGED',
      },
      { status: 409 },
    );
  }

  // ── Money: only once the cancel and the claim are recorded ───────────────
  let recorded = true;
  if (claimAmount !== null) {
    const r = await sendClaimedServiceRefund(supabase, {
      bookingId: id,
      reference: String(booking.paystack_reference),
      amountRands: claimAmount,
      total: claimAmount,
      idempotencyKey: `service-admin-cancel:${id}`,
      now,
    });
    refundResult = r.outcome;
    recorded = r.recorded;
    if (r.outcome !== 'refunded') console.error('[admin/service-bookings] refund not completed:', r.outcome);
  }

  if (creator_id && previousCreator) {
    try {
      await supabase.from('notifications').insert({
        user_id: previousCreator,
        type: 'gig_unassigned',
        title: 'Gig Unassigned',
        body: `The ${booking.project_category} booking (${booking.reference}) has been given to another creator.`,
        link: '/dashboard/gigs',
      });
    } catch { /* don't block */ }
  }

  if (creator_id) {
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

  if (status === 'cancelled') {
    // An amount is promised to the client only when the provider accepted the refund.
    const lines = adminCancelRefundLines(booking.payment_status === 'paid', refundResult, Number(booking.total ?? 0));
    try {
      await supabase.from('notifications').insert({
        user_id: booking.client_id,
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        body: `Your ${booking.project_category} booking (${booking.reference}) has been cancelled. ${lines.short}`.trim(),
        link: '/dashboard/bookings',
      });

      await emailProvider.sendEmail({
        to: booking.client_email,
        subject: `Booking Cancelled — ${STUDIO.name}`,
        text: `Hi,\n\nYour ${booking.project_category} booking (${booking.reference}) has been cancelled.\n\n${lines.long}\n\nReason: ${cancellation_reason || 'Not specified'}\n\nIf you have questions, contact us at ${STUDIO.email}.\n\nThank you,\n${STUDIO.name}`,
      });
    } catch { /* don't block */ }
  }

  if (!recorded && (refundResult === 'refunded' || refundResult === 'unknown')) {
    // Money moved (or may have) but the outcome could not be written over the
    // claim. The booking still shows the refund 'pending', which blocks any
    // further automatic refund and the payout; a person records what happened.
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Refund not recorded — ${booking.reference}`,
        text: `An admin cancelled booking ${booking.reference} and a refund of R${claimAmount} was ${refundResult === 'refunded' ? 'sent' : 'attempted with no clear answer (it may have gone through)'}, but the outcome could not be recorded on the booking (it still shows the refund as pending).\n\nCheck the payment provider for reference ${booking.paystack_reference} and record the refund on the booking by hand. Do NOT refund it again until it is recorded.`,
      });
    } catch { /* logged above */ }
  } else if (refundResult === 'unknown' || refundResult === 'failed' || refundResult === 'manual_review') {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Refund ${refundResult === 'unknown' ? 'outcome unknown' : refundResult === 'failed' ? 'failed' : 'to make by hand'} — ${booking.reference}`,
        text: refundResult === 'unknown'
          ? `An admin cancelled booking ${booking.reference}. The refund of R${claimAmount} got no clear answer from the payment provider, so it MAY already have gone through.\n\nCHECK the provider first (its refunds for payment reference ${booking.paystack_reference}, or the dashboard). Refund by hand ONLY if no refund is there, then record it. Cancelling again will not send another refund.`
          : refundResult === 'failed'
            ? `An admin cancelled booking ${booking.reference}. The payment provider refused the refund of R${claimAmount}; nothing was refunded. Refund it by hand and record it.`
            : `An admin cancelled booking ${booking.reference}. It was paid by EFT or cash, so the refund of R${claimAmount} is made by hand. Record it once paid.`,
      });
    } catch { /* don't block */ }
  } else if (refundResult === 'already_started') {
    // No second refund was sent. Tell a person what is on record, so a refund
    // left 'pending' (claimed, no outcome) or 'unknown' is not forgotten.
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Refund already on record — ${booking.reference}`,
        text: `An admin cancelled booking ${booking.reference}. A refund was already on record (${refundStatusRead}), so no second refund was sent.\n\n${refundStatusRead === 'refunded' ? 'Check that the amount refunded is what the client should get back, and refund any balance by hand.' : `Its outcome is not settled: CHECK the payment provider's refunds for reference ${booking.paystack_reference}, then record what happened. Refund by hand ONLY if nothing went back.`}`,
      });
    } catch { /* don't block */ }
  } else if (refundResult === 'not_claimed') {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Cancelled without an automatic refund — ${booking.reference}`,
        text: `An admin cancelled booking ${booking.reference}. Its refund is marked '${refundStatusRead}', so no automatic refund was sent. Decide whether the client gets money back, refund by hand if so, and record it.`,
      });
    } catch { /* don't block */ }
  }

  if (creator_id) {
    await recordServiceBookingEvent(supabase, {
      bookingId: id, event: 'admin_assign', from: booking.status, to: 'paid', actor: 'admin', actorId: auth.user.id,
      reason: previousCreator ? `creator changed from ${previousCreator} to ${creator_id}` : `creator ${creator_id} assigned`,
    });
  }

  if (status && status !== booking.status) {
    await recordServiceBookingEvent(supabase, {
      bookingId: id, event: 'admin_status', from: booking.status, to: String(status), actor: 'admin', actorId: auth.user.id,
      reason: typeof cancellation_reason === 'string' ? cancellation_reason : null,
    });
  }

  return NextResponse.json({ success: true, ...(refundResult ? { refund_status: refundResult } : {}) });
}
