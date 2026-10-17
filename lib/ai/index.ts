import type { LanguageModel } from 'ai';
import { resolveModel, resolveModelId, modelRegistry } from './registry';

// ─── AI Gateway — public surface ────────────────────────────────────────────
//
// The provider/model resolution now lives in ./registry (config-driven, env-
// overridable, local-capable) and failover in ./resilient. This file keeps the
// small stable API the rest of the app already imports, so nothing downstream
// changed when the gateway grew underneath it.
//
// - getModel / getModelId : the configured default model
// - routeQuery            : cheap-vs-smart cost routing for a single message
//
// For reliability-critical, non-streaming calls, prefer generateWithFallback
// from ./resilient, which adds timeout + provider failover.

export { resolveModel, resolveModelId, modelRegistry } from './registry';
export { generateWithFallback, isRetryable } from './resilient';
export type { Provider, Tier, ModelEntry } from './registry';

/** The default model id for the configured provider (env: AI_PROVIDER). */
export function getModelId(): string {
  return resolveModelId();
}

/** The default model for the configured provider. */
export function getModel(): LanguageModel {
  return resolveModel();
}

// ─── Multi-Model Routing ────────────────────────────────────────────────────
// Routes a message to the cheap (fast) or capable (smart) model by a cheap
// heuristic, so simple turns do not pay for the expensive model. Backed by the
// registry, so which model each tier maps to — including a local one — is
// config, not code.

export type RouteResult = {
  model: LanguageModel;
  modelId: string;
  tier: 'fast' | 'smart';
};

/** Patterns that mark a turn as needing the capable model. */
const COMPLEX_PATTERNS = [
  /\b(book|hire|quote|invoice|pay|budget|cost|pricing|calculate)\b/i,
  /\b(brief|storyboard|shot\s*list|treatment|proposal|pitch|concept)\b/i,
  /\b(compare|recommend|analyze|plan|strategy|advise|suggest\s+(?:a|the|best))\b/i,
  /\b(contract|agreement|terms|license|copyright|release)\b/i,
  /\b(how\s+(?:do|can|should|would)\s+(?:i|we|you))\b/i,
];

/**
 * Patterns that mark a turn as simple enough for the fast model, which runs
 * with tools off. Greetings, thanks and contact questions only: a short real
 * request ("photographer tomorrow jhb") must reach the tools, so length alone
 * never makes a turn simple.
 */
export const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howzit|sawubona|dumela|molo|good\s*(morning|afternoon|evening))[\s!?.]*$/i,
  /^(what(?:'s| is) (?:your|the) (?:name|email|phone|address|hours|location))[\s?.!]*$/i,
  /^(yes|no|ok|okay|sure|thanks|thank you|cool|great|perfect)[\s!?.]*$/i,
];

/**
 * Choose a model for one user message.
 *
 * Only routes when a distinct fast tier is actually configured AND the default
 * provider is the smart one — otherwise it returns the configured default
 * unchanged, so a single-provider or local-only setup is never forced onto a
 * model it does not have.
 */
export function routeQuery(userMessage: string): RouteResult {
  const registry = modelRegistry();
  const smart = registry.smart;
  const fast = registry.fast;

  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  const fastAvailable =
    fast.provider === 'google'
      ? !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
      : fast.provider === 'local'
        ? !!process.env.AI_LOCAL_BASE_URL
        : true;

  // Route only when the default is the smart provider and a real fast tier exists.
  if (provider !== smart.provider || !fastAvailable) {
    return { model: resolveModel(), modelId: resolveModelId(), tier: 'smart' };
  }

  const isComplex = COMPLEX_PATTERNS.some((p) => p.test(userMessage));
  const isSimple = SIMPLE_PATTERNS.some((p) => p.test(userMessage));

  if (isSimple && !isComplex) {
    return { model: resolveModel('fast'), modelId: fast.modelId, tier: 'fast' };
  }
  return { model: resolveModel('smart'), modelId: smart.modelId, tier: 'smart' };
}
