import { createClient } from '@/lib/supabase/server';

// ─── DB row type ──────────────────────────────────────────────────────────────

export type SmartRental = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  price_per_week: number | null;
  deposit_amount: number | null;
  currency: string;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: { url: string; public_id: string }[] | null;
  is_available: boolean;
  quantity: number;
  is_featured: boolean;
  tags: string[] | null;
  features: string[] | null;
  rental_includes: string[] | null;
  metadata: Record<string, string> | null;
  video_provider: string | null;
  video_url: string | null;
  video_id: string | null;
  created_at: string;
  /** 'studio' for official gear, 'community' for user-listed gear */
  source?: 'studio' | 'community';
};

// ─── Community listing → smart rental category mapping ────────────────────────
// Maps user listing categories to the smart_rentals category slugs.

const LISTING_TO_RENTAL_CATEGORY: Record<string, string> = {
  cameras:     'cameras-optics',
  lenses:      'cameras-optics',
  lighting:    'lighting-power',
  audio:       'audio',
  grip:        'grip-motion',
  accessories: 'specialized-solutions',
  other:       'specialized-solutions',
};

// Selected columns used for list views (omit heavy gallery blob)
const LIST_COLUMNS = [
  'id', 'slug', 'title', 'description', 'category', 'sub_category',
  'brand', 'model', 'price_per_day', 'price_per_week', 'currency',
  'thumbnail_url', 'is_available', 'is_featured', 'tags', 'features',
  'metadata', 'created_at',
].join(',');

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all published, non-deleted rentals ordered by created_at DESC.
 * Safe to call in Server Components — never exposes the service key.
 */
export async function getPublishedRentals(): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getPublishedRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/**
 * Returns published rentals filtered by category slug.
 * Used by the /smart-rentals/[category] server page.
 */
export async function getPublishedRentalsByCategory(
  category: string,
): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('category', category)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getPublishedRentalsByCategory]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/**
 * Returns a single published rental by slug, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getRentalBySlug(slug: string): Promise<SmartRental | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getRentalBySlug]', error.message);
    }
    return null;
  }

  return data as SmartRental;
}

// ─── Community Listings ──────────────────────────────────────────────────────
// Fetches user-listed gear from the `listings` table and maps them to
// SmartRental shape so they can be displayed alongside official rentals.

/**
 * Maps a community listing row to the SmartRental shape.
 */
function mapListingToRental(row: Record<string, unknown>): SmartRental {
  return {
    id: row.id as string,
    slug: `community-${row.slug as string}`,
    title: row.title as string,
    description: (row.description as string) ?? null,
    category: LISTING_TO_RENTAL_CATEGORY[(row.category as string) ?? ''] ?? 'specialized-solutions',
    sub_category: (row.condition as string) ?? null,
    brand: null,
    model: null,
    price_per_day: (row.price_per_day as number) ?? (row.price as number) ?? null,
    price_per_week: null,
    deposit_amount: null,
    currency: (row.currency as string) ?? 'ZAR',
    thumbnail_url: (row.thumbnail_url as string) ?? null,
    cover_public_id: null,
    gallery: null,
    is_available: true,
    quantity: 1,
    is_featured: false,
    tags: (row.tags as string[]) ?? null,
    features: null,
    rental_includes: null,
    metadata: (row.location as string) ? { location: row.location as string } : null,
    video_provider: null,
    video_url: null,
    video_id: null,
    created_at: row.created_at as string,
    source: 'community',
  };
}

/**
 * Returns all published community listings mapped to SmartRental shape.
 */
export async function getCommunityListings(): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('listings')
    .select('id, slug, title, description, category, price_per_day, price, currency, thumbnail_url, condition, location, tags, is_published, created_at')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    // Table may not exist yet — fail silently
    if (!error.message.includes('does not exist')) {
      console.error('[getCommunityListings]', error.message);
    }
    return [];
  }

  return ((data as Record<string, unknown>[]) ?? []).map(mapListingToRental);
}

/**
 * Returns community listings filtered to a specific smart rental category.
 */
export async function getCommunityListingsByCategory(rentalCategory: string): Promise<SmartRental[]> {
  const all = await getCommunityListings();
  return all.filter(r => r.category === rentalCategory);
}
