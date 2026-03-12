import type { AIProvider } from './types';
import { anthropic } from './anthropic';
import { gemini } from './gemini';
import { openai } from './openai';

// Re-export types for convenience
export type {
  AIProvider,
  Message,
  MessageRole,
  SendMessageOptions,
  SendMessageResult,
  StreamMessageResult,
} from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, AIProvider> = {
  anthropic,
  gemini,
  openai,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[ai] Unknown AI_PROVIDER="${providerName}". Falling back to anthropic. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active AI provider, determined by `AI_PROVIDER` env var.
 * Defaults to Anthropic (Claude) if not set or unrecognized.
 */
export const ai: AIProvider = providers[providerName] ?? anthropic;
