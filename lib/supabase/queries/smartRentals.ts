import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { STUDIO, LISTING_TO_RENTAL_CATEGORY } from '@/lib/constants';

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
  /** Gear protection (migration 062); absent on list queries. */
  replacement_value?: number | null;
  serial_number?: string | null;
  tracker_fitted?: boolean | null;
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
  /** 'studio' for official ThabangVision gear, 'community' for user-listed gear */
  owner_type: string;
  owner_id: string | null;
  ranking_score: number;
  total_rentals: number;
  average_rating: number;
  review_count: number;
  /** 'studio' for official gear, 'community' for user-listed gear */
  source?: 'studio' | 'community';
};

// Selected columns used for list views (omit heavy gallery blob)
const LIST_COLUMNS = [
  'id', 'slug', 'title', 'description', 'category', 'sub_category',
  'brand', 'model', 'price_per_day', 'price_per_week', 'currency',
  'thumbnail_url', 'cover_public_id', 'gallery',
  'is_available', 'is_featured', 'tags', 'features',
  'metadata', 'video_provider', 'video_url', 'created_at',
  'owner_type', 'owner_id', 'ranking_score', 'total_rentals',
  'average_rating', 'review_count',
].join(',');

// ─── Catalogue list pages ─────────────────────────────────────────────────────
// The category grid ships every row to the browser inside the page payload, so
// it reads only what a card shows. In particular it takes the first gallery
// image (`gallery->0`), not the whole gallery array, and no description.
//
// Both list reads are capped. A cap keeps one huge category from turning into
// a multi-megabyte page; `hasMore` lets the page say it is showing the top N
// rather than silently dropping the rest.

/** Most rentals one category page lists (ranked best first). */
export const RENTAL_CATEGORY_PAGE_LIMIT = 200;
/** Ceiling for the per-category count read on /rentals (one tiny row per item). */
export const RENTAL_COUNT_SCAN_LIMIT = 5000;

/** The fields a rental card on a category page uses. */
export type RentalListItem = Pick<
  SmartRental,
  | 'id' | 'slug' | 'title' | 'category' | 'sub_category' | 'brand' | 'model'
  | 'price_per_day' | 'currency' | 'thumbnail_url' | 'gallery'
  | 'is_available' | 'is_featured' | 'features' | 'metadata' | 'created_at'
  | 'owner_type' | 'owner_id' | 'ranking_score'
>;

export const RENTAL_CARD_COLUMNS = [
  'id', 'slug', 'title', 'category', 'sub_category', 'brand', 'model',
  'price_per_day', 'currency', 'thumbnail_url', 'first_image:gallery->0',
  'is_available', 'is_featured', 'features', 'metadata', 'created_at',
  'owner_type', 'owner_id', 'ranking_score',
].join(',');

type CardRow = Omit<RentalListItem, 'gallery'> & {
  first_image: { url: string; public_id: string } | null;
};

function toListItem({ first_image, ...row }: CardRow): RentalListItem {
  return { ...row, gallery: first_image?.url ? [first_image] : null };
}

/**
 * A list read that can fail. `failed` is true when the database could not be
 * read, so a page can say "couldn't load, try again" instead of showing an
 * outage as "no equipment in this category".
 */
export type RentalListResult = {
  rentals: RentalListItem[];
  failed: boolean;
  /** More rows matched than the limit allowed. */
  hasMore: boolean;
};

/**
 * Published rentals in one category, ranked, capped at `limit`.
 * Used by the /rentals/[category] page.
 */
export async function fetchPublishedRentalsByCategory(
  category: string,
  limit: number = RENTAL_CATEGORY_PAGE_LIMIT,
): Promise<RentalListResult> {
  try {
    const supabase = await createClient();

    // One extra row tells us whether the cap cut anything off.
    const { data, error } = await supabase
      .from('smart_rentals')
      .select(RENTAL_CARD_COLUMNS)
      .eq('is_published', true)
      .eq('category', category)
      .is('deleted_at', null)
      .order('ranking_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (error) {
      console.error('[fetchPublishedRentalsByCategory]', error.message);
      return { rentals: [], failed: true, hasMore: false };
    }

    const rows = ((data as unknown as CardRow[]) ?? []).map(toListItem);
    return { rentals: rows.slice(0, limit), failed: false, hasMore: rows.length > limit };
  } catch (err) {
    // Let Next's own control-flow errors (dynamic-rendering bailout, redirects)
    // through; only a real failure becomes `failed`.
    unstable_rethrow(err);
    console.error('[fetchPublishedRentalsByCategory]', err instanceof Error ? err.message : err);
    return { rentals: [], failed: true, hasMore: false };
  }
}

