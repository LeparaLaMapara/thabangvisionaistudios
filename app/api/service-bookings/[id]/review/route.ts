export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// ─── POST — Submit a rating/review for a completed booking ───────────────────

export async function POST(
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

  const body = await request.json();
  const { rating, review } = body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 });
  }

  // Fetch booking — client only
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, client_id, status, client_rating')
    .eq('id', id)
    .single();

  if (fetchError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.client_id !== user.id) {
    return NextResponse.json({ error: 'Only the client can review' }, { status: 403 });
  }

  if (!['completed', 'paid_out'].includes(booking.status)) {
    return NextResponse.json({ error: 'Can only review completed bookings' }, { status: 400 });
  }

  if (booking.client_rating) {
    return NextResponse.json({ error: 'Already reviewed' }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      client_rating: rating,
      client_review: review || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
