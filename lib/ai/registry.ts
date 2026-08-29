import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

/**
 * The model registry — the config-driven core of the AI gateway.
 *
 * The gateway used to be a switch over three hardcoded cloud model ids baked
 * into code. Adding a model, changing which one runs, or pointing at a local
 * model all meant editing a source file, and the pinned id ("claude-sonnet-4")
 * was already stale. A gateway's models are data, not code.
 *
 * This registry is that data. It resolves a reference — a provider key
 * ("anthropic"), a tier ("smart" / "fast"), a "provider:model" string, or
 * "local" — to a constructed LanguageModel, and every id is overridable by env
 * so a model can be swapped or a new one tried with no deploy.
 *
 * Crucially it adds the thing the abstraction was missing: LOCAL and any
 * OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, LocalAI, a private
 * gateway). Those all speak the OpenAI wire format, so the OpenAI provider
 * pointed at a base URL reaches them with no extra dependency. "Any agent,
 * locally or through an API" becomes one env var.
 */

export type Provider = 'anthropic' | 'openai' | 'google' | 'local';
export type Tier = 'smart' | 'fast';

export interface ModelEntry {
  provider: Provider;
  /** The provider's own model id, e.g. 'claude-sonnet-4-20250514'. */
  modelId: string;
  tier: Tier;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

/**
 * The named models the gateway knows. Ids default to what production runs today
 * and are each overridable, so nothing changes silently — but a swap is one env
 * var, not a code edit.
 *
 * Defaults are intentionally the current pinned ids, not "the newest model":
 * changing which model serves production is a decision with cost and behaviour
 * consequences, and belongs to whoever sets the env, not to this refactor.
 */
export function modelRegistry(): Record<string, ModelEntry> {
  const registry: Record<string, ModelEntry> = {
    smart: {
      provider: 'anthropic',
      modelId: env('AI_SMART_MODEL') ?? 'claude-sonnet-4-20250514',
      tier: 'smart',
    },
    fast: {
      provider: 'google',
      modelId: env('AI_FAST_MODEL') ?? 'gemini-2.0-flash',
      tier: 'fast',
    },
    openai: {
      provider: 'openai',
      modelId: env('AI_OPENAI_MODEL') ?? 'gpt-4o',
      tier: 'smart',
    },
  };

  // A local / OpenAI-compatible model exists only when a base URL is set, so
  // the gateway does not advertise a backend that is not there.
  const localBase = env('AI_LOCAL_BASE_URL');
  if (localBase) {
    registry.local = {
      provider: 'local',
      modelId: env('AI_LOCAL_MODEL') ?? 'llama3.1',
      tier: env('AI_LOCAL_TIER') === 'fast' ? 'fast' : 'smart',
    };
  }

  return registry;
}

/** Construct a LanguageModel for one registry entry. */
export function buildModel(entry: ModelEntry): LanguageModel {
  switch (entry.provider) {
    case 'anthropic':
      return createAnthropic()(entry.modelId);
    case 'openai':
      return createOpenAI()(entry.modelId);
    case 'google':
      return createGoogleGenerativeAI()(entry.modelId);
    case 'local': {
      // Any OpenAI-compatible endpoint. Ollama, vLLM, LM Studio and LocalAI all
      // expose `/v1`; most ignore the key but the SDK requires a non-empty one.
      const baseURL = env('AI_LOCAL_BASE_URL');
      if (!baseURL) {
        throw new Error('[ai/registry] local model requested but AI_LOCAL_BASE_URL is not set');
      }
      const local = createOpenAI({
        baseURL,
        apiKey: env('AI_LOCAL_API_KEY') ?? 'local',
        name: 'local',
      });
      return local(entry.modelId);
    }
  }
}

/**
 * Resolve a reference to a registry entry.
 *
 * Accepts, in order of precedence:
 *   - "provider:model"     an explicit pair, e.g. "openai:gpt-4o-mini"
 *   - a registry name      "smart" | "fast" | "openai" | "local"
 *   - a bare provider      "anthropic" | "google" | ...  (uses its default id)
 *   - undefined            the configured default provider (AI_PROVIDER)
 */
export function resolveEntry(ref?: string): ModelEntry {
  const registry = modelRegistry();

  if (ref && ref.includes(':')) {
    const [provider, modelId] = ref.split(':', 2);
    if (isProvider(provider) && modelId) {
      return { provider, modelId, tier: 'smart' };
    }
  }

  if (ref && registry[ref]) return registry[ref];

  if (ref && isProvider(ref)) {
    const named = Object.values(registry).find((e) => e.provider === ref);
    if (named) return named;
  }

  // Default: the configured provider, mapped to its registry entry.
  const provider = (env('AI_PROVIDER') ?? 'anthropic').toLowerCase();
  const byProvider = Object.values(registry).find((e) => e.provider === provider);
  return byProvider ?? registry.smart;
}

export function resolveModel(ref?: string): LanguageModel {
  return buildModel(resolveEntry(ref));
}

export function resolveModelId(ref?: string): string {
  return resolveEntry(ref).modelId;
}

function isProvider(value: string): value is Provider {
  return value === 'anthropic' || value === 'openai' || value === 'google' || value === 'local';
}

/**
 * The provider failover order, from env or a sane default.
 *
 * Only providers that are actually configured (have a key, or a local base URL)
 * are included, so the chain never falls through to a backend that will 401.
 */
export function fallbackChain(): Provider[] {
  const configured = (p: Provider): boolean => {
    switch (p) {
      case 'anthropic': return !!env('ANTHROPIC_API_KEY');
      case 'openai':    return !!env('OPENAI_API_KEY');
      case 'google':    return !!env('GOOGLE_GENERATIVE_AI_API_KEY');
      case 'local':     return !!env('AI_LOCAL_BASE_URL');
    }
  };

  const raw = env('AI_FALLBACK_CHAIN');
  const requested: Provider[] = raw
    ? raw.split(',').map((s) => s.trim()).filter(isProvider)
    : ['anthropic', 'google', 'openai', 'local'];

  const chain = requested.filter(configured);
  // De-duplicate, preserve order.
  return [...new Set(chain)];
}
