import { createClient } from '@/lib/supabase/server';
import type {
  Listing,
  ListingType,
  Order,
  Review,
  SubscriptionPlan,
  Subscription,
  CreateListingInput,
  CreateOrderInput,
  CreateReviewInput,
  OrderStatus,
} from '@/types/marketplace';

// Re-export types for convenience
export type {
  Listing,
  ListingType,
  Order,
  Review,
  SubscriptionPlan,
  Subscription,
};

// ─── Listing Queries ─────────────────────────────────────────────────────────

const LISTING_LIST_COLUMNS =
  'id, user_id, type, title, slug, price, pricing_model, currency, category, sub_category, thumbnail_url, location, condition, is_published, is_featured, tags, created_at' as const;

/**
 * Returns all published, non-deleted listings ordered by created_at DESC.
 */
export async function getPublishedListings(): Promise<Listing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_LIST_COLUMNS)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getPublishedListings]', error.message);
    return [];
  }

  return (data as Listing[]) ?? [];
}

/**
 * Returns published listings filtered by category.
 */
export async function getListingsByCategory(category: string): Promise<Listing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_LIST_COLUMNS)
    .eq('is_published', true)
    .eq('category', category)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getListingsByCategory]', error.message);
    return [];
  }

  return (data as Listing[]) ?? [];
}

/**
 * Returns published listings filtered by type (gear or service).
 */
export async function getListingsByType(type: ListingType): Promise<Listing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select(LISTING_LIST_COLUMNS)
    .eq('is_published', true)
    .eq('type', type)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getListingsByType]', error.message);
    return [];
  }

  return (data as Listing[]) ?? [];
}

/**
 * Returns a single published listing by slug, or null if not found.
 */
export async function getListingBySlug(slug: string): Promise<Listing | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getListingBySlug]', error.message);
    }
    return null;
  }

  return data as Listing;
}

/**
 * Returns all listings for a given user (including unpublished/drafts).
 */
export async function getListingsByUser(userId: string): Promise<Listing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getListingsByUser]', error.message);
    return [];
  }

  return (data as Listing[]) ?? [];
}

// ─── Order Queries ───────────────────────────────────────────────────────────

/**
 * Returns orders where the user is the buyer, ordered by created_at DESC.
 */
export async function getOrdersByBuyer(userId: string): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getOrdersByBuyer]', error.message);
    return [];
  }

  return (data as Order[]) ?? [];
}

/**
 * Returns orders where the user is the seller, ordered by created_at DESC.
 */
export async function getOrdersBySeller(userId: string): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('seller_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getOrdersBySeller]', error.message);
    return [];
  }

  return (data as Order[]) ?? [];
}

/**
 * Returns a single order by id, or null if not found.
 */
export async function getOrderById(id: string): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getOrderById]', error.message);
    }
    return null;
  }

  return data as Order;
}

// ─── Review Queries ──────────────────────────────────────────────────────────

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

// ─── Subscription Queries ────────────────────────────────────────────────────

/**
 * Returns all active subscription plans.
 */
export async function getActiveSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('price', { ascending: true });

  if (error) {
    console.error('[getActiveSubscriptionPlans]', error.message);
    return [];
  }

  return (data as SubscriptionPlan[]) ?? [];
}

/**
 * Returns the active subscription for a user, or null.
 */
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getUserSubscription]', error.message);
    }
    return null;
  }

  return data as Subscription;
}

// ─── Listing Mutations ──────────────────────────────────────────────────────

/**
 * Creates a new listing (unpublished by default).
 */
export async function createListing(input: CreateListingInput): Promise<Listing | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .insert({ ...input, is_published: false, is_featured: false })
    .select()
    .single();

  if (error) {
    console.error('[createListing]', error.message);
    return null;
  }

  return data as Listing;
}

/**
 * Updates a listing. Only the owner should call this (enforce in API route).
 */
export async function updateListing(
  listingId: string,
  updates: Partial<Omit<Listing, 'id' | 'user_id' | 'created_at'>>,
): Promise<Listing | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', listingId)
    .select()
    .single();

  if (error) {
    console.error('[updateListing]', error.message);
    return null;
  }

  return data as Listing;
}

/**
 * Soft-deletes a listing by setting deleted_at.
 */
export async function deleteListing(listingId: string): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('listings')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', listingId);

  if (error) {
    console.error('[deleteListing]', error.message);
    return false;
  }

  return true;
}

// ─── Order Mutations ────────────────────────────────────────────────────────

/**
 * Creates a new order with status 'pending'.
 */
export async function createOrder(input: CreateOrderInput): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .insert({ ...input, status: 'pending' as OrderStatus })
    .select()
    .single();

  if (error) {
    console.error('[createOrder]', error.message);
    return null;
  }

  return data as Order;
}

/**
 * Updates an order's status and optionally sets the PayFast payment ID.
 */
export async function updateOrderStatus(
  orderId: string,
  updates: {
    status: OrderStatus;
    payfast_payment_id?: string;
  },
): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    console.error('[updateOrderStatus]', error.message);
    return null;
  }

  return data as Order;
}

// ─── Review Mutations ───────────────────────────────────────────────────────

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
