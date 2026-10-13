import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

/**
 * Any configured provider takes over. Replays the live outage of 2026-09-27:
 * Claude answered "credit balance is too low" (a 400), nothing else was tried,
 * and customers saw Anthropic's billing message.
 */

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

function creditError(): APICallError {
  return new APICallError({
    message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
}

const failing = (err: () => unknown) => new MockLanguageModelV3({
  doStream: async () => { throw err(); },
  doGenerate: async () => { throw err(); },
});

const answering = (text: string) => new MockLanguageModelV3({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: text },
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ],
    }),
  }),
  doGenerate: async () => ({
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  }),
});

// Which model each provider returns in a test.
const models: Record<string, MockLanguageModelV3> = {};
vi.mock('@/lib/ai/registry', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/registry')>();
  return { ...real, buildModel: (e: { provider: string }) => models[e.provider] };
});

const { shouldFailover, byHealth, markFailed, resetHealth, ASSISTANT_UNAVAILABLE } = await import('@/lib/ai/health');
const { streamWithFallback, streamOrder } = await import('@/lib/ai/resilient-stream');
const { generateWithFallback } = await import('@/lib/ai/resilient');

const KEYS = ['ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'AI_LOCAL_BASE_URL',
  'AI_SMART_PROVIDER', 'AI_SMART_MODEL', 'AI_FALLBACK_CHAIN', 'AI_ALLOW_PROPRIETARY', 'AI_PROVIDER'];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetHealth();
  for (const k of Object.keys(models)) delete models[k];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

describe('shouldFailover', () => {
  it('hands over on an out-of-credit 400 (the live outage)', () => {
    expect(shouldFailover(creditError())).toBe(true);
  });
  it('stops on a genuinely malformed request', () => {
    const bad = new APICallError({ message: 'messages: roles must alternate', url: 'x', requestBodyValues: {}, statusCode: 400, isRetryable: false });
    expect(shouldFailover(bad)).toBe(false);
  });
  it('hands over on key, permission, rate-limit and server errors', () => {
    for (const statusCode of [401, 403, 404, 429, 500, 503]) {
      expect(shouldFailover(new APICallError({ message: 'x', url: 'x', requestBodyValues: {}, statusCode, isRetryable: false }))).toBe(true);
    }
  });
});

describe('the order providers are tried in', () => {
  it('puts every configured provider behind the preferred one, each with a tool model', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    const order = streamOrder('smart');
    expect(order.map((e) => e.provider)).toEqual(['anthropic', 'groq', 'google']);
    expect(order.every((e) => e.tools)).toBe(true);
  });

  it('moves a provider that just ran out of credit to the back', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    markFailed('anthropic', creditError());
    expect(streamOrder('smart').map((e) => e.provider)).toEqual(['google', 'anthropic']);
  });

  it('never drops a cooling provider entirely', () => {
    const entries = [{ provider: 'anthropic' }, { provider: 'google' }] as never;
    markFailed('anthropic', creditError());
    markFailed('google', creditError());
    expect(byHealth(entries)).toHaveLength(2);
  });
});

describe('streaming chat takes over', () => {
  it('answers from Gemini when Claude is out of credit', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    models.anthropic = failing(creditError);
    models.google = answering('The Sony A7 III is a good choice.');
    const served: string[] = [];
    const body = await readAll(streamWithFallback({
      ref: 'smart',
      messages: [{ role: 'user', content: 'Which camera for a wedding?' }],
      onServed: (e) => served.push(e.provider),
    }));
    expect(body).toContain('Sony A7 III');
    expect(body).not.toContain('credit balance');
    expect(served).toEqual(['google']);
  });

  it('works the same with Groq or a local model taking over', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.AI_LOCAL_BASE_URL = 'http://localhost:11434/v1';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    models.anthropic = failing(creditError);
    models.local = answering('Local model here.');
    expect(await readAll(streamWithFallback({ ref: 'smart', messages: [{ role: 'user', content: 'hi' }] }))).toContain('Local model here.');
  });

  it('shows customers a plain message, never a provider error, when every provider fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    models.anthropic = failing(creditError);
    const body = await readAll(streamWithFallback({ ref: 'smart', messages: [{ role: 'user', content: 'hi' }] }));
    expect(body).toContain(ASSISTANT_UNAVAILABLE.slice(0, 30));
    expect(body).not.toContain('credit balance');
  });

  it('tells the caller once, before the stream closes, whether a reply was served (Phase 5 usage slots)', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    models.anthropic = failing(creditError);
    models.google = answering('Short.');
    const settled: boolean[] = [];
    // A slow settle: the stream must not close before it has finished.
    await readAll(streamWithFallback({
      ref: 'smart',
      messages: [{ role: 'user', content: 'hi' }],
      onSettled: async (served) => { await new Promise((r) => setTimeout(r, 30)); settled.push(served); },
    }));
    expect(settled).toEqual([true]);

    models.google = failing(creditError);
    resetHealth();
    const failed: boolean[] = [];
    await readAll(streamWithFallback({ ref: 'smart', messages: [{ role: 'user', content: 'hi' }], onSettled: async (served) => { failed.push(served); } }));
    expect(failed).toEqual([false]);
  });
});

describe('non-streaming calls (WhatsApp) take over too', () => {
  it('hands an out-of-credit 400 to the next provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GROQ_API_KEY = 'q';
    process.env.AI_SMART_PROVIDER = 'anthropic';
    models.anthropic = failing(creditError);
    models.groq = answering('Qwen here.');
    const out = await generateWithFallback({ ref: 'smart', prompt: 'hi' });
    expect(out.text).toBe('Qwen here.');
    expect(out.servedBy).toBe('groq');
    expect(out.attempts[0].provider).toBe('anthropic');
  });
});
