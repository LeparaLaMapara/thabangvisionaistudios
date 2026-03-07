import { createClient } from '@/lib/supabase/server';
import type {
  Listing,
  ListingType,
  CreateListingInput,
} from '@/types/marketplace';

// Re-export types for convenience
export type { Listing, ListingType };

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
