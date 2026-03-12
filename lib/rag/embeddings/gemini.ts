import { GoogleGenerativeAI } from '@google/generative-ai';
import type { EmbeddingProvider } from './types';

// ─── Gemini Embedding Provider ──────────────────────────────────────────────
// Free tier: text-embedding-004, 768 dimensions

const MODEL = 'text-embedding-004';
const DIMENSIONS = 768;
const MAX_INPUT_CHARS = 32_000; // ~8000 tokens

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('[rag/embeddings/gemini] GEMINI_API_KEY not set.');
  return new GoogleGenerativeAI(apiKey);
}

export const geminiEmbedding: EmbeddingProvider = {
  name: 'gemini',
  dimensions: DIMENSIONS,

  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  },

  async generateEmbedding(text: string): Promise<number[]> {
    const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    const client = getClient();
    const model = client.getGenerativeModel({ model: MODEL });
    const result = await model.embedContent(input);
    const embedding = result.embedding.values;

    if (!embedding || embedding.length !== DIMENSIONS) {
      throw new Error(
        `[rag/embeddings/gemini] Unexpected shape: got ${embedding?.length ?? 0}, expected ${DIMENSIONS}`,
      );
    }

    return embedding;
  },
};
