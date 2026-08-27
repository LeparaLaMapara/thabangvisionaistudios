export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';

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

  const body = await request.json();
  const { delivery_url, delivery_message } = body;

  if (!delivery_url || typeof delivery_url !== 'string' || delivery_url.trim().length === 0) {
    return NextResponse.json({ error: 'Delivery URL is required' }, { status: 400 });
  }

  // Validate URL format
  try {
    new URL(delivery_url);
  } catch {
    return NextResponse.json({ error: 'Invalid delivery URL format' }, { status: 400 });
  }

  // Fetch booking
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, creator_id, status')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.creator_id !== user.id) {
    return NextResponse.json({ error: 'Only the assigned creator can deliver' }, { status: 403 });
  }

  if (booking.status !== 'accepted') {
    return NextResponse.json({ error: 'Can only deliver accepted bookings' }, { status: 400 });
  }

  // Update booking with delivery info
  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      delivery_url: delivery_url.trim(),
      delivery_message: delivery_message?.trim() || null,
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateError) {
    console.error('[deliver] Update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to submit delivery' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
