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
