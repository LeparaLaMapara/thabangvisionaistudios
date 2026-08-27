export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { search } from '@/lib/search';
import type { SearchResponse, SearchResultItem } from '@/lib/search';
import { isRagEnabled, searchSimilar } from '@/lib/rag';
import { createAdminClient } from '@/lib/supabase/server';

export type { SearchResultItem as SearchResult, SearchResponse } from '@/lib/search';

// ─── RAG category mapping ──────────────────────────────────────────────────

const RAG_CATEGORY_MAP: Record<string, SearchResultItem['category']> = {
  rental: 'equipment',
  production: 'productions',
  press: 'press',
  career: 'careers',
};

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await checkRateLimit(`search:${ip}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], counts: {} } satisfies SearchResponse);
  }

  // H2: Sanitize search input — escape PostgREST special characters to prevent filter injection
  const sanitized = q.replace(/[,.()"'\\%_]/g, '');
  if (!sanitized || sanitized.length < 2) {
    return NextResponse.json({ results: [], counts: {} } satisfies SearchResponse);
  }

  try {
    // Run keyword search (always) + RAG search (when enabled) in parallel
    const [keywordResponse, ragResults] = await Promise.all([
      search.search(sanitized),
      isRagEnabled()
        ? searchSimilar(createAdminClient(), q, { limit: 8, threshold: 0.5 }).catch((err) => {
            console.error('[search] RAG error:', err instanceof Error ? err.message : err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    // If no RAG results, return keyword results as-is
    if (ragResults.length === 0) {
      return NextResponse.json(keywordResponse satisfies SearchResponse);
    }

    // Merge: deduplicate by id, RAG results that aren't already in keyword results
    const existingIds = new Set(keywordResponse.results.map((r) => r.id));
    const mergedResults = [...keywordResponse.results];

    // Resolve slugs/thumbnails for RAG results that aren't already in keyword results
    const newRag = ragResults.filter((r) => !existingIds.has(r.content_id));
    const slugMap = await resolveRagSlugs(newRag);

    for (const rag of newRag) {
      const category = RAG_CATEGORY_MAP[rag.content_type];
      if (!category) continue;

      const slugInfo = slugMap.get(rag.content_id);

      // Extract title from content_text (first line is typically the name/title)
      const firstLine = rag.content_text.split('\n')[0] ?? '';
      const title = firstLine.replace(/^(Equipment|Production|Article|Position):\s*/i, '').trim() || 'Untitled';
      const excerpt = rag.content_text.slice(firstLine.length + 1, firstLine.length + 140).trim();

      mergedResults.push({
        id: rag.content_id,
        title,
        excerpt: excerpt || `Semantic match (${Math.round(rag.similarity * 100)}%)`,
        category,
        thumbnail: slugInfo?.thumbnail_url ?? null,
        href: getHrefForRagResult(rag.content_type, slugInfo),
      });
      existingIds.add(rag.content_id);
    }

    // Recount
    const counts: Record<string, number> = {};
    for (const r of mergedResults) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }

    return NextResponse.json({ results: mergedResults, counts } satisfies SearchResponse);
  } catch (err) {
    console.error('[search] Error:', err);
    return NextResponse.json(
      { error: 'Search failed.' },
      { status: 500 },
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type SlugInfo = { slug: string; category?: string; thumbnail_url?: string | null };

async function resolveRagSlugs(
  ragResults: { content_type: string; content_id: string }[],
): Promise<Map<string, SlugInfo>> {
  const slugMap = new Map<string, SlugInfo>();
  if (ragResults.length === 0) return slugMap;

  const supabase = createAdminClient();

  // Group IDs by content type
  const rentalIds = ragResults.filter((r) => r.content_type === 'rental').map((r) => r.content_id);
  const productionIds = ragResults.filter((r) => r.content_type === 'production').map((r) => r.content_id);
  const pressIds = ragResults.filter((r) => r.content_type === 'press').map((r) => r.content_id);

  const queries = [];
  if (rentalIds.length) {
    queries.push(
      supabase.from('smart_rentals').select('id, slug, category, thumbnail_url').in('id', rentalIds)
        .then(({ data }) => {
          for (const r of data ?? []) slugMap.set(r.id, { slug: r.slug, category: r.category, thumbnail_url: r.thumbnail_url });
        }),
    );
  }
  if (productionIds.length) {
    queries.push(
      supabase.from('smart_productions').select('id, slug, thumbnail_url').in('id', productionIds)
        .then(({ data }) => {
          for (const p of data ?? []) slugMap.set(p.id, { slug: p.slug, thumbnail_url: p.thumbnail_url });
        }),
    );
  }
  if (pressIds.length) {
    queries.push(
      supabase.from('press').select('id, slug, cover_url').in('id', pressIds)
        .then(({ data }) => {
          for (const a of data ?? []) slugMap.set(a.id, { slug: a.slug, thumbnail_url: a.cover_url });
        }),
    );
  }

  await Promise.all(queries);
  return slugMap;
}

function getHrefForRagResult(contentType: string, slugInfo: SlugInfo | undefined): string {
  if (!slugInfo) {
    // Fallback to listing pages
    switch (contentType) {
      case 'rental': return '/rentals';
      case 'production': return '/studio';
      case 'press': return '/press';
      case 'career': return '/careers';
      default: return '/';
    }
  }

  switch (contentType) {
    case 'rental':
      return `/rentals/${slugInfo.category ?? 'all'}/${slugInfo.slug}`;
    case 'production':
      return `/studio/${slugInfo.slug}`;
    case 'press':
      return `/press/${slugInfo.slug}`;
    case 'career':
      return '/careers';
    default:
      return '/';
  }
}
