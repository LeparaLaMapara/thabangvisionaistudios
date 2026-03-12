// ─── RAG Retrieval ───────────────────────────────────────────────────────────
// Search by embedding similarity using Supabase match_content RPC.

import { generateEmbedding } from './embeddings';
import type { ContentType } from './indexer';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SimilarityResult = {
  content_type: ContentType;
  content_id: string;
  content_text: string;
  similarity: number;
};

export type RetrievalOptions = {
  /** Maximum number of results (default 5) */
  limit?: number;
  /** Minimum similarity threshold 0–1 (default 0.5) */
  threshold?: number;
  /** Filter to specific content types */
  contentTypes?: ContentType[];
};

// ─── Search ─────────────────────────────────────────────────────────────────

/**
 * Search for similar content using vector similarity.
 *
 * Generates an embedding for the query, then calls the `match_content`
 * Supabase RPC function to find the most similar stored embeddings.
 *
 * @param supabase - Supabase client instance
 * @param query - Natural language search query
 * @param options - Search parameters
 * @returns Ranked results with similarity scores, or empty array if not configured
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function searchSimilar(
  supabase: any,
  query: string,
  options?: RetrievalOptions,
): Promise<SimilarityResult[]> {
  const limit = options?.limit ?? 5;
  const threshold = options?.threshold ?? 0.5;

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_content', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: limit,
    ...(options?.contentTypes && options.contentTypes.length > 0
      ? { filter_types: options.contentTypes }
      : {}),
  });

  if (error) {
    console.error('[rag/retrieval] match_content RPC error:', error.message);
    return [];
  }

  return (data ?? []) as SimilarityResult[];
}

/**
 * Format retrieval results into a context string for the AI system prompt.
 */
export function formatRetrievalContext(results: SimilarityResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map((r, i) =>
    `[${i + 1}] (${r.content_type}, similarity: ${r.similarity.toFixed(3)})\n${r.content_text}`
  );

  return `===== RELEVANT CONTEXT (from vector search) =====\n${lines.join('\n\n')}`;
}
