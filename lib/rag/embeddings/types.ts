// ─── Embedding Provider Abstraction ──────────────────────────────────────────

/**
 * Unified embedding provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `EMBEDDING_PROVIDER` env var in `lib/rag/embeddings/index.ts`.
 */
export interface EmbeddingProvider {
  /** Provider identifier (e.g., 'gemini', 'openai') */
  readonly name: string;

  /** Number of dimensions in the output vector */
  readonly dimensions: number;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /**
   * Generate a vector embedding for the given text.
   *
   * @param text - The text to embed (will be truncated if too long)
   * @returns Float array of length `dimensions`
   */
  generateEmbedding(text: string): Promise<number[]>;
}
