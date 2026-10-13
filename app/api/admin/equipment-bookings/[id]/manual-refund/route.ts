export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isManualReference } from '@/lib/payments/routing';
import { logEvent } from '@/lib/data/events';

/**
 * POST — staff record that a refund owed by hand was paid back.
 *
 * A cancelled booking that was paid by EFT or cash keeps its refund on the
 * booking (cancellation_refund_amount, status 'pending') until a person pays
 * it back from the bank and says so here, with the bank reference. Only that
 * kind of refund is closed here: a card refund belongs to the payment
 * provider and is settled in Rental ops.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { reference?: unknown } | null;
  const reference = typeof body?.reference === 'string' ? body.reference.trim().slice(0, 120) : '';
  if (!reference) {
    return NextResponse.json({ error: 'Give the bank reference of the refund you paid.' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: booking } = await db
    .from('equipment_bookings')
    .select('id, status, payfast_payment_id, cancellation_refund_status, cancellation_refund_amount')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });

  if (booking.status !== 'cancelled' || booking.cancellation_refund_status !== 'pending') {
    return NextResponse.json({ error: 'This booking has no refund waiting to be paid back.' }, { status: 409 });
  }
  if (!booking.payfast_payment_id || !isManualReference(String(booking.payfast_payment_id))) {
    return NextResponse.json(
      { error: 'This refund goes back through the payment provider. Settle it in Payouts and refunds.', code: 'PROVIDER_REFUND' },
      { status: 409 },
    );
  }

  // Compare-and-set: two people pressing at once record it once.
  const now = new Date().toISOString();
  const { data: done, error } = await db
    .from('equipment_bookings')
    .update({ cancellation_refund_status: 'refunded', cancellation_refunded_at: now, cancellation_refund_error: null, updated_at: now })
    .eq('id', id)
    .eq('status', 'cancelled')
    .eq('cancellation_refund_status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[admin/manual-refund] update failed:', error.message);
    return NextResponse.json({ error: 'Could not record it. Nothing was changed; try again.' }, { status: 500 });
  }
  if (!done) return NextResponse.json({ error: 'Someone else changed this booking; reload it.' }, { status: 409 });

  logEvent({
    eventType: 'rental_manual_refund_paid',
    eventCategory: 'admin',
    userId: auth.user.id,
    metadata: { bookingId: id, amount: booking.cancellation_refund_amount, reference },
  });

  return NextResponse.json({ ok: true });
}
