export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { checkTransition, isBookingStatus } from '@/lib/core/rental/state';
import { disputeMoney, refundObligationKey } from '@/lib/core/rental/refunds';
import { personSettlement } from '@/lib/core/rental/ledger';
import { buildNotices } from '@/lib/core/rental/notifications';
import { isManualReference } from '@/lib/payments/routing';
import { isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { dispatchOutbox } from '@/lib/rental/notify';
import { chargeOfBooking } from '@/lib/rental/charges';
import { logEvent } from '@/lib/data/events';
import { deliveryCancellationPlan, heldForStaffCancel, settleAfterLineCancelled, type DeliveryCancellationPlan } from '@/lib/rental/delivery-settlement';

/**
 * Admin status changes for a gear booking (spec §7.3, §7.15).
 *
 * Only moves the state machine allows for staff, each with a recorded reason.
 * Moves that need evidence have their own screens and are refused here:
 *   pending → confirmed        Mark paid (records the payment reference)
 *   confirmed → active         Handover checklist
 *   active/overdue → returned  Take-back checklist (inspection, deposit)
 * Cancelling a paid booking needs the refund amount, which becomes one
 * refund obligation capped at the original charge.
 *
 * Phase 4 delivery (same rules as the renter's cancellation in
 * app/api/bookings/[id]): the delivery fee is never part of the staff refund
 * or of what the line releases here. When the order's last line goes, its
 * live legs are cancelled through the delivery core (fee refunded once, in
 * full, as a platform cancellation) and any paid quote no leg was made from
 * is refunded. A leg actually in motion (the gear with a courier or our
 * driver) must be closed in the delivery console first (409
 * DELIVERY_UNDER_WAY), and nothing changes. Staff are not held back by legs
 * that already reached the renter or are lost, damaged or under review
 * (review fix round 2, finding 3): the booking is cancelled and those legs
 * are left as they are and logged. Their fee is kept (D-39/D-52: the gear
 * reached the renter) unless staff tick "refund the delivery fee"
 * (`refundDeliveryFee: true`), which refunds it once through the core. The
 * renter's own cancellation keeps the stricter rule (any leg past the
 * cancellable states blocks it).
 */

const NEEDS_OWN_SCREEN: Record<string, string> = {
  'pending>confirmed': 'Use "Mark paid" so the payment reference is recorded.',
  'confirmed>active': 'Use the handover checklist.',
  'active>return_pending': 'Use the take-back checklist.',
  'overdue>return_pending': 'Use the take-back checklist.',
  'return_pending>completed': 'Use the take-back checklist so the deposit is settled.',
  'return_reviewed>completed': 'Use the take-back checklist so the deposit is settled.',
  // A dispute is opened with its record and closed through it, so the money is settled.
  'return_pending>disputed': 'Use the take-back checklist to open a dispute.',
  'return_reviewed>disputed': 'Use the take-back checklist to open a dispute.',
  'disputed>completed': 'Resolve it in Disputes so the hire, deposit and any owner payout are settled.',
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  let body: { status?: string; reason?: string; refundCents?: number; refundDeliveryFee?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const to = body.status;
  if (!to || !isBookingStatus(to)) {
    return NextResponse.json({ error: 'A valid status is required.' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  const db = createAdminClient();
  const { data: booking } = await db
    .from('equipment_bookings')
    .select('id, user_id, status, checkout_group_id, payfast_payment_id, deposit_amount')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  if (booking.status === 'disputed' && to === 'completed') {
    // Closed through its dispute record. A booking disputed before records were
    // always created gets one now, so it can be settled there.
    const { data: disputeRow, error: disputeErr } = await db.rpc('open_return_dispute', {
      p_booking: id,
      p_by: auth.user.id,
      p_reason: reason || 'Disputed return to settle',
      p_photos: [],
      p_note: null,
    });
    if (disputeErr && !isMissingPipeline(disputeErr)) return NextResponse.json({ error: 'Could not load the dispute; try again.' }, { status: 503 });
    if (!disputeErr) {
      return NextResponse.json(
        { error: NEEDS_OWN_SCREEN['disputed>completed'], code: 'USE_WORKFLOW', dispute_id: (disputeRow as string | null) ?? null },
        { status: 409 },
      );
    }
    // Migration 070 not applied: nothing is in the ledger yet, so the earlier
    // direct completion still applies (below, via the legacy update).
  }

  const ownScreen = booking.status === 'disputed' && to === 'completed' ? undefined : NEEDS_OWN_SCREEN[`${booking.status}>${to}`];
  if (ownScreen) return NextResponse.json({ error: ownScreen, code: 'USE_WORKFLOW' }, { status: 409 });

  const check = checkTransition(booking.status, to, 'staff', reason || null);
  if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: check.code === 'reason_required' ? 400 : 409 });
  if (check.alreadyDone) return NextResponse.json(booking);
  if (!reason) return NextResponse.json({ error: 'Give a reason; it is kept in the booking history.' }, { status: 400 });

  // Phase 4 delivery on this order: read before anything changes, fail closed.
  let deliveryPlan: DeliveryCancellationPlan | null = null;
  if (to === 'cancelled') {
    try {
      deliveryPlan = await deliveryCancellationPlan(db, { bookingGroupId: booking.checkout_group_id, bookingId: id });
    } catch {
      return NextResponse.json({ error: 'Could not check the delivery records just now. Nothing was changed; try again.' }, { status: 503 });
    }
    // Staff rule: only a leg actually in motion blocks (absent on an older plan: the stricter rule).
    if (deliveryPlan.inMotion ?? deliveryPlan.tooLate) {
      return NextResponse.json(
        { error: 'A delivery leg on this order is on its way right now. Close it in the delivery console first, then cancel the booking.', code: 'DELIVERY_UNDER_WAY' },
        { status: 409 },
      );
    }
  }

  const paidOnProvider = Boolean(booking.payfast_payment_id) && !isManualReference(booking.payfast_payment_id as string);
  const refunds: unknown[] = [];
  const journals: unknown[] = [];
  const notices = [];
  if (to === 'cancelled' && booking.payfast_payment_id) {
    const refundCents = Number(body.refundCents);
    if (!Number.isSafeInteger(refundCents) || refundCents < 0) {
      return NextResponse.json({ error: 'This booking is paid. Enter the refund amount in cents (0 if nothing is refunded).', code: 'REFUND_AMOUNT_REQUIRED' }, { status: 400 });
    }
    if (paidOnProvider) {
      // Release what this line held in the ledger, refund or not: the refund
      // becomes refunds_payable (deposit first), the rest a cancellation fee.
      let held: Awaited<ReturnType<typeof heldForStaffCancel>>;
      try {
        // Phase 4: the delivery fee is not this line's to release (its legs settle it once).
        held = await heldForStaffCancel(db, booking, deliveryPlan?.phase4 ?? false);
      } catch {
        return NextResponse.json({ error: 'Could not check what this booking holds just now. Nothing was changed; try again.' }, { status: 503 });
      }
      if (held && refundCents > held.hireCents + held.depositCents) {
        return NextResponse.json({ error: 'The refund is more than this booking holds.', code: 'REFUND_TOO_LARGE' }, { status: 400 });
      }
      if (held && held.hireCents + held.depositCents > 0) {
        const split = disputeMoney({ resolution: 'partial_refund', hireCents: held.hireCents, depositCents: held.depositCents, partialRefundCents: refundCents });
        journals.push(personSettlement({
          key: `staff-cancel:${id}`,
          bookingGroupId: booking.checkout_group_id as string,
          hireCents: held.hireCents,
          depositCents: held.depositCents,
          hireRefundCents: split.hireRefundCents,
          depositRefundCents: split.depositRefundCents,
          keptHireAs: 'cancelled',
          ownership: 'studio',
          ownerShareCents: 0,
          platformShareCents: 0,
        }));
      }
      if (refundCents > 0) {
        // The cap is the real charge for the order (the paid intent, or for an
        // order from before 070 its recorded payments) less what is already
        // owed back, never the refund amount itself.
        let charge: { totalCents: number; remainderCents: number };
        try {
          charge = await chargeOfBooking(db, booking);
        } catch {
          return NextResponse.json({ error: 'Could not check the payment just now. Nothing was changed; try again.' }, { status: 503 });
        }
        if (refundCents > charge.remainderCents) {
          return NextResponse.json({ error: `The refund is more than is left of the charge (R${(charge.remainderCents / 100).toFixed(2)}).`, code: 'REFUND_TOO_LARGE' }, { status: 400 });
        }
        const chargedCents = charge.totalCents;
        refunds.push({
          obligationKey: refundObligationKey('manual', `staff-cancel:${id}`),
          reason: 'manual',
          amountCents: refundCents,
          chargedCents: Math.max(chargedCents, refundCents),
          transactionReference: booking.payfast_payment_id,
          userId: booking.user_id,
          bookingGroupId: booking.checkout_group_id,
          bookingIds: [id],
          evidence: { reason, by: auth.user.id },
          // No journal on completion for an order the ledger never held.
          ledgered: Boolean(held),
        });
      }
    } else if (refundCents > 0) {
      notices.push(...buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [id], discriminator: `manual-refund:${id}`, data: { what: 'manual_refund_due', reference: id } }));
    }
  }

  const moved = await transitionBookings(db, {
    ids: [id],
    from: [booking.status],
    to,
    actor: 'staff',
    actorId: auth.user.id,
    reason,
    patch: to === 'cancelled' ? { cancel_reason: 'staff', cancellation_refund_status: refunds.length || notices.length ? 'pending' : 'not_required' } : {},
    journals,
    refunds,
    notices,
  });

  if (moved.result === 'missing_pipeline') {
    // Migration 070 not applied: a guarded single update (no refunds are automated here).
    const { data, error } = await db
      .from('equipment_bookings')
      .update({ status: to, updated_at: new Date().toISOString(), ...(to === 'cancelled' ? { cancelled_at: new Date().toISOString() } : {}) })
      .eq('id', id)
      .eq('status', booking.status)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'The booking changed; reload and try again.' }, { status: 409 });
    return NextResponse.json(data);
  }
  if (moved.result === 'conflict') return NextResponse.json({ error: 'The booking changed; reload and try again.' }, { status: 409 });

  // The order's last line went: its delivery legs (and any unused paid quote) go too, refunded once.
  // Read again AFTER the commit: a concurrent cancellation of the order's other line may have
  // made this the last one (finding 6); settling is idempotent per leg and quote.
  let deliveryRefundCents = 0;
  let keptLegs = 0;
  if (deliveryPlan) {
    keptLegs = deliveryPlan.keptShipmentIds?.length ?? 0;
    deliveryRefundCents = await settleAfterLineCancelled(
      db,
      {
        before: deliveryPlan,
        bookingGroupId: booking.checkout_group_id,
        bookingId: id,
        caller: { kind: 'staff', userId: auth.user.id },
        reason: `booking cancelled by staff: ${reason}`,
        refundKeptLegs: body.refundDeliveryFee === true,
      },
      deliveryCancellationPlan,
    );
  }
  logEvent({
    eventType: 'admin_booking_transition',
    eventCategory: 'admin',
    userId: auth.user.id,
    metadata: { bookingId: id, from: booking.status, to, deliveryRefundCents, deliveryLegsLeft: keptLegs, deliveryFeeRefundAsked: body.refundDeliveryFee === true },
  });
  await dispatchOutbox(10).catch(() => undefined);
  const { data: updated, error } = await db.from('equipment_bookings').select().eq('id', id).maybeSingle();
  if (error && !isMissingPipeline(error)) return NextResponse.json({ error: 'Updated, but could not reload the booking.' }, { status: 200 });
  return NextResponse.json(updated);
}

