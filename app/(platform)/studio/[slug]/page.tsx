export const revalidate = 60;

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductionBySlug } from '@/lib/supabase/queries/smartProductions';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { escapeIlike } from '@/lib/search/types';
import { isRagEnabled, searchSimilar } from '@/lib/rag';
import ProductionDetailView from './ProductionDetailView';
import type { MatchedGear } from './ProductionDetailView';

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project   = await getProductionBySlug(slug);
  return { title: project?.title ?? 'Production' };
}

// ─── Gear Lookup ─────────────────────────────────────────────────────────────

type RentalRow = {
  title: string;
  slug: string;
  category: string;
  price_per_day: number;
  thumbnail_url: string | null;
  brand: string | null;
  model: string | null;
};

/**
 * Match EXIF camera/lens strings to rental items using three strategies:
 * 1. Exact slug lookup via gearExifMap (fast path for known gear)
 * 2. Fuzzy search against title, brand, model columns (catches substring matches)
 * 3. Embedding similarity search via RAG (when RAG_ENABLED=true — catches semantic
 *    matches like "ILCE-7M3" → "Sony Alpha A7 III" even with no string overlap)
 * Results are deduplicated by slug. Strategies run in order of precision.
 */
async function matchGearFromMetadata(
  metadata: { camera?: string; lens?: string }[],
): Promise<MatchedGear[]> {
  // Extract unique camera + lens strings from EXIF
  const gearStrings = new Set<string>();
  for (const m of metadata) {
    if (m.camera) gearStrings.add(m.camera);
    if (m.lens) gearStrings.add(m.lens);
  }

  if (gearStrings.size === 0) return [];

  const supabase = await createClient();
  const seenSlugs = new Set<string>();
  const results: MatchedGear[] = [];

  // Strategy 1: Exact slug lookup via gearExifMap (case-insensitive)
  // Build a lowercase lookup map so "SONY ILCE-7M3" matches "Sony ILCE-7M3"
  const exifMap = STUDIO.gearExifMap;
  const lowerMap = new Map<string, string>();
  for (const [key, slug] of Object.entries(exifMap)) {
    lowerMap.set(key.toLowerCase(), slug);
  }
  const slugSet = new Set<string>();
  for (const g of gearStrings) {
    const match = lowerMap.get(g.toLowerCase());
    if (match) slugSet.add(match);
  }

  if (slugSet.size > 0) {
    const { data } = await supabase
      .from('smart_rentals')
      .select('title, slug, category, price_per_day, thumbnail_url, brand, model')
      .in('slug', [...slugSet])
      .eq('is_published', true)
      .is('deleted_at', null);

    if (data) {
      for (const r of data as RentalRow[]) {
        seenSlugs.add(r.slug);
        results.push({
          title: r.title,
          slug: r.slug,
          category: r.category,
          pricePerDay: r.price_per_day,
          thumbnail: r.thumbnail_url,
          brand: r.brand,
          model: r.model,
        });
      }
    }
  }

  // Strategy 2: Fuzzy match against title, brand, model
  const orClauses: string[] = [];
  for (const g of gearStrings) {
    const escaped = escapeIlike(g);
    orClauses.push(
      `title.ilike.%${escaped}%`,
      `brand.ilike.%${escaped}%`,
      `model.ilike.%${escaped}%`,
    );
  }

  if (orClauses.length > 0) {
    const { data } = await supabase
      .from('smart_rentals')
      .select('title, slug, category, price_per_day, thumbnail_url, brand, model')
      .or(orClauses.join(','))
      .eq('is_published', true)
      .is('deleted_at', null);

    if (data) {
      for (const r of data as RentalRow[]) {
        if (seenSlugs.has(r.slug)) continue;
        seenSlugs.add(r.slug);
        results.push({
          title: r.title,
          slug: r.slug,
          category: r.category,
          pricePerDay: r.price_per_day,
          thumbnail: r.thumbnail_url,
          brand: r.brand,
          model: r.model,
        });
      }
    }
  }

  // Strategy 3: Embedding similarity search (RAG_ENABLED=true only)
  // Catches semantic matches where EXIF strings have zero string overlap
  // with rental titles, e.g. "ILCE-7M3" matching "Sony Alpha A7 III"
  if (isRagEnabled()) {
    for (const g of gearStrings) {
      try {
        const similar = await searchSimilar(supabase, g, {
          limit: 3,
          threshold: 0.65,
          contentTypes: ['rental'],
        });

        if (similar.length === 0) continue;

        // Fetch the actual rental rows by content_id (UUID)
        const ids = similar.map(s => s.content_id);
        const { data } = await supabase
          .from('smart_rentals')
          .select('title, slug, category, price_per_day, thumbnail_url, brand, model')
          .in('id', ids)
          .eq('is_published', true)
          .is('deleted_at', null);

        if (data) {
          for (const r of data as RentalRow[]) {
            if (seenSlugs.has(r.slug)) continue;
            seenSlugs.add(r.slug);
            results.push({
              title: r.title,
              slug: r.slug,
              category: r.category,
              pricePerDay: r.price_per_day,
              thumbnail: r.thumbnail_url,
              brand: r.brand,
              model: r.model,
            });
          }
        }
      } catch (err) {
        // Non-blocking — embedding search is best-effort
        console.warn('[shot-with] Embedding search failed for:', g, err instanceof Error ? err.message : err);
      }
    }
  }

  return results;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Server Component — fetches a single published production by slug and passes
 * it to ProductionDetailView for rendering.
 * Returns a 404 if the slug is not found or the project is unpublished.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project   = await getProductionBySlug(slug);

  if (!project) notFound();

  const matchedGear = await matchGearFromMetadata(project.image_metadata ?? []);

  return <ProductionDetailView project={project} matchedGear={matchedGear} />;
}
