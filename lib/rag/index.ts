// ─── RAG Infrastructure ──────────────────────────────────────────────────────
// Vector database infrastructure for context-aware AI responses.
//
// Gated by RAG_ENABLED env var. When disabled (default), all operations
// are no-ops that return gracefully without calling external services.

export { generateEmbedding, isEmbeddingConfigured } from './embeddings';
export { indexItem, reindexAll, buildContentString } from './indexer';
export type { ContentType, IndexResult } from './indexer';
export { searchSimilar, formatRetrievalContext } from './retrieval';
export type { SimilarityResult, RetrievalOptions } from './retrieval';

/**
 * Whether RAG is enabled. When false, all indexing and retrieval
 * operations should be skipped. Controlled by `RAG_ENABLED` env var.
 */
export function isRagEnabled(): boolean {
  return process.env.RAG_ENABLED === 'true';
}
