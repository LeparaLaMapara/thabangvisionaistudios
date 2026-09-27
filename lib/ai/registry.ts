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
  /** The provider's own model id, e.g. 'claude-sonnet-5'. */
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

/**
 * May a proprietary model (Claude, GPT, Gemini) serve when the preferred one
 * fails? Yes by default: the owner's rule since 2026-09-27 is that ANY
 * configured provider takes over, so the assistant never goes dark because one
 * account ran out of credit. Open-weight providers are still tried first.
 * Set AI_ALLOW_PROPRIETARY=false to keep the chain open-weight only.
 */
export function proprietaryAllowed(): boolean {
  return env('AI_ALLOW_PROPRIETARY') !== 'false';
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
    case 'anthropic': return 'claude-sonnet-5';
    case 'openai':    return 'gpt-4o';
    case 'google':    return 'gemini-3.6-flash';
    case 'local':     return 'qwen2.5';
    // Groq's Qwen id. Overridable, since Groq's naming has moved
    // (qwen-2.5-32b -> qwen/qwen3-32b). The tool-calling test will surface a
    // wrong id immediately as a 404.
    case 'groq':      return env('AI_GROQ_MODEL') ?? 'qwen/qwen3.8-27b';
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
      // Reverted to Gemini Flash after gemma-3-27b-it — an id NOT served by the
      // Gemini API for text generation — broke the fast tier in production. It
      // is proprietary, but a working model beats a broken open one. To make
      // this open, set AI_FAST_MODEL to a Gemma id VALIDATED against the live
      // Google key (the model list has the served ids); do not guess it.
      modelId: env('AI_FAST_MODEL') ?? 'gemini-3.6-flash',
      tier: 'fast',
      openWeight: false,
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
    // gemma id must be validated against the live Google model list before use.
    'gemma':    { provider: 'google', modelId: env('AI_GEMMA_MODEL')   ?? 'gemma-3-27b-it',  tier: 'fast',  openWeight: true, tools: false },
    // Groq — hosted, OpenAI-compatible, serves open-weight Qwen fast and cheap.
    'groq':     { provider: 'groq',  modelId: env('AI_GROQ_MODEL')     ?? 'qwen/qwen3.8-27b',  tier: 'smart', openWeight: true, tools: true },
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
      return groq.chat(entry.modelId);
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
      // .chat(): OpenAI-compatible runtimes serve chat completions, not the
      // Responses API the bare call defaults to.
      return local.chat(entry.modelId);
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

export const PROVIDERS: readonly Provider[] = ['local', 'groq', 'google', 'anthropic', 'openai'];

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** Whether a provider has what it needs to be called (a key, or a local base URL). */
export function isConfigured(p: Provider): boolean {
  switch (p) {
    case 'anthropic': return !!env('ANTHROPIC_API_KEY');
    case 'openai':    return !!env('OPENAI_API_KEY');
    case 'google':    return !!env('GOOGLE_GENERATIVE_AI_API_KEY');
    case 'local':     return !!env('AI_LOCAL_BASE_URL');
    case 'groq':      return !!env('GROQ_API_KEY');
  }
}

/**
 * The model a provider serves when it TAKES OVER a request: its capable,
 * tool-calling model, never its cheap "fast" one. Without this, failing over to
 * Google picked the fast tier (tools off), which the streaming chat then had to
 * skip, so a Claude outage left nothing to take over.
 */
export function providerDefault(p: Provider): ModelEntry {
  const smart = smartEntry();
  if (smart.provider === p) return smart;
  switch (p) {
    case 'anthropic': return { provider: p, modelId: env('AI_ANTHROPIC_MODEL') ?? 'claude-sonnet-5', tier: 'smart', openWeight: false, tools: true };
    case 'openai':    return { provider: p, modelId: env('AI_OPENAI_MODEL') ?? 'gpt-4o', tier: 'smart', openWeight: false, tools: true };
    case 'google':    return { provider: p, modelId: env('AI_GOOGLE_MODEL') ?? 'gemini-3.6-flash', tier: 'smart', openWeight: false, tools: true };
    case 'groq':      return { provider: p, modelId: env('AI_GROQ_MODEL') ?? 'qwen/qwen3.8-27b', tier: 'smart', openWeight: true, tools: true };
    case 'local':     return { provider: p, modelId: env('AI_LOCAL_MODEL') ?? 'qwen2.5', tier: 'smart', openWeight: true, tools: env('AI_LOCAL_TOOLS') !== 'false' };
  }
}

/**
 * The provider failover order, from env or a sane default.
 *
 * Only providers that are actually configured (have a key, or a local base URL)
 * are included, so the chain never falls through to a backend that will 401.
 */
export function fallbackChain(): Provider[] {
  // An explicit AI_FALLBACK_CHAIN sets the order; otherwise open-weight first
  // (self-hosted, then Groq), then the hosted proprietary providers.
  const raw = env('AI_FALLBACK_CHAIN');
  let requested: Provider[] = raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(isProvider)
    : [...PROVIDERS];
  if (!proprietaryAllowed()) {
    // Google stays: it also serves the open-weight Gemma family.
    requested = requested.filter((p) => p !== 'anthropic' && p !== 'openai');
  }
  return [...new Set(requested)].filter(isConfigured);
}
