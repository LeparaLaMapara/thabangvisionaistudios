import { createClient } from '@/lib/supabase/server';
import type { Review, CreateReviewInput } from '@/types/marketplace';

export type { Review };

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns reviews received by a user, ordered by created_at DESC.
 */
export async function getReviewsForUser(userId: string): Promise<Review[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getReviewsForUser]', error.message);
    return [];
  }

  return (data as Review[]) ?? [];
}

/**
 * Returns the average rating for a user, or null if no reviews.
 */
export async function getUserAverageRating(userId: string): Promise<number | null> {
  const reviews = await getReviewsForUser(userId);
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return sum / reviews.length;
}

/**
 * Returns reviews for a specific listing (via its orders).
 */
export async function getReviewsForListing(listingId: string): Promise<Review[]> {
  const supabase = await createClient();

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('listing_id', listingId);

  if (ordersError || !orders?.length) return [];

  const orderIds = orders.map((o: { id: string }) => o.id);

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getReviewsForListing]', error.message);
    return [];
  }

  return (data as Review[]) ?? [];
}

/**
 * Returns reviews written by a user, ordered by created_at DESC.
 */
export async function getReviewsByUser(userId: string): Promise<Review[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('reviewer_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getReviewsByUser]', error.message);
    return [];
  }

  return (data as Review[]) ?? [];
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Creates a review for a completed order.
 * Caller must verify the order is completed before calling this.
 */
export async function createReview(input: CreateReviewInput): Promise<Review | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .insert(input)
    .select()
    .single();

  if (error) {
    console.error('[createReview]', error.message);
    return null;
  }

  return data as Review;
}
