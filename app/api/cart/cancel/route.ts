export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { addToCart } from '@/lib/supabase/queries/cart';
import { isMissingPipeline } from '@/lib/rental/repos';
import { logEvent } from '@/lib/data/events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrderLine {
  id: string;
  rental_id: string;
  quantity: number | null;
  start_date: string;
  end_date: string;
  status: string;
  payfast_payment_id: string | null;
}

/**
 * POST /api/cart/cancel — the customer came back from the payment page
 * without paying ({ checkout_group_id }).
 *
 * The checkout empties the cart and holds the dates while the customer pays.
 * Here the unpaid hold is ended now instead of when it runs out, and the
 * items go back into the cart with their dates, so trying again does not
 * reserve the same gear twice or count it twice against the renter's limit.
 *
 * Ending the hold uses the Phase 1 rule for lapsed holds (hold_expires_at in
 * the past, on the lines and on the payment intent): the gear is free for
 * others at once, and a payment that still arrives for this order is treated
 * as a late payment, confirmed only if the gear is still free and the renter
 * still within their limit, otherwise refunded. Nothing is deleted.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await checkRateLimit(`cart-cancel:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { checkout_group_id?: unknown };
  const groupId = typeof body.checkout_group_id === 'string' ? body.checkout_group_id : '';
  if (!UUID.test(groupId)) return NextResponse.json({ error: 'Unknown order.' }, { status: 400 });

  const admin = createAdminClient();
  const loadLines = async (): Promise<OrderLine[] | null> => {
    const { data, error } = await admin
      .from('equipment_bookings')
      .select('id, rental_id, quantity, start_date, end_date, status, payfast_payment_id')
      .eq('checkout_group_id', groupId)
      .eq('user_id', user.id);
    return error ? null : ((data ?? []) as OrderLine[]);
  };

  const lines = await loadLines();
  if (lines === null) return NextResponse.json({ error: 'Could not load your order just now. Please try again.' }, { status: 503 });
  if (lines.length === 0) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const paid = (rows: OrderLine[]): boolean =>
    rows.some((l) => l.payfast_payment_id || !['pending', 'cancelled'].includes(l.status));
  if (paid(lines)) {
    return NextResponse.json(
      { released: false, code: 'ALREADY_PAID', booking_id: lines[0].id, error: 'This order is already paid or confirmed.' },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  // The payment intent first: from here a payment for this order is "late".
  const intentRes = await admin
    .from('rental_payment_intents')
    .update({ hold_expires_at: nowIso, updated_at: nowIso })
    .eq('checkout_group_id', groupId)
    .in('state', ['initiated', 'failed']);
  if (intentRes.error && !isMissingPipeline(intentRes.error)) {
    console.error('[cart/cancel] could not end the payment hold:', intentRes.error.message);
    return NextResponse.json({ error: 'Could not release your dates just now. Please try again.' }, { status: 503 });
  }
  const linesRes = await admin
    .from('equipment_bookings')
    .update({ hold_expires_at: nowIso, updated_at: nowIso })
    .eq('checkout_group_id', groupId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .is('payfast_payment_id', null);
  if (intentRes.error || linesRes.error) {
    if (isMissingPipeline(linesRes.error) || isMissingPipeline(intentRes.error)) {
      // Before migration 070 a hold cannot be ended early. The booking stays
      // pending (and can be cancelled from its page); the cart is not refilled,
      // so the same gear is not reserved twice.
      return NextResponse.json({ released: false, code: 'HOLD_KEPT', booking_id: lines[0].id });
    }
    console.error('[cart/cancel] could not end the hold:', linesRes.error?.message);
    return NextResponse.json({ error: 'Could not release your dates just now. Please try again.' }, { status: 503 });
  }

  // A payment confirmed in the meantime wins: nothing goes back in the cart.
  const after = await loadLines();
  if (after === null) return NextResponse.json({ error: 'Could not load your order just now. Please try again.' }, { status: 503 });
  if (paid(after)) {
    return NextResponse.json(
      { released: false, code: 'ALREADY_PAID', booking_id: lines[0].id, error: 'This order is already paid or confirmed.' },
      { status: 409 },
    );
  }

  let restored = 0;
  for (const line of after) {
    const item = await addToCart(user.id, line.rental_id, Math.max(1, line.quantity ?? 1), line.start_date, line.end_date);
    if (item) restored += 1;
  }

  logEvent({ eventType: 'checkout_payment_cancelled', eventCategory: 'booking', userId: user.id, metadata: { checkoutGroupId: groupId, items: after.length, restored } });
  return NextResponse.json({ released: true, restored, items: after.length });
}
