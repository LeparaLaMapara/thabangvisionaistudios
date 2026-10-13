export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { notifyClient } from '@/lib/bookings/notify-client';
import { approvalText, decideServiceTransition } from '@/lib/core/services/fulfilment';
import { recordServiceBookingEvent, updateServiceBooking } from '@/lib/supabase/queries/service-bookings';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

/**
 * PATCH /api/service-bookings/[id]/deliver
 * Creator submits delivery URL and optional message.
 * Transitions booking from 'accepted' → 'delivered'.
 */
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

  if (!(await checkRateLimit(`deliver:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { delivery_url?: unknown; delivery_message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const deliveryUrl = typeof body.delivery_url === 'string' ? body.delivery_url.trim() : '';
  const deliveryMessage = typeof body.delivery_message === 'string' ? body.delivery_message : null;

  if (!deliveryUrl) {
    return NextResponse.json({ error: 'Delivery URL is required' }, { status: 400 });
  }

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, creator_id, client_id, status, payment_status, paystack_reference, total, created_at, shoot_date, delivered_at')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.creator_id !== user.id || booking.client_id === user.id) {
    return NextResponse.json({ error: 'Only the assigned creator can deliver' }, { status: 403 });
  }

  // The rules (lib/core/services/fulfilment.ts): creator, from 'accepted', with a real link.
  const now = new Date();
  const decision = decideServiceTransition({
    action: 'deliver',
    actor: 'creator',
    booking: {
      status: booking.status,
      paymentStatus: booking.payment_status,
      paymentReference: booking.paystack_reference,
      total: Number(booking.total ?? 0),
      createdAt: booking.created_at,
      shootDate: booking.shoot_date,
      deliveredAt: booking.delivered_at,
      revisionsIncluded: null,
      revisionsUsed: null,
    },
    now,
    delivery: { url: deliveryUrl, message: deliveryMessage },
  });
  if (!decision.ok) {
    const message = decision.code === 'wrong_status' ? 'Can only deliver accepted bookings' : decision.code === 'delivery_required' ? 'Invalid delivery URL format' : decision.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const result = await updateServiceBooking(admin(), id, decision.from, {
    ...decision.patch,
    status: decision.to,
    updated_at: now.toISOString(),
  });

  if (!result.ok) {
    console.error('[deliver] Update error:', result.error);
    return NextResponse.json({ error: 'Failed to submit delivery' }, { status: 500 });
  }
  if (!result.updated) {
    return NextResponse.json({ error: 'This booking was changed by someone else. Refresh and try again.' }, { status: 409 });
  }

  await recordServiceBookingEvent(admin(), {
    bookingId: id, event: 'deliver', from: decision.from, to: decision.to, actor: 'creator', actorId: user.id, reason: null,
  });

  // The client has a fixed time to respond, so they must hear about it.
  await notifyClient({
    bookingId: id,
    type: 'work_delivered',
    title: 'Your photos or video are ready',
    body: `Your creator has delivered the work. Open your booking to see it. ${approvalText()}`,
  });

  return NextResponse.json({ success: true });
}
