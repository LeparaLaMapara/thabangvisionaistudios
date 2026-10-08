export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isManualReference, refundPayment } from '@/lib/payments/routing';
import { paidOnlineForLine } from '@/lib/rental/cancellation';
import { depositSettlement, lateFeeFor } from '@/lib/rental/late-fee';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { logEvent } from '@/lib/data/events';
import { RENTAL_POLICY } from '@/lib/constants';
import { fromCents, toCents } from '@/lib/core/pricing/money';
import { planDepositRefund, refundObligationKey } from '@/lib/core/rental/refunds';
import { chargeOfBooking } from '@/lib/rental/charges';
import { deliveryEarned, depositSettled, hireEarned } from '@/lib/core/rental/ledger';
import { payoutReference } from '@/lib/core/rental/payouts';
import { buildNotices } from '@/lib/core/rental/notifications';
import { submitRefund } from '@/lib/core/rental/use-cases';
import { systemClock } from '@/lib/core/ports';
import { paymentPort } from '@/lib/payments/ports';
import { SupabaseRefunds, isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { dispatchOutbox } from '@/lib/rental/notify';

/**
 * Taking gear back at the counter (the last step of the gear loop): record the
 * condition, work out the late fee, keep what damage costs, and give the rest
 * of the deposit back the way it was paid. Replaces the old review step, which
 * waited for a status nothing ever set.
 */

const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
const OUT = ['active', 'overdue', 'return_pending'];

type Row = {
  id: string; user_id: string; status: string; end_date: string; quantity: number | null;
  deposit_amount: number | null; total_price: number | null; payment_plan: string | null;
  checkout_group_id: string | null; payfast_payment_id: string | null; notes: string | null;
  balance_due: number | null; delivery_fee: number | null;
};

async function load(id: string): Promise<Row | null> {
  const { data } = await createAdminClient()
    .from('equipment_bookings')
    .select('id, user_id, status, end_date, quantity, deposit_amount, total_price, payment_plan, checkout_group_id, payfast_payment_id, notes, balance_due, delivery_fee')
    .eq('id', id)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Whether the deposit went through a payment provider, so it can go back to the card. */
function depositOnCard(b: Row): boolean {
  if (!b.payfast_payment_id || isManualReference(b.payfast_payment_id)) return false;
  return paidOnlineForLine({
    totalPrice: Number(b.total_price ?? 0),
    depositAmount: Number(b.deposit_amount ?? 0),
    paymentPlan: b.payment_plan,
    checkoutGroupId: b.checkout_group_id,
  }).deposit > 0;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const b = await load(id);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const deposit = Number(b.deposit_amount ?? 0);
  const late = lateFeeFor({ endDate: b.end_date, returnedAt: new Date(), quantity: b.quantity, deposit });
  const [notice] = await loadNoticeBookings([id]);
  const { data: serialRow } = await createAdminClient().from('equipment_bookings').select('smart_rentals(serial_number)').eq('id', id).maybeSingle();
  const serialRental = serialRow ? ((Array.isArray(serialRow.smart_rentals) ? serialRow.smart_rentals[0] : serialRow.smart_rentals) as { serial_number?: string | null } | null) : null;
  return NextResponse.json({
    has_serial: Boolean(serialRental?.serial_number?.trim()),
    id: b.id, status: b.status, title: notice?.title ?? 'Equipment', end_date: b.end_date, quantity: b.quantity ?? 1,
    deposit, late_fee: late.fee, days_late: late.daysLate, deposit_on_card: depositOnCard(b),
  });
}

interface TakeBackBody {
  condition?: string;
  photos?: string[];
  damageFee?: number;
  note?: string;
  refundMethod?: 'card' | 'eft' | 'cash';
  dispute?: boolean;
  serialsConfirmed?: boolean;
  accessoriesReturned?: string[];
  missingComponents?: string[];
  functionalCheck?: 'working' | 'faulty' | 'not_tested';
  receivedBy?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as TakeBackBody;
  if (!body.condition || !CONDITIONS.includes(body.condition as (typeof CONDITIONS)[number])) {
    return NextResponse.json({ error: 'Choose the condition it came back in.' }, { status: 400 });
  }
  const photos = (body.photos ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://'));
  if (photos.length === 0) return NextResponse.json({ error: 'Take at least one photo of the returned gear.' }, { status: 400 });
  const damageFee = Math.max(0, Number(body.damageFee ?? 0) || 0);
  const note = (body.note ?? '').trim().slice(0, 2000);
  if (damageFee > 0 && !note) {
    return NextResponse.json({ error: 'Say what the damage charge is for; the renter sees it.' }, { status: 400 });
  }
  const list = (xs: unknown): string[] =>
    Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 30) : [];
  const missing = list(body.missingComponents);

  const b = await load(id);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (!OUT.includes(b.status)) {
    return NextResponse.json({ error: `This booking is ${b.status}; only gear that is out can be taken back.` }, { status: 409 });
  }

  const db = createAdminClient();
  const { data: serialRow } = await db.from('equipment_bookings').select('smart_rentals(serial_number)').eq('id', id).maybeSingle();
  const serialRental = serialRow ? ((Array.isArray(serialRow.smart_rentals) ? serialRow.smart_rentals[0] : serialRow.smart_rentals) as { serial_number?: string | null } | null) : null;
  const hasSerial = Boolean(serialRental?.serial_number?.trim());
  const pipeline = await db
    .from('equipment_bookings')
    .select('hire_cents, deposit_cents, owner_share_cents, platform_share_cents, ownership, owner_id')
    .eq('id', id)
    .maybeSingle();
  if (pipeline.error && isMissingPipeline(pipeline.error)) return legacyTakeBack(id, auth.user.id, body);
  const snap = (pipeline.data ?? {}) as {
    hire_cents?: number | null; deposit_cents?: number | null; owner_share_cents?: number | null;
    platform_share_cents?: number | null; ownership?: string | null; owner_id?: string | null;
  };

  const now = new Date();
  const iso = now.toISOString();
  const depositRands = Number(b.deposit_amount ?? 0);
  const depositCents = snap.deposit_cents ?? toCents(depositRands);
  const late = lateFeeFor({ endDate: b.end_date, returnedAt: now, quantity: b.quantity, deposit: depositRands });
  const lateFeeCents = toCents(late.fee);
  const damageCents = Math.min(toCents(damageFee), depositCents);

  const outcome: 'clean' | 'damage' | 'missing_parts' | 'late' =
    missing.length > 0 ? 'missing_parts' : damageCents > 0 || body.functionalCheck === 'faulty' ? 'damage' : lateFeeCents > 0 ? 'late' : 'clean';
  const evidence = {
    received_by: auth.user.id,
    received_name: typeof body.receivedBy === 'string' ? body.receivedBy.trim().slice(0, 120) : null,
    serials_confirmed: body.serialsConfirmed === true,
    accessories_returned: list(body.accessoriesReturned),
    missing_components: missing,
    functional_check: body.functionalCheck ?? 'not_tested',
    days_late: late.daysLate,
    photos,
    at: iso,
  };

  const returnPatch = { condition_at_return: body.condition, return_photos: photos, return_notes: note || null, returned_at: iso, return_evidence: evidence, late_fee: late.fee };

  // Step 1: the gear is back. Recorded whatever happens next, so the unit is
  // accounted for even if settlement needs a person.
  // (A booking already in return_pending, e.g. from the old self-reported
  // return, goes straight to inspection: the move below reports `already`.)
  const back = await transitionBookings(db, {
    ids: [id],
    from: b.status === 'return_pending' ? ['return_pending'] : ['active', 'overdue'],
    to: 'return_pending',
    actor: 'staff',
    actorId: auth.user.id,
    reason: 'returned at the counter',
    patch: returnPatch,
    notices: buildNotices({ kind: 'return_recorded', userId: b.user_id, bookingIds: [id], discriminator: id }),
  });
  if (back.result === 'missing_pipeline') return legacyTakeBack(id, auth.user.id, body);
  if (back.result === 'conflict') return NextResponse.json({ error: 'The booking changed while you were working. Reload and try again.' }, { status: 409 });

  // Step 2a: disputed return. Nothing is settled, the gear stays off sale (T24).
  // A registered serial that cannot be confirmed means it may not be our unit.
  if (body.dispute || (hasSerial && !evidence.serials_confirmed)) {
    const reason = body.dispute ? note || 'Opened at return' : 'Serial number not confirmed at return';
    const d = await transitionBookings(db, {
      ids: [id], from: ['return_pending'], to: 'disputed', actor: 'staff', actorId: auth.user.id, reason,
      patch: { ...returnPatch, dispute_reason: reason, disputed_at: iso, inspection_outcome: outcome },
      notices: buildNotices({ kind: 'dispute_opened', userId: b.user_id, bookingIds: [id], discriminator: id }),
    });
    if (d.result === 'conflict') return NextResponse.json({ error: 'The booking changed while you were working. Reload and try again.' }, { status: 409 });
    logEvent({ eventType: 'return_disputed', eventCategory: 'booking', userId: b.user_id, metadata: { bookingId: id } });
    await dispatchOutbox(10).catch(() => undefined);
    return NextResponse.json({ ok: true, disputed: true, late_fee: late.fee });
  }

  // Step 2b: settle the deposit under the documented rules (no evidence, no deduction).
  const onCard = depositOnCard(b);
  const charge = onCard ? await chargeOfBooking(db, b) : { totalCents: depositCents, remainderCents: depositCents };
  const plan = planDepositRefund({
    depositCents,
    inspection: outcome === 'late' ? 'clean' : outcome,
    disputed: false,
    damageCents,
    damageEvidenceCount: damageCents > 0 ? photos.length + (note ? 1 : 0) : 0,
    lateFeeCents: Math.min(lateFeeCents, depositCents - damageCents),
    refundableRemainderCents: charge.remainderCents,
  });
  if (!plan.ok) return NextResponse.json({ error: plan.message, code: plan.code }, { status: 400 });

  let refundMethod: string = 'none';
  const refunds: unknown[] = [];
  if (plan.refundCents > 0) {
    if (onCard) {
      refundMethod = 'card';
      refunds.push({
        obligationKey: refundObligationKey('deposit_settlement', id),
        reason: 'deposit_settlement',
        amountCents: plan.refundCents,
        chargedCents: charge.totalCents,
        transactionReference: b.payfast_payment_id,
        userId: b.user_id,
        bookingGroupId: b.checkout_group_id,
        bookingIds: [id],
        evidence: { damage_cents: plan.damageCents, late_fee_cents: plan.lateFeeCents, photos: photos.length },
      });
    } else if (body.refundMethod === 'eft' || body.refundMethod === 'cash') {
      refundMethod = body.refundMethod;
    } else {
      return NextResponse.json({ error: 'The deposit was not paid by card here. Choose EFT or cash for paying it back.' }, { status: 400 });
    }
  }

  // Ledger only for orders paid through the provider (manual payments are outside it).
  // A deposit-only order (no longer offered) paid its hire at the counter with
  // no recorded payment: the hire is outside the ledger, and the owner's share
  // is not scheduled automatically. A person settles it.
  const hireUnrecorded = b.payment_plan === 'deposit_only' && Number(b.balance_due ?? 0) > 0;
  const journals: unknown[] = [];
  const groupId = b.checkout_group_id ?? id;
  if (onCard && snap.hire_cents != null && !hireUnrecorded) {
    const community = snap.ownership === 'community' && snap.owner_id && snap.owner_share_cents != null && snap.platform_share_cents != null;
    // A journal needs money in it: a zero hire has nothing to recognise.
    if (snap.hire_cents > 0) {
      journals.push(hireEarned({
        bookingId: id,
        bookingGroupId: groupId,
        hireCents: snap.hire_cents,
        ownership: community ? 'community' : 'studio',
        ownerShareCents: community ? (snap.owner_share_cents as number) : 0,
        platformShareCents: community ? (snap.platform_share_cents as number) : 0,
      }));
    }
    // The order's delivery fee is stored on one line (whichever line that is,
    // even a cancelled one). It is earned once per order, when the first line
    // completes; the journal key makes a second completion a no-op.
    const deliveryCents = await groupDeliveryCents(db, b);
    if (deliveryCents > 0) journals.push(deliveryEarned({ bookingGroupId: groupId, deliveryCents }));
  }
  if (onCard && depositCents > 0) {
    journals.push(depositSettled({ bookingId: id, bookingGroupId: groupId, depositCents, damageCents: plan.damageCents, lateFeeCents: plan.lateFeeCents }));
  }

  // Owner payout for community gear, 48h after a clean completion (spec §7.8).
  const payouts: unknown[] = [];
  const notices = buildNotices({ kind: 'inspection_completed', userId: b.user_id, bookingIds: [id], discriminator: id, data: { amountCents: plan.refundCents } });
  if (hireUnrecorded && snap.ownership === 'community' && snap.owner_id) {
    notices.push(...buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [id], discriminator: `deposit-only-payout:${id}`, data: { what: 'owner_payout_needs_manual_check_balance_paid_at_counter', reference: id } }));
  } else if (snap.ownership === 'community' && snap.owner_id && (snap.owner_share_cents ?? 0) > 0 && snap.hire_cents != null) {
    payouts.push({
      bookingId: id,
      ownerId: snap.owner_id,
      bookingGroupId: groupId,
      grossCents: snap.hire_cents,
      platformCents: snap.platform_share_cents,
      ownerCents: snap.owner_share_cents,
      transferReference: payoutReference(id),
      scheduledAt: new Date(now.getTime() + RENTAL_POLICY.ownerPayoutDelayHours * 3_600_000).toISOString(),
    });
    notices.push(...buildNotices({ kind: 'payout_scheduled', userId: snap.owner_id, bookingIds: [id], discriminator: id, data: { amountCents: snap.owner_share_cents ?? 0 } }));
  }

  const done = await transitionBookings(db, {
    ids: [id],
    from: ['return_pending'],
    to: 'completed',
    actor: 'staff',
    actorId: auth.user.id,
    reason: `inspection: ${outcome}`,
    patch: {
      ...returnPatch,
      inspection_outcome: outcome,
      damage_fee: fromCents(plan.damageCents),
      deposit_released: fromCents(plan.refundCents),
      deposit_released_at: plan.refundCents > 0 && refundMethod !== 'card' ? iso : null,
      deposit_refund_method: refundMethod,
      return_reviewed_by: auth.user.id,
      return_reviewed_at: iso,
    },
    journals,
    refunds,
    payouts,
    notices,
  });
  if (done.result === 'conflict') return NextResponse.json({ error: 'The booking changed while you were working. Reload and try again.' }, { status: 409 });

  // Submit the card refund now; if the provider is slow or down, the daily
  // pipeline reconciles and retries it (never twice, T13).
  let refundStatus: string | null = null;
  if (refundMethod === 'card') {
    const { data: ob } = await db.from('refund_obligations').select('id').eq('obligation_key', refundObligationKey('deposit_settlement', id)).maybeSingle();
    if (ob) refundStatus = await submitRefund((ob as { id: string }).id, { refunds: new SupabaseRefunds(db), payments: paymentPort, clock: systemClock }).catch(() => 'unknown_outcome');
  }
  await dispatchOutbox(10).catch(() => undefined);

  logEvent({ eventType: 'gear_returned', eventCategory: 'booking', userId: b.user_id, metadata: { bookingId: id, outcome, lateFeeCents: plan.lateFeeCents, damageCents: plan.damageCents, refundCents: plan.refundCents, refundMethod, refundStatus } });
  return NextResponse.json({
    ok: true,
    outcome,
    late_fee: fromCents(plan.lateFeeCents),
    kept: fromCents(plan.keptCents),
    released: fromCents(plan.refundCents),
    refund_method: refundMethod,
    refund_status: refundStatus,
  });
}

