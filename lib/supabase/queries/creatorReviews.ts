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
