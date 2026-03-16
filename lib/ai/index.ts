import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// ─── Vercel AI SDK Provider Wrapper ─────────────────────────────────────────

export function getModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();

  switch (provider) {
    case 'anthropic':
      return anthropic('claude-sonnet-4-20250514');
    case 'openai':
      return openai('gpt-4o');
    case 'gemini':
      return google('gemini-2.0-flash');
    default:
      return anthropic('claude-sonnet-4-20250514');
  }
}
