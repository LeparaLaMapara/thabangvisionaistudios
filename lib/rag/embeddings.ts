// ─── RAG Embedding Pipeline ──────────────────────────────────────────────────
// Generates vector embeddings using OpenAI text-embedding-3-small (1536 dims).

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_INPUT_CHARS = 32_000; // ~8000 tokens at ~4 chars/token

/**
 * Whether the embedding pipeline has valid credentials configured.
 */
export function isEmbeddingConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Truncate text to fit within the model's token limit.
 */
function truncateInput(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  return text.slice(0, MAX_INPUT_CHARS);
}

/**
 * Generate a vector embedding for the given text.
 *
 * @param text - The text to embed
 * @returns A 1536-dimensional float array, or null if not configured
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!isEmbeddingConfigured()) {
    console.warn('[rag/embeddings] OPENAI_API_KEY not set — skipping embedding generation.');
    return null;
  }

  if (!text || !text.trim()) {
    console.warn('[rag/embeddings] Empty text — skipping embedding generation.');
    return null;
  }

  const input = truncateInput(text.trim());

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[rag/embeddings] OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const embedding: number[] = data?.data?.[0]?.embedding;

  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`[rag/embeddings] Unexpected embedding shape: got ${embedding?.length ?? 0}, expected ${EMBEDDING_DIMENSIONS}`);
  }

  return embedding;
}
