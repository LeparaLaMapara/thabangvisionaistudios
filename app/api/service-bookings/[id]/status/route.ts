export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';
import { sendClaimedServiceRefund } from '@/lib/payments/service-refunds';
import { logEvent } from '@/lib/data/events';
import { notifyClient } from '@/lib/bookings/notify-client';
import {
  decideServiceTransition,
  payoutTimingText,
  serviceActionFromRequest,
  type TransitionDecision,
} from '@/lib/core/services/fulfilment';
import {
  readServiceBooking,
  recordServiceBookingEvent,
  updateServiceBooking,
} from '@/lib/supabase/queries/service-bookings';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

/**
 * PATCH /api/service-bookings/[id]/status
 *
 * Body: `{ action, reason? }`, or the older `{ status, reason? }`.
 *   creator: accept | decline                       (from 'paid')
 *   client:  approve_delivery | request_revision    (from 'delivered')
 *            cancel                                 (from 'paid' or 'accepted',
 *                                                    never after a delivery)
 *
 * The rules live in lib/core/services/fulfilment.ts. Approving a delivery
 * records the client's acceptance and schedules the creator payout for
 * STUDIO.booking.payoutDelayHours later; it never pays on the spot. Payouts
 * are sent by the daily maintenance job (or an admin) once due and allowed.
 */

interface StatusBookingRow {
  id: string;
  client_id: string;
  client_email: string | null;
  creator_id: string | null;
  project_category: string;
  status: string;
  total: number;
  creator_amount: number | null;
  reference: string;
  payment_status: string | null;
  shoot_date: string | null;
  paystack_reference: string | null;
  created_at: string | null;
  delivered_at: string | null;
  delivery_url: string | null;
  cancellation_refund_status: string | null;
  revisions_included?: number | null;
  revisions_used?: number | null;
}

const BASE = 'id, client_id, client_email, creator_id, project_category, status, total, creator_amount, reference, payment_status, shoot_date, paystack_reference, created_at, delivered_at, delivery_url, cancellation_refund_status';
const EXTRA = 'revisions_included, revisions_used';

