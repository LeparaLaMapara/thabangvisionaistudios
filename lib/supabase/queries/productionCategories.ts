import { createClient } from '@/lib/supabase/server';
import type { ProductionCategoryRow } from '@/types/production';
import { toProductionCategory, type ProductionCategory } from '@/types/production';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';

/** Merge DB category with constants.ts fallback (e.g. coverImageUrl). */
function withConstantsFallback(cat: ProductionCategory): ProductionCategory {
  const fallback = PRODUCTION_CATEGORIES.find((c) => c.slug === cat.slug);
  if (!fallback) return cat;
  return {
    ...cat,
    coverImageUrl: cat.coverImageUrl || fallback.coverImageUrl || null,
  };
}

// ─── Public Queries ──────────────────────────────────────────────────────────

/** Returns all published categories ordered by display_order. */
export async function getPublishedCategories(): Promise<ProductionCategory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('production_categories')
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[getPublishedCategories]', error.message);
    return [];
  }

  return (data as ProductionCategoryRow[]).map(toProductionCategory).map(withConstantsFallback);
}

/** Returns a single category by slug, or null. */
export async function getCategoryBySlug(slug: string): Promise<ProductionCategory | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('production_categories')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getCategoryBySlug]', error.message);
    }
    return null;
  }

  return withConstantsFallback(toProductionCategory(data as ProductionCategoryRow));
}

// ─── Admin Queries ───────────────────────────────────────────────────────────

/** Returns ALL categories (including unpublished) for admin. */
export async function getAllCategories(): Promise<ProductionCategoryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('production_categories')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[getAllCategories]', error.message);
    return [];
  }

  return (data as ProductionCategoryRow[]) ?? [];
}

/** Count published productions per category (for category cards). */
export async function getProductionCountsByCategory(): Promise<Record<string, number>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('project_type')
    .eq('is_published', true);

  if (error) {
    console.error('[getProductionCountsByCategory]', error.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const pt = (row as { project_type: string }).project_type;
    counts[pt] = (counts[pt] ?? 0) + 1;
  }
  return counts;
}