/**
 * Every published rental across all categories, ranked, capped at `limit`.
 * Used by the /rentals page, which shows the gear itself and filters by
 * category in place instead of sending people through category pages.
 */
export async function fetchAllPublishedRentals(
  limit: number = RENTAL_CATEGORY_PAGE_LIMIT,
): Promise<RentalListResult> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('smart_rentals')
      .select(RENTAL_CARD_COLUMNS)
      .eq('is_published', true)
      .neq('category', 'crew-services')
      .is('deleted_at', null)
      .order('ranking_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (error) {
      console.error('[fetchAllPublishedRentals]', error.message);
      return { rentals: [], failed: true, hasMore: false };
    }

    const rows = ((data as unknown as CardRow[]) ?? []).map(toListItem);
    return { rentals: rows.slice(0, limit), failed: false, hasMore: rows.length > limit };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[fetchAllPublishedRentals]', err instanceof Error ? err.message : err);
    return { rentals: [], failed: true, hasMore: false };
  }
}

/**
 * Returns published rentals filtered by category slug (ranked, capped).
 * Kept for callers that only want the list; a database error reads as [].
 * Prefer fetchPublishedRentalsByCategory where the page can show an error.
 */
export async function getPublishedRentalsByCategory(
  category: string,
): Promise<RentalListItem[]> {
  return (await fetchPublishedRentalsByCategory(category)).rentals;
}

/** Items per category for the /rentals index, plus whether the read failed. */
export type RentalCategoryCounts = {
  /** Ordered by each category's best-ranked item (the order /rentals shows). */
  counts: { category: string; count: number }[];
  failed: boolean;
};

/**
 * How many published items each category holds, for the /rentals index.
 *
 * The index page used to load every rental (gallery included) just to count
 * them. This reads one short column per row instead.
 */
export async function getRentalCategoryCounts(): Promise<RentalCategoryCounts> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('smart_rentals')
      .select('category')
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('ranking_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(RENTAL_COUNT_SCAN_LIMIT);

    if (error) {
      console.error('[getRentalCategoryCounts]', error.message);
      return { counts: [], failed: true };
    }

    return { counts: tallyCategories((data as { category: string | null }[]) ?? []), failed: false };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[getRentalCategoryCounts]', err instanceof Error ? err.message : err);
    return { counts: [], failed: true };
  }
}

