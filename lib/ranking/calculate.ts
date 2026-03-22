import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RankingInput = {
  owner_type: string;
  is_available: boolean;
  is_featured: boolean;
  owner_is_verified: boolean;
  owner_has_complete_profile: boolean;
  reviews: { rating: number }[];
};

export type RecalculateResult = {
  count: number;
  durationMs: number;
};

// ─── Scoring Formula ────────────────────────────────────────────────────────
//
// +100  if owner_type = 'studio'
// +50   if owner is verified (profiles.is_verified = true)
// +20   per 5-star review
// +15   per 4-star review
// +10   per 3-star review
// +15   if is_available = true
// +30   if is_featured = true
// +5    if owner has complete profile (display_name + bio + avatar_url all non-null)

const REVIEW_SCORE: Record<number, number> = {
  5: 20,
  4: 15,
  3: 10,
};

/**
 * Pure function that computes a ranking score from the given inputs.
 */
export function calculateRankingScore(params: RankingInput): number {
  let score = 0;

  // Owner type bonus
  if (params.owner_type === 'studio') {
    score += 100;
  }

  // Verified owner bonus
  if (params.owner_is_verified) {
    score += 50;
  }

  // Review bonuses
  for (const review of params.reviews) {
    score += REVIEW_SCORE[review.rating] ?? 0;
  }

  // Availability bonus
  if (params.is_available) {
    score += 15;
  }

  // Featured bonus
  if (params.is_featured) {
    score += 30;
  }

  // Complete profile bonus
  if (params.owner_has_complete_profile) {
    score += 5;
  }

  return score;
}

// ─── Batch Recalculation ────────────────────────────────────────────────────

/**
 * Fetches all non-deleted smart_rentals, computes ranking scores, and
 * batch-updates them in the database.
 */
export async function recalculateAllRankings(
  supabase: SupabaseClient,
): Promise<RecalculateResult> {
  const start = Date.now();

  // 1. Fetch all active rentals
  const { data: rentals, error: rentalsError } = await supabase
    .from('smart_rentals')
    .select('id, owner_type, owner_id, is_available, is_featured')
    .is('deleted_at', null);

  if (rentalsError) {
    throw new Error(`Failed to fetch rentals: ${rentalsError.message}`);
  }

  if (!rentals || rentals.length === 0) {
    return { count: 0, durationMs: Date.now() - start };
  }

  // 2. Collect unique owner IDs for profile lookups
  const ownerIds = [
    ...new Set(
      rentals
        .map((r) => r.owner_id as string | null)
        .filter((id): id is string => id != null),
    ),
  ];

  // 3. Fetch owner profiles
  const profileMap = new Map<
    string,
    { is_verified: boolean; has_complete_profile: boolean }
  >();

  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, is_verified, display_name, bio, avatar_url')
      .in('id', ownerIds);

    for (const p of profiles ?? []) {
      profileMap.set(p.id as string, {
        is_verified: Boolean(p.is_verified),
        has_complete_profile:
          p.display_name != null && p.bio != null && p.avatar_url != null,
      });
    }
  }

  // 4. Fetch all reviews grouped by rental_id
  const rentalIds = rentals.map((r) => r.id as string);
  const reviewMap = new Map<string, { rating: number }[]>();

  const { data: reviews } = await supabase
    .from('reviews')
    .select('rental_id, rating')
    .eq('review_type', 'rental')
    .in('rental_id', rentalIds);

  for (const rev of reviews ?? []) {
    const rid = rev.rental_id as string;
    if (!reviewMap.has(rid)) {
      reviewMap.set(rid, []);
    }
    reviewMap.get(rid)!.push({ rating: rev.rating as number });
  }

  // 5. Calculate scores and build update batch
  let count = 0;

  for (const rental of rentals) {
    const ownerId = rental.owner_id as string | null;
    const profile = ownerId ? profileMap.get(ownerId) : undefined;
    const rentalReviews = reviewMap.get(rental.id as string) ?? [];

    const score = calculateRankingScore({
      owner_type: (rental.owner_type as string) ?? 'studio',
      is_available: Boolean(rental.is_available),
      is_featured: Boolean(rental.is_featured),
      owner_is_verified: profile?.is_verified ?? false,
      owner_has_complete_profile: profile?.has_complete_profile ?? false,
      reviews: rentalReviews,
    });

    // Compute average rating
    const reviewCount = rentalReviews.length;
    const averageRating =
      reviewCount > 0
        ? rentalReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
        : 0;

    const { error: updateError } = await supabase
      .from('smart_rentals')
      .update({
        ranking_score: score,
        review_count: reviewCount,
        average_rating: Math.round(averageRating * 100) / 100,
      })
      .eq('id', rental.id);

    if (!updateError) {
      count++;
    }
  }

  return { count, durationMs: Date.now() - start };
}
