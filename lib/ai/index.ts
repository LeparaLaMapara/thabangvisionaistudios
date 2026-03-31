import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// ─── Vercel AI SDK Provider Wrapper ─────────────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

export function getModelId(): string {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
  return MODEL_MAP[provider] ?? MODEL_MAP.anthropic;
}

export function getModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();

  switch (provider) {
    case 'anthropic':
      return anthropic(MODEL_MAP.anthropic);
    case 'openai':
      return openai(MODEL_MAP.openai);
    case 'gemini':
      return google(MODEL_MAP.gemini);
    default:
      return anthropic(MODEL_MAP.anthropic);
  }
}

// ─── Multi-Model Routing ────────────────────────────────────────────────────
// Routes queries to cheap (Gemini Flash) or smart (Claude Sonnet) models
// based on query complexity. Saves AI costs on simple questions.

export type RouteResult = {
  model: LanguageModel;
  modelId: string;
  tier: 'fast' | 'smart';
};

/**
 * Simple heuristic patterns that indicate a complex query needing the smart model.
 * These cover booking flows, financial calculations, creative briefs, and multi-step reasoning.
 */
const COMPLEX_PATTERNS = [
  // Booking & financial
  /\b(book|hire|quote|invoice|pay|budget|cost|pricing|calculate)\b/i,
  // Creative production planning
  /\b(brief|storyboard|shot\s*list|treatment|proposal|pitch|concept)\b/i,
  // Multi-step reasoning
  /\b(compare|recommend|analyze|plan|strategy|advise|suggest\s+(?:a|the|best))\b/i,
  // Contract/legal
  /\b(contract|agreement|terms|license|copyright|release)\b/i,
  // Complex questions (long messages)
  /\b(how\s+(?:do|can|should|would)\s+(?:i|we|you))\b/i,
];

/**
 * Patterns that indicate a simple query suitable for the fast/cheap model.
 */
const SIMPLE_PATTERNS = [
  // Greetings
  /^(hi|hello|hey|yo|sup|howzit|good\s*(morning|afternoon|evening))[\s!?.]*$/i,
  // Simple lookups
  /^(what(?:'s| is) (?:your|the) (?:name|email|phone|address|hours|location))/i,
  // Yes/no/thanks
  /^(yes|no|ok|okay|sure|thanks|thank you|cool|great|perfect)[\s!?.]*$/i,
  // Short messages (under 30 chars, no question complexity)
  /^.{1,30}$/,
];

/**
 * Classify a user message and return the appropriate model.
 *
 * Routing logic:
 * 1. If AI_PROVIDER is not 'anthropic', always use the configured provider (no routing).
 * 2. If the message matches a SIMPLE pattern and doesn't match COMPLEX, use Gemini Flash.
 * 3. If the message matches a COMPLEX pattern, use Claude Sonnet.
 * 4. For messages with tool calls needed (checked by caller), always use Claude Sonnet.
 * 5. Default: Claude Sonnet (prefer quality over cost for ambiguous queries).
 */
export function routeQuery(userMessage: string): RouteResult {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();

  // Only route when primary provider is anthropic (we route between anthropic + gemini)
  if (provider !== 'anthropic') {
    return { model: getModel(), modelId: getModelId(), tier: 'smart' };
  }

  // Check if Gemini is available
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { model: anthropic(MODEL_MAP.anthropic), modelId: MODEL_MAP.anthropic, tier: 'smart' };
  }

  const isComplex = COMPLEX_PATTERNS.some((p) => p.test(userMessage));
  const isSimple = SIMPLE_PATTERNS.some((p) => p.test(userMessage));

  if (isSimple && !isComplex) {
    return {
      model: google(MODEL_MAP.gemini),
      modelId: MODEL_MAP.gemini,
      tier: 'fast',
    };
  }

  // Default to smart model
  return {
    model: anthropic(MODEL_MAP.anthropic),
    modelId: MODEL_MAP.anthropic,
    tier: 'smart',
  };
}