/** Counts rows per category, keeping first-seen order. Exported for tests. */
export function tallyCategories(
  rows: { category: string | null }[],
): { category: string; count: number }[] {
  const order: string[] = [];
  const tally = new Map<string, number>();
  for (const row of rows) {
    if (!row.category) continue;
    if (!tally.has(row.category)) order.push(row.category);
    tally.set(row.category, (tally.get(row.category) ?? 0) + 1);
  }
  return order.map((category) => ({ category, count: tally.get(category) ?? 0 }));
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns published, non-deleted rentals ordered by ranking_score DESC.
 * Safe to call in Server Components — never exposes the service key.
 * Capped at RENTAL_COUNT_SCAN_LIMIT; /rentals now uses getRentalCategoryCounts.
 */
export async function getPublishedRentals(): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(RENTAL_COUNT_SCAN_LIMIT);

  if (error) {
    console.error('[getPublishedRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/**
 * Returns a single published rental by slug, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 *
 * Wrapped in React cache(): a detail page calls it from generateMetadata and
 * again from the page body; within one request that is now one round trip.
 */
export const getRentalBySlug = cache(async (slug: string): Promise<SmartRental | null> => {
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
});

/**
 * Returns featured published rentals, limited and ordered by ranking_score DESC.
 * Used on the home page "Latest Work" carousel.
 */
export async function getFeaturedRentals(limit = 2): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getFeaturedRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/**
 * Returns all archived rentals ordered by ranking_score DESC.
 */
export async function getArchivedRentals(): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('is_archived', true)
    .is('deleted_at', null)
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getArchivedRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/**
 * Returns published rentals in the same category, excluding a specific item.
 * Used for "Related Equipment" sections on detail pages.
 */
export async function getRelatedRentals(
  category: string,
  excludeId: string,
  limit = 4,
): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('category', category)
    .neq('id', excludeId)
    .is('deleted_at', null)
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getRelatedRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

// ─── Community Listings ──────────────────────────────────────────────────────
// Fetches user-listed gear from the `listings` table and maps them to
// SmartRental shape so they can be displayed alongside official rentals.

/**
 * True only when the table itself is missing (Postgres 42P01, or PostgREST
 * PGRST205 "Could not find the table"). A missing column (42703) is not.
 */
export function isMissingTableError(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation "[^"]+" does not exist/.test(error.message ?? '');
}

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
    // listings has a single price column; it is shown as the day rate.
    price_per_day: (row.price as number) ?? null,
    price_per_week: null,
    deposit_amount: null,
    currency: (row.currency as string) ?? STUDIO.currency.code,
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
    owner_type: 'community',
    owner_id: (row.user_id as string) ?? null,
    ranking_score: 0,
    total_rentals: 0,
    average_rating: 0,
    review_count: 0,
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
    .select('id, slug, title, description, category, price, currency, thumbnail_url, condition, location, tags, is_published, created_at')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    // Only a missing table is quiet; a missing column is a bug and is logged.
    if (!isMissingTableError(error)) {
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

// ─── Home page showcase ──────────────────────────────────────────────────────

/**
 * Gear for the home page showcase carousel.
 *
 * Featured items lead, then the best-ranked of everything else, so the rail
 * still fills even though only a handful of listings are flagged featured.
 * Archived stock is excluded — it is off the shelf and must not be advertised.
 */
export async function getShowcaseRentals(limit = 8): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('is_archived', false)
    .is('deleted_at', null)
    .order('is_featured', { ascending: false })
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getShowcaseRentals]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

export type RentalPriceRange = { min: number; max: number };

/**
 * Cheapest and dearest day rate across live stock.
 *
 * The home page and the LocalBusiness JSON-LD both used to hardcode this. The
 * page claimed hire started at R500 when the real floor was R20, which quietly
 * turned away every customer shopping below R500 — and eleven listings sit
 * under it. Reading it from stock means it cannot drift again.
 *
 * Zero and null rates are excluded: a listing with no price set is not a
 * cheapest offer, it is an unfinished listing.
 */
export async function getRentalPriceRange(): Promise<RentalPriceRange | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select('price_per_day')
    .eq('is_published', true)
    .eq('is_archived', false)
    .is('deleted_at', null)
    .gt('price_per_day', 0);

  if (error) {
    console.error('[getRentalPriceRange]', error.message);
    return null;
  }

  const prices = ((data as { price_per_day: number | null }[]) ?? [])
    .map(r => Number(r.price_per_day))
    .filter(n => Number.isFinite(n) && n > 0);

  if (prices.length === 0) return null;

  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Gear one person owns and has live for hire.
 *
 * `smart_rentals.owner_id` has always been a foreign key to profiles, but every
 * use of it in the codebase was administrative — dispute handling, suspension,
 * cron de-listing. Nothing public ever said "here is this person's gear", so a
 * creator who owned a mixer had no way to show it.
 *
 * This is one half of the loop. The other half is naming the owner on the gear
 * itself, so renting a camera becomes a route to the person who shoots with it.
 */
export async function getRentalsByOwner(ownerId: string): Promise<SmartRental[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_rentals')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .eq('is_archived', false)
    .is('deleted_at', null)
    .eq('owner_id', ownerId)
    .order('ranking_score', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getRentalsByOwner]', error.message);
    return [];
  }

  return (data as unknown as SmartRental[]) ?? [];
}

/** Public identity of a gear owner, for the "owned by" line on a listing. */
export type RentalOwner = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  crew_slug: string | null;
  specializations: string[] | null;
  is_verified: boolean;
  /** True when this person is listed as available for hire, not just as an owner. */
  is_bookable: boolean;
};

/**
 * Who owns a listing, when it is community stock.
 *
 * Reads `public_profiles`, never `profiles`. The base table has no SELECT
 * policy for anonymous readers, so querying it here would have silently
 * returned nothing on every public page. The view is also the one that filters
 * out suspended accounts, so a suspended owner cannot be reintroduced through
 * a gear listing.
 *
 * Studio-owned gear passes ownerId null and gets null back: "owned by
 * ThabangVision" on a ThabangVision page is noise. Null is also the answer when
 * the profile is gone, because a listing must still render without its owner.
 */
export async function getRentalOwner(ownerId: string | null): Promise<RentalOwner | null> {
  if (!ownerId) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, display_name, avatar_url, crew_slug, specializations, available_for_hire, is_verified')
    .eq('id', ownerId)
    .maybeSingle();

  if (error) {
    console.error('[getRentalOwner]', error.message);
    return null;
  }
  if (!data) return null;

  const row = data as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    crew_slug: string | null;
    specializations: string[] | null;
    available_for_hire: boolean | null;
    is_verified: boolean | null;
  };

  return {
    id: row.id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    crew_slug: row.crew_slug,
    specializations: row.specializations,
    is_verified: Boolean(row.is_verified),
    is_bookable: Boolean(row.available_for_hire),
  };
}
