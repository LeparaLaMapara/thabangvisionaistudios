import type { EmbeddingProvider } from './types';

// ─── Gemini Embedding Provider ──────────────────────────────────────────────
// gemini-embedding-2, asked for 768 dimensions so it fits the vector(768)
// column (migration 001). text-embedding-004, the model before it, is no
// longer served by the Gemini API (checked 2026-10-13 against the model list).
//
// Called over REST: the @google/generative-ai SDK (0.24) cannot send
// outputDimensionality, and without it this model returns 3072 numbers.

const MODEL = 'gemini-embedding-2';
const DIMENSIONS = 768;
const MAX_INPUT_CHARS = 32_000; // ~8000 tokens, the model's input limit
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

/** Scale to length 1. Google returns unnormalised vectors when asked for fewer than the full 3072 dimensions. */
function normalise(v: number[]): number[] {
  const length = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return length > 0 ? v.map((x) => x / length) : v;
}

export const geminiEmbedding: EmbeddingProvider = {
  name: 'gemini',
  dimensions: DIMENSIONS,

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  },

  async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('[rag/embeddings/gemini] GEMINI_API_KEY not set.');

    const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        content: { parts: [{ text: input }] },
        outputDimensionality: DIMENSIONS,
      }),
    });
    if (!res.ok) {
      throw new Error(`[rag/embeddings/gemini] ${MODEL} returned ${res.status}`);
    }

    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const embedding = data.embedding?.values;

    if (!embedding || embedding.length !== DIMENSIONS) {
      throw new Error(
        `[rag/embeddings/gemini] Unexpected shape: got ${embedding?.length ?? 0}, expected ${DIMENSIONS}`,
      );
    }

    return normalise(embedding);
  },
};