const sast = (iso: string): string =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });

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

  if (!(await checkRateLimit(`booking-status:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { status?: unknown; action?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Status or action is required' }, { status: 400 });
  }

  // Read with the user's own session: RLS shows them only bookings they are party to.
  const read = await readServiceBooking<StatusBookingRow>(supabase, id, BASE, EXTRA);
  const booking = read.data;
  if (read.error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const isCreator = booking.creator_id === user.id;
  const isClient = booking.client_id === user.id;

  if (!isCreator && !isClient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Prevents a self-payout loop. Should not happen: booking yourself is refused.
  if (isCreator && isClient) {
    return NextResponse.json({ error: 'Cannot update status on self-assigned bookings' }, { status: 403 });
  }

  const role = isCreator ? 'creator' : 'client';
  if (body.status === 'delivered' || body.action === 'deliver') {
    return NextResponse.json({ error: 'Submit the delivery link through the deliver step' }, { status: 400 });
  }
  const action = serviceActionFromRequest(role, body);
  if (!action) {
    return NextResponse.json(
      { error: `A ${role} cannot set '${String(body.action ?? body.status ?? '')}' on a booking that is '${booking.status}'` },
      { status: 400 },
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason : null;
  const now = new Date();
  const decision = decideServiceTransition({
    action,
    actor: role,
    booking: {
      status: booking.status,
      paymentStatus: booking.payment_status,
      paymentReference: booking.paystack_reference,
      total: Number(booking.total ?? 0),
      createdAt: booking.created_at,
      shootDate: booking.shoot_date,
      deliveredAt: booking.delivered_at,
      deliveryUrl: booking.delivery_url,
      revisionsIncluded: booking.revisions_included ?? null,
      revisionsUsed: booking.revisions_used ?? null,
      refundStatus: booking.cancellation_refund_status,
    },
    now,
    reason,
  });

  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, code: decision.code }, { status: 400 });
  }

  // ── Write: compare-and-set on the status we read ─────────────────────────
  let writtenStatus: string = decision.to;
  const patch: Record<string, unknown> = { ...decision.patch, status: decision.to, updated_at: now.toISOString() };
  // A refund is claimed in this same update, so it must also still see the
  // refund record it was decided on (no second refund over a recorded one).
  const refundExpect: Record<string, string | null> = decision.refund ? { cancellation_refund_status: booking.cancellation_refund_status ?? null } : {};
  let result = await updateServiceBooking(admin(), id, decision.from, patch, refundExpect);

  if (!result.ok && decision.to === 'declined' && /bookings_status_check/.test(result.error)) {
    // Migration 073 not applied yet: 'declined' is not a valid status there.
    // Record the decline as a cancellation so the client is still refunded.
    writtenStatus = 'cancelled';
    result = await updateServiceBooking(admin(), id, decision.from, {
      ...patch,
      status: 'cancelled',
      cancelled_at: now.toISOString(),
      cancellation_reason: `Declined by creator${decision.patch.decline_reason ? `: ${decision.patch.decline_reason}` : ''}`,
    }, refundExpect);
  }

  if (!result.ok) {
    console.error('[service-bookings/status] Update error:', result.error);
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
  }
  if (!result.updated) {
    return NextResponse.json({ error: 'This booking was changed by someone else. Refresh and try again.' }, { status: 409 });
  }

  await recordServiceBookingEvent(admin(), {
    bookingId: id,
    event: action,
    from: decision.from,
    to: writtenStatus,
    actor: role,
    actorId: user.id,
    reason: (decision.patch.decline_reason as string | null | undefined) ?? (decision.patch.cancellation_reason as string | null | undefined) ?? (action === 'request_revision' ? reason : null),
  });

  // ── Money: only after the status change is safely recorded ──────────────
  const refundOutcome = await settleRefund(id, booking, decision);

  logEvent({
    eventType: `booking_${action}`,
    eventCategory: 'booking',
    userId: user.id,
    metadata: { bookingId: id, reference: booking.reference, from: decision.from, to: writtenStatus, role },
  });

  // ── Tell people. Never blocks the response. ──────────────────────────────
  try {
    await sideEffects({ booking, decision, writtenStatus, reason, refundOutcome });
  } catch { /* notification failure shouldn't block */ }

  return NextResponse.json({
    success: true,
    status: writtenStatus,
    action,
    ...(decision.patch.payout_due_at ? { payout_due_at: decision.patch.payout_due_at } : {}),
    ...(action === 'cancel' || action === 'decline'
      ? { cancellation: decision.cancellation, refund_status: refundOutcome ?? decision.refundStatus ?? null }
      : {}),
  });
}

/**
 * refunded      the provider accepted the refund
 * failed        the provider refused it: nothing moved, a person refunds by hand
 * unknown       no clear answer: it may have gone through. A person CHECKS the
 *               provider before refunding by hand, or the client is paid twice
 * manual_review paid by EFT or cash: refunded by hand
 */
type RefundOutcome = 'refunded' | 'failed' | 'manual_review' | 'unknown' | null;

/**
 * The status change above is the claim: it moved the booking out of 'paid' /
 * 'accepted' with a compare-and-set and wrote cancellation_refund_status
 * 'pending' in the same update, so a second request (or an admin cancel) can
 * no longer claim this refund. The outcome is written only over that
 * 'pending' (lib/payments/service-refunds.ts), never over a later record.
 */
async function settleRefund(id: string, booking: StatusBookingRow, decision: Extract<TransitionDecision, { ok: true }>): Promise<RefundOutcome> {
  if (!decision.refund || !booking.paystack_reference) return null;
  const r = await sendClaimedServiceRefund(admin(), {
    bookingId: id,
    reference: booking.paystack_reference,
    amountRands: decision.refund.amount,
    total: Number(booking.total ?? 0),
    idempotencyKey: `service-${decision.action}:${id}`,
  });
  if (r.outcome !== 'refunded') console.error('[service-bookings/status] refund not completed:', r.outcome);
  return r.outcome;
}

/** A refund was already on record, so no automatic one was sent. */
const REFUND_ON_RECORD_LINE = (status: string): string =>
  `ACTION NEEDED: a refund was already on record for this booking (${status}), so no automatic refund was sent. Check the payment provider for what has gone back, then refund any balance by hand.`;

/** Staff wording for a refund that did not complete automatically. */
function staffRefundLine(outcome: RefundOutcome, amount: number | undefined, reference: string | null): string {
  switch (outcome) {
    case 'manual_review':
      return `ACTION NEEDED: paid by EFT or cash. Refund R${amount} by hand.`;
    case 'unknown':
      return `ACTION NEEDED: REFUND OUTCOME UNKNOWN for R${amount}. The payment provider did not answer clearly, so the refund MAY already have gone through. CHECK the provider first (its refunds for payment reference ${reference ?? 'unknown'}, or the dashboard). Refund by hand ONLY if no refund is there, then record it.`;
    default:
      return `ACTION NEEDED: AUTOMATIC REFUND FAILED (the provider refused it, nothing was refunded). Refund R${amount} by hand.`;
  }
}

async function sideEffects(p: {
  booking: StatusBookingRow;
  decision: Extract<TransitionDecision, { ok: true }>;
  writtenStatus: string;
  reason: string | null;
  refundOutcome: RefundOutcome;
}): Promise<void> {
  const { booking, decision, refundOutcome } = p;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || STUDIO.meta.url;

  switch (decision.action) {
    case 'accept': {
      await notifyClient({
        bookingId: booking.id,
        type: 'booking_accepted',
        title: 'Creator Accepted Your Booking',
        body: `Your ${booking.project_category} booking (${booking.reference}) has been accepted by the creator. We'll be in touch with next steps.`,
      });
      return;
    }

    case 'decline': {
      const refundLine = refundOutcome === 'refunded'
        ? `Your payment of R${decision.refund?.amount} is being refunded in full to the card you paid with. When it shows depends on your bank.`
        : decision.refund
          ? 'Your payment will be refunded in full. Our team is processing it.'
          : booking.cancellation_refund_status
            ? 'Our team will be in touch with you about your refund.'
            : 'Nothing was charged.';
      await notifyClient({
        bookingId: booking.id,
        type: 'booking_rejected',
        title: 'Your creator could not take this booking',
        body: `The creator could not take your ${booking.project_category} booking (${booking.reference}). ${refundLine} We will contact you to offer another creator if you would like one.`,
      });
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `[Action Required] Creator declined — ${booking.reference}`,
        text: `The creator declined ${booking.project_category} booking ${booking.reference}.

Reason: ${decision.patch.decline_reason ?? 'Not given'}
Client: ${booking.client_email ?? 'unknown'}
Refund: ${refundOutcome === 'refunded' ? `R${decision.refund?.amount} refunded automatically` : refundOutcome ? staffRefundLine(refundOutcome, decision.refund?.amount, booking.paystack_reference) : booking.cancellation_refund_status ? REFUND_ON_RECORD_LINE(booking.cancellation_refund_status) : 'nothing was charged'}

Offer the client another creator (they can rebook) in ${baseUrl}/admin/service-bookings`,
      });
      return;
    }

    case 'approve_delivery': {
      if (!booking.creator_id) return;
      const due = decision.patch.payout_due_at as string;
      await admin().from('notifications').insert({
        user_id: booking.creator_id,
        type: 'booking_completed',
        title: 'Client Approved Your Work',
        body: `Your ${booking.project_category} gig (${booking.reference}) was approved. Your payout of R${booking.creator_amount} is due to be sent on ${sast(due)}, as long as no problem is raised before then. When it reaches your account depends on your bank.`,
        link: '/dashboard/gigs',
      });
      return;
    }

    case 'request_revision': {
      if (!booking.creator_id) return;
      const what = p.reason ?? '';
      await admin().from('notifications').insert({
        user_id: booking.creator_id,
        type: 'gig_revision_requested',
        title: 'Revision requested',
        body: `The client asked for changes on ${booking.project_category} (${booking.reference}): "${what.slice(0, 300)}". Deliver the revised work from your gigs dashboard.`,
        link: '/dashboard/gigs',
      });
      const { data: creator } = await admin().auth.admin.getUserById(booking.creator_id);
      if (creator?.user?.email) {
        await emailProvider.sendEmail({
          to: creator.user.email,
          subject: `Revision requested — ${booking.reference} — ${STUDIO.name}`,
          text: `The client asked for changes on your ${booking.project_category} gig (${booking.reference}):\n\n${what}\n\nPlease deliver the revised work from ${baseUrl}/dashboard/gigs.\n\n${payoutTimingText()}\n\n${STUDIO.name}`,
        });
      }
      return;
    }

    case 'cancel': {
      if (booking.creator_id) {
        await admin().from('notifications').insert({
          user_id: booking.creator_id,
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          body: `The ${booking.project_category} booking (${booking.reference}) has been cancelled.`,
          link: '/dashboard/gigs',
        });
      }

      const q = decision.cancellation;
      const refundLine = (() => {
        switch (decision.refundStatus) {
          case 'pending':
            if (refundOutcome === 'refunded') return `Refunded automatically: R${q?.totalRefund} (${q?.refundPercent}% of the booking, ${q?.hoursBefore}h notice).`;
            return staffRefundLine(refundOutcome ?? 'failed', q?.totalRefund, booking.paystack_reference);
          case 'manual_review':
            return 'ACTION NEEDED: no shoot date on record, so notice could not be measured. Assess this refund by hand.';
          case 'not_required':
            return 'No refund due: the booking was unpaid, or the cancellation fell inside the non-refundable window.';
          default:
            return booking.cancellation_refund_status ? REFUND_ON_RECORD_LINE(booking.cancellation_refund_status) : 'Review if a refund is needed.';
        }
      })();

      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `Booking cancelled: ${booking.reference}`,
        text: `Booking ${booking.reference} has been cancelled.

Total paid: R${booking.total}
Cancelled by: Client
Reason: ${decision.patch.cancellation_reason ?? 'Not provided'}

${refundLine}`,
      });
      return;
    }

    default:
      return;
  }
}
