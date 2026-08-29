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

export type Provider = 'anthropic' | 'openai' | 'google' | 'local' | 'groq';

/** Groq's OpenAI-compatible endpoint. */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export type Tier = 'smart' | 'fast';

export interface ModelEntry {
  provider: Provider;
  /** The provider's own model id, e.g. 'claude-sonnet-4-20250514'. */
  modelId: string;
  tier: Tier;
  /**
   * Whether the model's weights are openly published (Llama, Qwen, DeepSeek,
   * Gemma, Mistral-open, gpt-oss). The house policy is open-weight by default;
   * a proprietary model (Claude, GPT-4o, Gemini) is used only on explicit
   * opt-in. See preferOpenWeight().
   *
   * Note this marks the MODEL, not the cost. An open-weight model called through
   * a hosted API (Google, Groq, Together) can still bill; only self-hosting via
   * a local endpoint is truly free. See docs and AI_LOCAL_BASE_URL.
   */
  openWeight: boolean;
  /** Whether the model reliably supports tool/function calling. The Ubunye
   * assistant passes tools on every turn, so a non-tool model must not serve it. */
  tools: boolean;
}

/** Is the platform allowed to fall back to a proprietary model? Opt-in. */
export function proprietaryAllowed(): boolean {
  return env('AI_ALLOW_PROPRIETARY') === 'true';
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
/**
 * The default model id for a smart-tier provider, when AI_SMART_MODEL is unset.
 *
 * The model default has to follow the provider: setting AI_SMART_PROVIDER=local
 * with no model must not fall back to a Claude id that a local runtime cannot
 * serve. Qwen is the chosen open-weight assistant model — the strongest open
 * model at the tool-calling the booking flow needs — so it is the default for a
 * local/open smart tier.
 */
function smartDefaultModel(provider: Provider): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'openai':    return 'gpt-4o';
    case 'google':    return 'gemini-2.0-flash';
    case 'local':     return 'qwen2.5';
    // Groq's Qwen id. Overridable, since Groq's naming has moved
    // (qwen-2.5-32b -> qwen/qwen3-32b). The tool-calling test will surface a
    // wrong id immediately as a 404.
    case 'groq':      return 'qwen/qwen3-32b';
  }
}

function smartEntry(): ModelEntry {
  const provider = (env('AI_SMART_PROVIDER') as Provider) ?? 'anthropic';
  return {
    provider,
    modelId: env('AI_SMART_MODEL') ?? smartDefaultModel(provider),
    tier: 'smart',
    // Local is self-hosted open weights; anthropic/openai/google smart models
    // are proprietary.
    openWeight: provider === 'local',
    tools: true,
  };
}

export function modelRegistry(): Record<string, ModelEntry> {
  const registry: Record<string, ModelEntry> = {
    // ── Tier defaults ──
    // fast: a small open-weight model for greetings and lookups. Gemma is
    // open-weight and served by the Google key already in use for vision.
    fast: {
      provider: 'google',
      modelId: env('AI_FAST_MODEL') ?? 'gemma-3-27b-it',
      tier: 'fast',
      openWeight: true,
      tools: false,
    },
    // smart: the capable, tool-using tier. Default stays Claude because it is
    // what the assistant's tools are proven against and it is what runs today;
    // it is PROPRIETARY, so it serves only when opted in (AI_ALLOW_PROPRIETARY)
    // or explicitly referenced. Point AI_SMART_MODEL / AI_SMART_PROVIDER at an
    // open-weight tool-capable model (see the menu below) plus a runtime to make
    // the smart tier open too.
    smart: smartEntry(),

    // ── Proprietary, opt-in only ──
    openai: { provider: 'openai', modelId: env('AI_OPENAI_MODEL') ?? 'gpt-4o', tier: 'smart', openWeight: false, tools: true },

    // ── Open-weight menu ──
    // Each is one env var away (set AI_LOCAL_BASE_URL to a runtime that serves
    // it, then reference by name, or point a tier at it). IDs are the common
    // Ollama tags for the self-hosted path; hosted providers use their own ids.
    // Tool-calling flags reflect each family's function-calling support.
    'llama':    { provider: 'local', modelId: env('AI_LLAMA_MODEL')    ?? 'llama3.3',        tier: 'smart', openWeight: true, tools: true },
    'qwen':     { provider: 'local', modelId: env('AI_QWEN_MODEL')     ?? 'qwen2.5',         tier: 'smart', openWeight: true, tools: true },
    'deepseek': { provider: 'local', modelId: env('AI_DEEPSEEK_MODEL') ?? 'deepseek-r1',     tier: 'smart', openWeight: true, tools: true },
    'mistral':  { provider: 'local', modelId: env('AI_MISTRAL_MODEL')  ?? 'mistral-small',   tier: 'smart', openWeight: true, tools: true },
    'gpt-oss':  { provider: 'local', modelId: env('AI_GPT_OSS_MODEL')  ?? 'gpt-oss:20b',     tier: 'smart', openWeight: true, tools: true },
    'gemma':    { provider: 'google', modelId: env('AI_GEMMA_MODEL')   ?? 'gemma-3-27b-it',  tier: 'fast',  openWeight: true, tools: false },
    // Groq — hosted, OpenAI-compatible, serves open-weight Qwen fast and cheap.
    'groq':     { provider: 'groq',  modelId: env('AI_GROQ_MODEL')     ?? 'qwen/qwen3-32b',  tier: 'smart', openWeight: true, tools: true },
  };

  // A generic local / OpenAI-compatible model, when a base URL is set.
  const localBase = env('AI_LOCAL_BASE_URL');
  if (localBase) {
    registry.local = {
      provider: 'local',
      modelId: env('AI_LOCAL_MODEL') ?? 'llama3.3',
      tier: env('AI_LOCAL_TIER') === 'fast' ? 'fast' : 'smart',
      openWeight: true,
      tools: env('AI_LOCAL_TOOLS') !== 'false',
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
    case 'groq': {
      const key = env('GROQ_API_KEY');
      if (!key) throw new Error('[ai/registry] groq model requested but GROQ_API_KEY is not set');
      const groq = createOpenAI({ baseURL: GROQ_BASE_URL, apiKey: key, name: 'groq' });
      return groq(entry.modelId);
    }
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
      // An explicit pair is trusted as the caller asked for it. openWeight is
      // inferred from the provider (local is always open; the cloud proprietary
      // ones are not), and tool support is assumed present for an explicit ref.
      return {
        provider, modelId, tier: 'smart',
        openWeight: provider === 'local',
        tools: true,
      };
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
      case 'groq':      return !!env('GROQ_API_KEY');
    }
  };

  // Default order is open-weight first (local self-hosted, then Gemma via
  // Google), and the proprietary providers only when explicitly allowed. An
  // explicit AI_FALLBACK_CHAIN overrides the ordering entirely.
  const raw = env('AI_FALLBACK_CHAIN');
  let requested: Provider[];
  if (raw) {
    requested = raw.split(',').map((s) => s.trim()).filter(isProvider);
  } else if (proprietaryAllowed()) {
    requested = ['local', 'groq', 'google', 'anthropic', 'openai'];
  } else {
    // Open-weight only. Local and Groq (Qwen) first, then Google for Gemma.
    // The proprietary Gemini/Claude/GPT paths are left out until opted in.
    requested = ['local', 'groq', 'google'];
  }

  const chain = requested.filter(configured);
  // De-duplicate, preserve order.
  return [...new Set(chain)];
}
