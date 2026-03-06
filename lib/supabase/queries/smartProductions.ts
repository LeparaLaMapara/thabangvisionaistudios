import { createClient } from '@/lib/supabase/server';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type SmartProduction = {
  id: string;
  slug: string;
  title: string;
  client: string | null;
  year: number | null;
  project_type: string;
  sub_category: string | null;
  description: string | null;
  video_provider: string | null;
  video_url: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: { url: string; public_id: string }[] | null;
  is_published: boolean;
  is_featured: boolean;
  created_at: string;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all published productions ordered by year descending.
 * Safe to call in Server Components — never exposes the service key.
 *
 * Note: add .eq('is_archived', false) here once that column exists.
 */
export async function getPublishedProductions(): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getPublishedProductions]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

/**
 * Returns a single published production by slug, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getProductionBySlug(
  slug: string,
): Promise<SmartProduction | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getProductionBySlug]', error.message);
    }
    return null;
  }

  return data as SmartProduction;
}
