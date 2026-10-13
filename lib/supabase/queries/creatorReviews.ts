import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatorReview = {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  created_at: string;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns reviews where the given user is the reviewee.
 * The reviewer's name is the one stored on the review (reviews.reviewer_name);
 * for older rows without it, the reviewer's public profile name is used when
 * they have one. Since migration 077, public_profiles lists only creators and
 * owners of live listings, so a client who is neither shows as "Anonymous"
 * unless the review carries a name.
 * Returns empty array if the reviews table doesn't exist yet.
 */
export async function getReviewsForUser(userId: string): Promise<CreatorReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at, reviewer_id, reviewer_name')
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    // Table may not exist yet — fail silently
    console.error('[getReviewsForUser]', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Fetch public names in bulk for reviews that do not carry one
  const reviewerIds = [...new Set(data.filter((r) => !r.reviewer_name && r.reviewer_id).map((r) => r.reviewer_id))];
  const { data: profiles } = reviewerIds.length
    ? await supabase
        .from('public_profiles')
        .select('id, display_name')
        .in('id', reviewerIds)
    : { data: [] as { id: string; display_name: string | null }[] };

  const nameMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  return data.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reviewer_name: r.reviewer_name ?? nameMap.get(r.reviewer_id) ?? null,
    created_at: r.created_at,
  }));
}

// ─── Writes (server, service role) ───────────────────────────────────────────

/**
 * The name shown on a public review: the reviewer's first name only, so a
 * client's full name is never published. null when there is none.
 */
export function publicReviewerName(displayName: string | null | undefined): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first ? first.slice(0, 60) : null;
}

/**
 * Saves a client's review of a completed service booking where the public
 * ratings read it: a published 'crew' review of the creator (the type the
 * creator profile, crew pages and Ubunye read). One row per booking
 * (reviews.booking_id is unique since 085), so saving again updates it and
 * a rating is never counted twice. Published at once: only the booking's
 * client can write it, and moderation can still hide it (its author cannot
 * change is_published, 067). Needs the service role: clients cannot write
 * reviews directly.
 */
export async function saveServiceBookingReview(
  db: SupabaseClient,
  review: {
    bookingId: string;
    reviewerId: string;
    reviewerName: string | null;
    creatorId: string;
    rating: number;
    comment: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db.from('reviews').upsert(
    {
      review_type: 'crew',
      booking_id: review.bookingId,
      reviewer_id: review.reviewerId,
      reviewer_name: review.reviewerName,
      reviewee_id: review.creatorId,
      rating: review.rating,
      comment: review.comment,
      is_published: true,
    },
    { onConflict: 'booking_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
