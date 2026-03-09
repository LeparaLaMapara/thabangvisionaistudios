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
 * Joins with profiles to get the reviewer's display name.
 * Returns empty array if the reviews table doesn't exist yet.
 */
export async function getReviewsForUser(userId: string): Promise<CreatorReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at, reviewer_id')
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    // Table may not exist yet — fail silently
    console.error('[getReviewsForUser]', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Fetch reviewer names in bulk
  const reviewerIds = [...new Set(data.map((r) => r.reviewer_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', reviewerIds);

  const nameMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  return data.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reviewer_name: nameMap.get(r.reviewer_id) ?? null,
    created_at: r.created_at,
  }));
}
