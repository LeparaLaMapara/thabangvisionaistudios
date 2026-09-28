export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isManualReference, refundPayment } from '@/lib/payments/routing';
import { paidOnlineForLine } from '@/lib/rental/cancellation';
import { depositSettlement, lateFeeFor } from '@/lib/rental/late-fee';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { logEvent } from '@/lib/data/events';

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
};

async function load(id: string): Promise<Row | null> {
  const { data } = await createAdminClient()
    .from('equipment_bookings')
    .select('id, user_id, status, end_date, quantity, deposit_amount, total_price, payment_plan, checkout_group_id, payfast_payment_id, notes')
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
  return NextResponse.json({
    id: b.id, status: b.status, title: notice?.title ?? 'Equipment', end_date: b.end_date, quantity: b.quantity ?? 1,
    deposit, late_fee: late.fee, days_late: late.daysLate, deposit_on_card: depositOnCard(b),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    condition?: string; photos?: string[]; damageFee?: number; note?: string;
    refundMethod?: 'card' | 'eft' | 'cash'; dispute?: boolean;
  };
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
      return_reviewed_by: auth.user.id,
      return_reviewed_at: iso,
      ...(body.dispute ? { dispute_reason: note || 'Opened at return', disputed_at: iso } : {}),
      updated_at: iso,
    })
    .eq('id', id)
    .in('status', OUT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logEvent({ eventType: body.dispute ? 'return_disputed' : 'gear_returned', eventCategory: 'booking', userId: b.user_id, metadata: { bookingId: id, lateFee: late.fee, damageFee, release, refundMethod } });
  if (!body.dispute) {
    await sendGearNotice('settled', await loadNoticeBookings([id]), { depositBack: release, refundMethod, kept });
  }
  return NextResponse.json({ ok: true, late_fee: late.fee, kept, released: body.dispute ? 0 : release, refund_method: refundMethod });
}
