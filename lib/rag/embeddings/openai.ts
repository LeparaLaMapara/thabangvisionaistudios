import OpenAI from 'openai';
import type { EmbeddingProvider } from './types';

// ─── OpenAI Embedding Provider ──────────────────────────────────────────────
// Paid: text-embedding-3-small, 1536 dimensions

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_INPUT_CHARS = 32_000; // ~8000 tokens

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[rag/embeddings/openai] OPENAI_API_KEY not set.');
  return new OpenAI({ apiKey });
}

export const openaiEmbedding: EmbeddingProvider = {
  name: 'openai',
  dimensions: DIMENSIONS,

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  },

  async generateEmbedding(text: string): Promise<number[]> {
    const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    const client = getClient();
    const response = await client.embeddings.create({
      model: MODEL,
      input,
      dimensions: DIMENSIONS,
    });

    const embedding = response.data[0]?.embedding;

    if (!embedding || embedding.length !== DIMENSIONS) {
      throw new Error(
        `[rag/embeddings/openai] Unexpected shape: got ${embedding?.length ?? 0}, expected ${DIMENSIONS}`,
      );
    }

    return embedding;
  },
};
