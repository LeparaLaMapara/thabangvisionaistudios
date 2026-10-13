export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { MAX_REVIEW_CHARS, publicReviewerName, reviewComment, saveServiceBookingReview } from '@/lib/supabase/queries/creatorReviews';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

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

  if (!(await checkRateLimit(`review:${user.id}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const body = await request.json();
  const { rating, review } = body;

  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be a whole number from 1 to 5' }, { status: 400 });
  }

  const comment = reviewComment(review);
  if (comment === 'too_long') {
    return NextResponse.json({ error: `Keep the review under ${MAX_REVIEW_CHARS} characters` }, { status: 400 });
  }

  // Fetch booking — client only
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, client_id, creator_id, status, client_rating')
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

  const db = admin();

  // 1. The public review (what creator ratings read). Upsert on booking_id,
  //    so a retry after step 2 failed updates the same row.
  if (booking.creator_id) {
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) console.error('[service-bookings/review] profile read failed:', profileError.message);

    const saved = await saveServiceBookingReview(db, {
      bookingId: id,
      reviewerId: user.id,
      reviewerName: publicReviewerName((profile as { display_name?: string | null } | null)?.display_name),
      creatorId: booking.creator_id,
      rating,
      comment,
    });
    if (!saved.ok) {
      console.error('[service-bookings/review] review write failed:', saved.error);
      return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
    }
  }

  // 2. The booking's own copy (dashboards read it). Only while still unrated.
  const { error: updateError } = await db
    .from('bookings')
    .update({
      client_rating: rating,
      client_review: comment,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('client_rating', null);

  if (updateError) {
    console.error('[service-bookings/review] booking update failed:', updateError.message);
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
