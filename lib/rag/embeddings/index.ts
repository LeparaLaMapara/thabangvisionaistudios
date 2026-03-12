import type { EmbeddingProvider } from './types';
import { geminiEmbedding } from './gemini';
import { openaiEmbedding } from './openai';

// Re-export types for convenience
export type { EmbeddingProvider } from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, EmbeddingProvider> = {
  gemini: geminiEmbedding,
  openai: openaiEmbedding,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.EMBEDDING_PROVIDER ?? 'gemini').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[rag/embeddings] Unknown EMBEDDING_PROVIDER="${providerName}". Falling back to gemini. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active embedding provider, determined by `EMBEDDING_PROVIDER` env var.
 * Defaults to Gemini (free) if not set or unrecognized.
 *
 * NOTE: If you switch providers, you MUST reindex all content via
 * POST /api/admin/reindex because vector dimensions change.
 *
 *   gemini → 768 dimensions (free)
 *   openai → 1536 dimensions (paid)
 */
export const embedding: EmbeddingProvider = providers[providerName] ?? geminiEmbedding;

// ─── Convenience re-exports ─────────────────────────────────────────────────
// Delegate to the active provider for backward compatibility.

export function isEmbeddingConfigured(): boolean {
  return embedding.isConfigured();
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!embedding.isConfigured()) {
    console.warn(`[rag/embeddings] ${embedding.name} not configured — skipping.`);
    return null;
  }

  if (!text || !text.trim()) {
    console.warn('[rag/embeddings] Empty text — skipping.');
    return null;
  }

  return embedding.generateEmbedding(text.trim());
}
