export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { checkTransition, isBookingStatus } from '@/lib/core/rental/state';
import { disputeMoney, refundObligationKey } from '@/lib/core/rental/refunds';
import { personSettlement } from '@/lib/core/rental/ledger';
import { toCents } from '@/lib/core/pricing/money';
import { buildNotices } from '@/lib/core/rental/notifications';
import { isManualReference } from '@/lib/payments/routing';
import { isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { dispatchOutbox } from '@/lib/rental/notify';
import { logEvent } from '@/lib/data/events';

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

  let body: { status?: string; reason?: string; refundCents?: number };
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
    .select('id, user_id, status, checkout_group_id, payfast_payment_id')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  if (booking.status === 'disputed' && to === 'completed') {
    // Closed through its dispute record. A booking disputed before records were
    // always created gets one now, so it can be settled there.
    const { data: open, error: findErr } = await db
      .from('disputes')
      .select('id')
      .eq('equipment_booking_id', id)
      .in('status', ['open', 'investigating', 'escalated'])
      .limit(1)
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: 'Could not load the dispute; try again.' }, { status: 503 });
    let disputeId = (open as { id: string } | null)?.id ?? null;
    if (!disputeId) {
      const { data: inserted } = await db
        .from('disputes')
        .insert({ dispute_type: 'gear_damage', equipment_booking_id: id, filed_by: auth.user.id, reason: reason || 'Disputed return to settle', status: 'open' })
        .select('id')
        .single();
      disputeId = (inserted as { id: string } | null)?.id ?? null;
    }
    return NextResponse.json(
      { error: NEEDS_OWN_SCREEN['disputed>completed'], code: 'USE_WORKFLOW', dispute_id: disputeId },
      { status: 409 },
    );
  }

  const ownScreen = NEEDS_OWN_SCREEN[`${booking.status}>${to}`];
  if (ownScreen) return NextResponse.json({ error: ownScreen, code: 'USE_WORKFLOW' }, { status: 409 });

  const check = checkTransition(booking.status, to, 'staff', reason || null);
  if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: check.code === 'reason_required' ? 400 : 409 });
  if (check.alreadyDone) return NextResponse.json(booking);
  if (!reason) return NextResponse.json({ error: 'Give a reason; it is kept in the booking history.' }, { status: 400 });

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
      let held: Awaited<ReturnType<typeof heldForLine>>;
      try {
        held = await heldForLine(db, booking);
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
        let chargedCents = refundCents;
        if (booking.checkout_group_id) {
          const { data: intent, error: intentErr } = await db.from('rental_payment_intents').select('expected_amount_cents, state').eq('checkout_group_id', booking.checkout_group_id).maybeSingle();
          if (intentErr) return NextResponse.json({ error: 'Could not check the payment just now. Nothing was changed; try again.' }, { status: 503 });
          if (intent && (intent as { state: string }).state === 'paid') chargedCents = (intent as { expected_amount_cents: number }).expected_amount_cents;
        }
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

  logEvent({ eventType: 'admin_booking_transition', eventCategory: 'admin', userId: auth.user.id, metadata: { bookingId: id, from: booking.status, to } });
  await dispatchOutbox(10).catch(() => undefined);
  const { data: updated, error } = await db.from('equipment_bookings').select().eq('id', id).maybeSingle();
  if (error && !isMissingPipeline(error)) return NextResponse.json({ error: 'Updated, but could not reload the booking.' }, { status: 200 });
  return NextResponse.json(updated);
}

/**
 * What this line holds in the ledger, for orders paid through the provider
 * (a paid payment intent): its hire and deposit, plus the order's delivery fee
 * when this is the last line still open and no line has earned it yet.
 * Null when the order is outside the ledger (manual payment, pre-070).
 */
async function heldForLine(
  db: ReturnType<typeof createAdminClient>,
  booking: { id: string; checkout_group_id: string | null },
): Promise<{ hireCents: number; depositCents: number } | null> {
  if (!booking.checkout_group_id) return null;
  const { data: intent, error: intentErr } = await db.from('rental_payment_intents').select('state').eq('checkout_group_id', booking.checkout_group_id).maybeSingle();
  // A failed lookup must not read as "outside the ledger" (no journal would be posted).
  if (intentErr) throw new Error(`heldForLine: intent lookup failed: ${intentErr.message}`);
  if ((intent as { state?: string } | null)?.state !== 'paid') return null;
  const { data: lines, error: linesErr } = await db
    .from('equipment_bookings')
    .select('id, status, hire_cents, deposit_cents, delivery_fee')
    .eq('checkout_group_id', booking.checkout_group_id);
  if (linesErr) throw new Error(`heldForLine: order lookup failed: ${linesErr.message}`);
  const rows = (lines ?? []) as { id: string; status: string; hire_cents: number | null; deposit_cents: number | null; delivery_fee: number | null }[];
  const me = rows.find((r) => r.id === booking.id);
  if (!me || me.hire_cents == null) return null;
  const othersOpen = rows.some((r) => r.id !== booking.id && r.status !== 'cancelled');
  const delivery = othersOpen ? 0 : rows.reduce((sum, r) => sum + toCents(Number(r.delivery_fee ?? 0)), 0);
  return { hireCents: me.hire_cents + delivery, depositCents: me.deposit_cents ?? 0 };
}
