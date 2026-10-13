import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { geminiEmbedding } from '@/lib/rag/embeddings/gemini';

describe('gemini embedding provider', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('asks gemini-embedding-2 for 768 dimensions and returns a unit vector', async () => {
    const values = Array.from({ length: 768 }, (_, i) => (i % 7) - 3);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: { values } })));
    vi.stubGlobal('fetch', fetchMock);

    const out = await geminiEmbedding.generateEmbedding('Canon R5 rental');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('models/gemini-embedding-2:embedContent');
    expect(JSON.parse(init.body).outputDimensionality).toBe(768);
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(out).toHaveLength(768);
    expect(Math.sqrt(out.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
  });

  it('fails loudly on an error status or the wrong size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    await expect(geminiEmbedding.generateEmbedding('x')).rejects.toThrow(/404/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: { values: [1, 2, 3] } }))));
    await expect(geminiEmbedding.generateEmbedding('x')).rejects.toThrow(/expected 768/);
  });
});
