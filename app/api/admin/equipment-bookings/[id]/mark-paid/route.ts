export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { manualReference, recordConfirmation } from '@/lib/payments/routing';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { logEvent } from '@/lib/data/events';
import { trackFunnel } from '@/lib/analytics/funnel';
import { isMissingPipeline } from '@/lib/rental/repos';
import { afterRentalPayment } from '@/lib/delivery/after-payment';

/**
 * Record a payment taken by hand (EFT, cash, or a card link sent on WhatsApp)
 * and confirm the booking, or the whole cart order it belongs to. This is how
 * bookings are taken while online payment is off, and a safe fallback after.
 */
const METHODS = ['eft', 'cash', 'card_link'] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { method?: string; reference?: string; amount?: number };
  const method = METHODS.find((m) => m === body.method);
  if (!method) return NextResponse.json({ error: 'Choose how they paid: EFT, cash or card link.' }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Enter the amount received.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('equipment_bookings')
    .select('id, user_id, status, checkout_group_id, currency')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.status !== 'pending') {
    return NextResponse.json({ error: `This booking is ${booking.status}, not waiting for payment.` }, { status: 409 });
  }

  const reference = manualReference(method, body.reference ?? `${Date.now().toString(36)}`);
  const now = new Date().toISOString();

  // Confirm the whole order: a cart checkout is one payment for several lines.
  // Through the pipeline (070) this happens under the stock locks: a line whose
  // hold lapsed is confirmed only if its units are still free, so the gear is
  // never sold twice, and the move is recorded in the booking history.
  let ids: string[] = [];
  const { data: rpc, error: rpcErr } = await admin.rpc('confirm_manual_payment', { p_booking: id, p_reference: reference, p_actor: auth.user.id });
  if (rpcErr && !isMissingPipeline(rpcErr)) {
    console.error('[mark-paid] confirm failed:', rpcErr.message);
    return NextResponse.json({ error: 'Could not confirm the booking just now. Nothing was changed; try again.' }, { status: 503 });
  }
  if (!rpcErr) {
    const out = rpc as { result: string; booking_ids?: string[] };
    if (out.result === 'unavailable') {
      return NextResponse.json(
        { error: 'The hold on this booking lapsed and the gear has since been booked by someone else. Do not take the money; offer other dates, or refund it if already received.', code: 'NO_LONGER_AVAILABLE' },
        { status: 409 },
      );
    }
    if (out.result !== 'confirmed') return NextResponse.json({ error: 'Nothing was waiting for payment.' }, { status: 409 });
    ids = out.booking_ids ?? [];
  } else {
    // Migration 070 not applied yet: the earlier guarded update.
    let query = admin.from('equipment_bookings').update({ status: 'confirmed', payfast_payment_id: reference, updated_at: now }).eq('status', 'pending');
    query = booking.checkout_group_id ? query.eq('checkout_group_id', booking.checkout_group_id) : query.eq('id', id);
    const { data: confirmed, error } = await query.select('id');
    if (error) return NextResponse.json({ error: 'Could not confirm the booking just now.' }, { status: 500 });
    ids = (confirmed ?? []).map((r) => r.id);
  }
  if (ids.length === 0) return NextResponse.json({ error: 'Nothing was waiting for payment.' }, { status: 409 });

  await recordConfirmation({ provider: 'manual', reference, paymentId: booking.checkout_group_id ?? id, amount, status: 'COMPLETE', eventType: `manual.${method}` });
  // The booking is already confirmed, so a failed write cannot be undone by
  // retrying this route (nothing is pending any more): log it and tell staff.
  const { error: paymentRecordError } = await admin.from('booking_payments').insert({
    booking_id: id,
    payfast_payment_id: reference,
    amount,
    currency: booking.currency ?? 'ZAR',
    status: 'succeeded',
  });
  // 23505: this reference is already recorded for the booking.
  const paymentRecorded = !paymentRecordError || (paymentRecordError as { code?: string }).code === '23505';
  if (!paymentRecorded) {
    console.error('[admin/mark-paid] Booking confirmed but payment record not written:', id, paymentRecordError?.message);
  }

  logEvent({ eventType: 'payment_complete', eventCategory: 'payment', userId: auth.user.id, metadata: { provider: 'manual', method, bookings: ids, amount } });
  trackFunnel('payment_confirmed', { userId: (booking as { user_id?: string | null }).user_id ?? null, meta: { groupId: booking.checkout_group_id ?? id, source: 'manual', code: method } });
  await sendGearNotice('confirmed', await loadNoticeBookings(ids));
  // Phase 4: an order with delivery. A payment taken by hand is not verified
  // by the provider, so nothing is dispatched automatically; the hook tells
  // the ops queue that a person must arrange the delivery. Never fails this route.
  if (booking.checkout_group_id) await afterRentalPayment(booking.checkout_group_id, 'manual');

  return NextResponse.json({
    ok: true,
    confirmed: ids.length,
    reference,
    ...(paymentRecorded ? {} : { warning: 'The booking is confirmed, but the payment record was not saved. Record it by hand before any refund or payout.' }),
  });
}
