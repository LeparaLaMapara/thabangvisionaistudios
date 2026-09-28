export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { manualReference, recordConfirmation } from '@/lib/payments/routing';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { logEvent } from '@/lib/data/events';

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
    .select('id, status, checkout_group_id, currency')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.status !== 'pending') {
    return NextResponse.json({ error: `This booking is ${booking.status}, not waiting for payment.` }, { status: 409 });
  }

  const reference = manualReference(method, body.reference ?? `${Date.now().toString(36)}`);
  const now = new Date().toISOString();

  // Confirm the whole order: a cart checkout is one payment for several lines.
  let query = admin.from('equipment_bookings').update({ status: 'confirmed', payfast_payment_id: reference, updated_at: now }).eq('status', 'pending');
  query = booking.checkout_group_id ? query.eq('checkout_group_id', booking.checkout_group_id) : query.eq('id', id);
  const { data: confirmed, error } = await query.select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (confirmed ?? []).map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ error: 'Nothing was waiting for payment.' }, { status: 409 });

  await recordConfirmation({ provider: 'manual', reference, paymentId: booking.checkout_group_id ?? id, amount, status: 'COMPLETE', eventType: `manual.${method}` });
  await admin.from('booking_payments').insert({
    booking_id: id,
    payfast_payment_id: reference,
    amount,
    currency: booking.currency ?? 'ZAR',
    status: 'succeeded',
  });

  logEvent({ eventType: 'payment_complete', eventCategory: 'payment', userId: auth.user.id, metadata: { provider: 'manual', method, bookings: ids, amount } });
  await sendGearNotice('confirmed', await loadNoticeBookings(ids));

  return NextResponse.json({ ok: true, confirmed: ids.length, reference });
}
