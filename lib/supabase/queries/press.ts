import { createClient } from '@/lib/supabase/server';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type PressArticle = {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  excerpt: string | null;
  cover_url: string | null;
  cover_public_id: string | null;
  author: string | null;
  category: string | null;
  published_at: string | null;
  is_published: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all published, non-deleted press articles ordered by published_at DESC.
 * Safe to call in Server Components — never exposes the service key.
 */
export async function getPublishedPress(): Promise<PressArticle[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('press')
    .select('*')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('published_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getPublishedPress]', error.message);
    return [];
  }

  return (data as PressArticle[]) ?? [];
}

/**
 * Returns featured published press articles, limited and ordered by created_at DESC.
 * Used on the home page "Latest Work" carousel.
 */
export async function getFeaturedPress(limit = 2): Promise<PressArticle[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('press')
    .select('*')
    .eq('is_published', true)
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getFeaturedPress]', error.message);
    return [];
  }

  return (data as PressArticle[]) ?? [];
}

/**
 * Returns a single published press article by slug, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getPressBySlug(slug: string): Promise<PressArticle | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('press')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getPressBySlug]', error.message);
    }
    return null;
  }

  return data as PressArticle;
}
