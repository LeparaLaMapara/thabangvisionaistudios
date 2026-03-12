// ─── RAG Content Indexer ─────────────────────────────────────────────────────
// Generates embeddings for content and stores them in the content_embeddings table.

import { generateEmbedding, isEmbeddingConfigured } from './embeddings';
import { STUDIO } from '@/lib/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContentType = 'rental' | 'production' | 'press' | 'career';

export type IndexResult = {
  indexed: number;
  errors: number;
  duration: number;
};

// ─── Content String Builders ────────────────────────────────────────────────
// Each builder creates a rich text representation of the content for embedding.

function buildRentalContent(item: Record<string, unknown>): string {
  const parts = [
    `Equipment: ${item.title}`,
    item.brand ? `Brand: ${item.brand}` : null,
    item.model ? `Model: ${item.model}` : null,
    item.category ? `Category: ${item.category}` : null,
    item.description ? `Description: ${item.description}` : null,
    item.price_per_day ? `Price: R${item.price_per_day}/day` : null,
    item.price_per_week ? `Weekly: R${item.price_per_week}/week` : null,
    Array.isArray(item.features) && item.features.length > 0
      ? `Features: ${(item.features as string[]).join(', ')}`
      : null,
    Array.isArray(item.tags) && item.tags.length > 0
      ? `Tags: ${(item.tags as string[]).join(', ')}`
      : null,
  ];
  return parts.filter(Boolean).join('\n');
}

function buildProductionContent(item: Record<string, unknown>): string {
  const parts = [
    `Production: ${item.title}`,
    item.client ? `Client: ${item.client}` : null,
    item.project_type ? `Type: ${item.project_type}` : null,
    item.year ? `Year: ${item.year}` : null,
    item.description ? `Description: ${item.description}` : null,
    Array.isArray(item.tags) && item.tags.length > 0
      ? `Tags: ${(item.tags as string[]).join(', ')}`
      : null,
  ];
  return parts.filter(Boolean).join('\n');
}

function buildPressContent(item: Record<string, unknown>): string {
  const parts = [
    `Article: ${item.title}`,
    item.author ? `Author: ${item.author}` : null,
    item.category ? `Category: ${item.category}` : null,
    item.excerpt ? `Excerpt: ${item.excerpt}` : null,
    item.content ? `Content: ${String(item.content).slice(0, 2000)}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

function buildCareerContent(item: Record<string, unknown>): string {
  const parts = [
    `Job: ${item.title}`,
    item.department ? `Department: ${item.department}` : null,
    item.location ? `Location: ${item.location}` : null,
    item.employment_type ? `Type: ${item.employment_type}` : null,
    item.description ? `Description: ${item.description}` : null,
    Array.isArray(item.requirements) && item.requirements.length > 0
      ? `Requirements: ${(item.requirements as string[]).join(', ')}`
      : null,
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Build a content string for embedding based on content type.
 */
export function buildContentString(contentType: ContentType, item: Record<string, unknown>): string {
  switch (contentType) {
    case 'rental': return buildRentalContent(item);
    case 'production': return buildProductionContent(item);
    case 'press': return buildPressContent(item);
    case 'career': return buildCareerContent(item);
  }
}

// ─── Index Single Item ──────────────────────────────────────────────────────

/**
 * Generate an embedding for a single content item and upsert into content_embeddings.
 *
 * @param supabase - Supabase client instance
 * @param contentType - Type of content (rental, production, press, career)
 * @param contentId - UUID of the content row
 * @param item - The content data to embed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function indexItem(
  supabase: any,
  contentType: ContentType,
  contentId: string,
  item: Record<string, unknown>,
): Promise<boolean> {
  if (!isEmbeddingConfigured()) {
    console.warn('[rag/indexer] Embeddings not configured — skipping index.');
    return false;
  }

  const content = buildContentString(contentType, item);
  const embedding = await generateEmbedding(content);

  if (!embedding) return false;

  const { error } = await supabase
    .from('content_embeddings')
    .upsert(
      {
        content_type: contentType,
        content_id: contentId,
        content_text: content.slice(0, 10_000), // Store truncated text for debugging
        embedding,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'content_type,content_id' },
    );

  if (error) {
    console.error(`[rag/indexer] Failed to upsert embedding for ${contentType}/${contentId}:`, error.message);
    return false;
  }

  return true;
}

// ─── Reindex All Content ────────────────────────────────────────────────────

type TableConfig = {
  table: string;
  contentType: ContentType;
  select: string;
  hrefBuilder: (item: Record<string, unknown>) => string;
};

const TABLES: TableConfig[] = [
  {
    table: 'smart_rentals',
    contentType: 'rental',
    select: 'id, title, brand, model, category, description, price_per_day, price_per_week, features, tags, slug',
    hrefBuilder: (r) => `/smart-rentals/${r.category}/${r.slug}`,
  },
  {
    table: 'smart_productions',
    contentType: 'production',
    select: 'id, title, client, project_type, year, description, tags, slug',
    hrefBuilder: (p) => `/smart-production/${p.slug}`,
  },
  {
    table: 'press',
    contentType: 'press',
    select: 'id, title, author, category, excerpt, content, slug',
    hrefBuilder: (a) => `/press/${a.slug}`,
  },
  {
    table: 'careers',
    contentType: 'career',
    select: 'id, title, department, location, employment_type, description, requirements',
    hrefBuilder: () => `/careers`,
  },
];

/**
 * Reindex all published content across all tables.
 *
 * @param supabase - Supabase client instance
 * @returns Summary with counts and duration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reindexAll(supabase: any): Promise<IndexResult> {
  const start = Date.now();
  let indexed = 0;
  let errors = 0;

  for (const { table, contentType, select } of TABLES) {
    const query = supabase
      .from(table)
      .select(select)
      .eq('is_published', true)
      .is('deleted_at', null);

    const { data, error } = await query;

    if (error) {
      console.error(`[rag/indexer] Failed to fetch ${table}:`, error.message);
      errors++;
      continue;
    }

    for (const item of (data ?? []) as Record<string, unknown>[]) {
      try {
        const success = await indexItem(supabase, contentType, item.id as string, item);
        if (success) indexed++;
        else errors++;
      } catch (err) {
        console.error(`[rag/indexer] Error indexing ${contentType}/${item.id}:`, err instanceof Error ? err.message : err);
        errors++;
      }
    }
  }

  const duration = Date.now() - start;
  console.log(`[rag/indexer] Reindex complete: ${indexed} indexed, ${errors} errors, ${duration}ms`);

  return { indexed, errors, duration };
}
