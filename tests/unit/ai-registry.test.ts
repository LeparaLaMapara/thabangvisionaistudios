import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { modelRegistry, resolveEntry, resolveModelId, fallbackChain } from '@/lib/ai/registry';

const ENV_KEYS = [
  'AI_PROVIDER', 'AI_SMART_MODEL', 'AI_FAST_MODEL', 'AI_OPENAI_MODEL',
  'AI_LOCAL_BASE_URL', 'AI_LOCAL_MODEL', 'AI_LOCAL_TIER', 'AI_LOCAL_API_KEY',
  'AI_FALLBACK_CHAIN',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('modelRegistry', () => {
  it('has smart and fast tiers with the current production defaults', () => {
    const r = modelRegistry();
    expect(r.smart.provider).toBe('anthropic');
    expect(r.fast.provider).toBe('google');
    // Defaults must be the pinned ids, so nothing changes silently.
    expect(r.smart.modelId).toBe('claude-sonnet-4-20250514');
  });

  it('does NOT advertise a local model until a base URL is set', () => {
    expect(modelRegistry().local).toBeUndefined();
  });

  it('advertises a local model once AI_LOCAL_BASE_URL is set', () => {
    // The whole point: "any agent locally" is one env var.
    process.env.AI_LOCAL_BASE_URL = 'http://localhost:11434/v1';
    process.env.AI_LOCAL_MODEL = 'llama3.1';
    const r = modelRegistry();
    expect(r.local).toBeDefined();
    expect(r.local!.provider).toBe('local');
    expect(r.local!.modelId).toBe('llama3.1');
  });

  it('lets every model id be overridden by env, no code change', () => {
    process.env.AI_SMART_MODEL = 'claude-opus-5';
    process.env.AI_FAST_MODEL = 'gemini-3-flash';
    const r = modelRegistry();
    expect(r.smart.modelId).toBe('claude-opus-5');
    expect(r.fast.modelId).toBe('gemini-3-flash');
  });
});

describe('resolveEntry', () => {
  it('resolves a tier name', () => {
    expect(resolveEntry('fast').tier).toBe('fast');
  });

  it('resolves an explicit provider:model pair', () => {
    const e = resolveEntry('openai:gpt-4o-mini');
    expect(e.provider).toBe('openai');
    expect(e.modelId).toBe('gpt-4o-mini');
  });

  it('resolves a bare provider to its default model', () => {
    expect(resolveEntry('google').provider).toBe('google');
  });

  it('resolves a local reference when configured', () => {
    process.env.AI_LOCAL_BASE_URL = 'http://localhost:11434/v1';
    process.env.AI_LOCAL_MODEL = 'qwen2.5';
    expect(resolveModelId('local')).toBe('qwen2.5');
  });

  it('defaults to the configured provider when the ref is unknown', () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'x';
    expect(resolveEntry('nonsense').provider).toBe('anthropic');
  });
});

describe('fallbackChain', () => {
  it('includes only providers that are actually configured', () => {
    // Anthropic + Google keyed, OpenAI not: the chain must not fall through to
    // a provider that would 401.
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    const chain = fallbackChain();
    expect(chain).toContain('anthropic');
    expect(chain).toContain('google');
    expect(chain).not.toContain('openai');
    expect(chain).not.toContain('local');
  });

  it('adds local to the chain when a base URL is present', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.AI_LOCAL_BASE_URL = 'http://localhost:11434/v1';
    expect(fallbackChain()).toContain('local');
  });

  it('honours an explicit AI_FALLBACK_CHAIN order, filtered to configured', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.AI_FALLBACK_CHAIN = 'google,anthropic,openai';
    expect(fallbackChain()).toEqual(['google', 'anthropic']);
  });

  it('is empty when nothing is configured, rather than inventing a backend', () => {
    expect(fallbackChain()).toEqual([]);
  });
});

describe('buildModel — constructs real SDK models without throwing', () => {
  // Guards against a v6 API mismatch that the build's type-check would miss,
  // since the build never executes the construction.
  it('builds anthropic, openai and google models', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.OPENAI_API_KEY = 'test';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test';
    const { buildModel } = await import('@/lib/ai/registry');
    expect(buildModel({ provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', tier: 'smart' })).toBeTruthy();
    expect(buildModel({ provider: 'openai', modelId: 'gpt-4o', tier: 'smart' })).toBeTruthy();
    expect(buildModel({ provider: 'google', modelId: 'gemini-2.0-flash', tier: 'fast' })).toBeTruthy();
  });

  it('builds a local OpenAI-compatible model against a base URL', async () => {
    process.env.AI_LOCAL_BASE_URL = 'http://localhost:11434/v1';
    const { buildModel } = await import('@/lib/ai/registry');
    expect(buildModel({ provider: 'local', modelId: 'llama3.1', tier: 'smart' })).toBeTruthy();
  });

  it('refuses to build a local model with no base URL, rather than silently misconfiguring', async () => {
    delete process.env.AI_LOCAL_BASE_URL;
    const { buildModel } = await import('@/lib/ai/registry');
    expect(() => buildModel({ provider: 'local', modelId: 'llama3.1', tier: 'smart' })).toThrow();
  });
});