/** The delivery fee charged for this booking's order (stored on one of its lines). */
async function groupDeliveryCents(db: ReturnType<typeof createAdminClient>, b: Row): Promise<number> {
  if (!b.checkout_group_id) return toCents(Number(b.delivery_fee ?? 0));
  const { data } = await db.from('equipment_bookings').select('delivery_fee').eq('checkout_group_id', b.checkout_group_id);
  return ((data ?? []) as { delivery_fee: number | null }[]).reduce((sum, r) => sum + toCents(Number(r.delivery_fee ?? 0)), 0);
}

/** The pre-070 take-back, used only while migration 070 is not applied. */
async function legacyTakeBack(id: string, adminId: string, body: TakeBackBody): Promise<NextResponse> {
  if (!body.condition || !CONDITIONS.includes(body.condition as (typeof CONDITIONS)[number])) {
    return NextResponse.json({ error: 'Choose the condition it came back in.' }, { status: 400 });
  }
  const photos = (body.photos ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://'));
  if (photos.length === 0) return NextResponse.json({ error: 'Take at least one photo of the returned gear.' }, { status: 400 });
  const damageFee = Math.max(0, Number(body.damageFee ?? 0) || 0);
  if (damageFee > 0 && !(body.note ?? '').trim()) {
    return NextResponse.json({ error: 'Say what the damage charge is for; the renter sees it.' }, { status: 400 });
  }

  const b = await load(id);
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (!OUT.includes(b.status)) {
    return NextResponse.json({ error: `This booking is ${b.status}; only gear that is out can be taken back.` }, { status: 409 });
  }

  const now = new Date();
  const deposit = Number(b.deposit_amount ?? 0);
  const late = lateFeeFor({ endDate: b.end_date, returnedAt: now, quantity: b.quantity, deposit });
  const { release, kept } = depositSettlement({ deposit, lateFee: late.fee, damageFee });

  let refundMethod: string = 'none';
  if (!body.dispute && release > 0) {
    if (depositOnCard(b)) {
      const r = await refundPayment(b.payfast_payment_id!, release);
      if (!r.success) {
        return NextResponse.json({ error: `The card refund did not go through (${r.error}). Choose EFT or cash and pay it back by hand.`, card_failed: true }, { status: 502 });
      }
      refundMethod = 'card';
    } else if (body.refundMethod === 'eft' || body.refundMethod === 'cash') {
      refundMethod = body.refundMethod;
    } else {
      return NextResponse.json({ error: 'The deposit was not paid by card here. Choose EFT or cash for paying it back.' }, { status: 400 });
    }
  }

  const note = (body.note ?? '').trim();
  const iso = now.toISOString();
  const { error } = await createAdminClient()
    .from('equipment_bookings')
    .update({
      status: body.dispute ? 'disputed' : 'completed',
      condition_at_return: body.condition,
      return_photos: photos,
      return_notes: note || null,
      returned_at: iso,
      late_fee: late.fee,
      damage_fee: Math.min(damageFee, deposit),
      deposit_released: body.dispute ? 0 : release,
      deposit_released_at: !body.dispute && release > 0 ? iso : null,
      deposit_refund_method: body.dispute ? null : refundMethod,
      return_reviewed_by: adminId,
      return_reviewed_at: iso,
      ...(body.dispute ? { dispute_reason: note || 'Opened at return', disputed_at: iso } : {}),
      updated_at: iso,
    })
    .eq('id', id)
    .in('status', OUT);
  if (error) return NextResponse.json({ error: 'Could not record the return.' }, { status: 500 });

  logEvent({ eventType: body.dispute ? 'return_disputed' : 'gear_returned', eventCategory: 'booking', userId: b.user_id, metadata: { bookingId: id, lateFee: late.fee, damageFee, release, refundMethod } });
  if (!body.dispute) {
    await sendGearNotice('settled', await loadNoticeBookings([id]), { depositBack: release, refundMethod, kept });
  }
  return NextResponse.json({ ok: true, late_fee: late.fee, kept, released: body.dispute ? 0 : release, refund_method: refundMethod });
}
