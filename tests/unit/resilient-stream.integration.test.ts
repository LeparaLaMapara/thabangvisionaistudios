import { describe, it, expect, afterEach } from 'vitest';
import { streamWithFallback } from '@/lib/ai/resilient-stream';

// Live failover proof. Skipped unless GROQ_API_KEY is present.
describe.skipIf(!process.env.GROQ_API_KEY)('streamWithFallback — live failover', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GROQ_MODEL;
  });

  it('fails over from a dead first provider to Groq, and streams real content', async () => {
    // First attempt: OpenAI with NO key -> errors before any content (auth
    // fault at connection). The open-weight chain then reaches Groq/Qwen, which
    // answers. Proves: the error does not leak, and Qwen's content is served.
    delete process.env.OPENAI_API_KEY;
    process.env.AI_GROQ_MODEL = 'qwen/qwen3.8-27b';

    let servedBy = '';
    let failovers = -1;
    const res = streamWithFallback({
      ref: 'openai',                       // dead first attempt (no key)
      messages: [{ role: 'user', content: 'Reply with exactly: working' }],
      onServed: (entry, n) => { servedBy = entry.provider; failovers = n; },
    });

    const text = await res.text();
    console.log('servedBy:', servedBy, '| failovers:', failovers, '| bytes:', text.length);
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).not.toContain('all streaming providers failed');
    expect(servedBy).toBe('groq');        // Qwen via Groq served it
    expect(failovers).toBeGreaterThan(0); // it did fail over, not serve first
  }, 60_000);

  it('serves the first provider directly when it works (no needless failover)', async () => {
    process.env.AI_GROQ_MODEL = 'qwen/qwen3.8-27b';
    let failovers = -1;
    const res = streamWithFallback({
      ref: 'groq',
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      onServed: (_e, n) => { failovers = n; },
    });
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(failovers).toBe(0);            // served on the first try
  }, 60_000);
});
