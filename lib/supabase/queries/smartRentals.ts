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
