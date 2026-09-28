export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { notifyClient } from '@/lib/bookings/notify-client';
import { startOfBookedDay } from '@/lib/rental/cancellation';
import { logEvent } from '@/lib/data/events';

/**
 * The creator taps "I'm here" on the shoot day (TASK-069). Recorded on the
 * booking, shown on both timelines, and the client is told.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await checkRateLimit(`arrived:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, creator_id, status, arrived_at, shoot_date, project_category')
    .eq('id', id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if (booking.creator_id !== user.id) {
    return NextResponse.json({ error: 'Only the booked creator can check in' }, { status: 403 });
  }
  if (booking.status !== 'accepted') {
    return NextResponse.json({ error: 'Check in once you have accepted the booking' }, { status: 400 });
  }
  if (booking.arrived_at) return NextResponse.json({ ok: true, arrived_at: booking.arrived_at });
  if (booking.shoot_date && Date.now() < startOfBookedDay(booking.shoot_date).getTime()) {
    return NextResponse.json({ error: 'You can check in on the shoot day.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from('bookings')
    .update({ arrived_at: now, updated_at: now })
    .eq('id', id)
    .eq('status', 'accepted')
    .is('arrived_at', null);
  if (error) return NextResponse.json({ error: 'Could not check in' }, { status: 500 });

  logEvent({ eventType: 'creator_arrived', eventCategory: 'booking', userId: user.id, metadata: { bookingId: id } });
  await notifyClient({
    bookingId: id,
    type: 'creator_arrived',
    title: 'Your creator has arrived',
    body: `Your ${booking.project_category} creator has checked in for your shoot.`,
  });
  return NextResponse.json({ ok: true, arrived_at: now });
}
