import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateText } from 'ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import { firstJsonObject } from '@/lib/ai/json-answer';
import { resolveEntry, resolveModel } from '@/lib/ai/registry';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';
import { buildMatchPrompt, keywordMatch, parseMatchAnswer, type MatchMode, type MatchRole, type RoleSuggestion } from './match';

/**
 * Server side of role match (agent 'role-match').
 *
 * 1. Gemma 4 (free tier) reads the words and, if given, one photo.
 * 2. If that fails, a cheap text model (the registry's fast tier) reads the words.
 * 3. If there is no AI at all, the keyword match answers.
 *
 * Only the cleaned words and the photo are sent. Nothing about the person is
 * logged: not the words, not the photo, not the answer.
 */

const AGENT = UBUNYE_AGENTS['role-match'];

export interface MatchResult {
  suggestions: RoleSuggestion[];
  source: 'ai' | 'keywords';
}

async function gemma(prompt: string, imageBase64: string | null, userId: string | null, allowed: string[]): Promise<RoleSuggestion[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: AGENT.model });
  return trackedCompletion<RoleSuggestion[] | null>({
    agentId: AGENT.id,
    provider: 'google',
    model: AGENT.model,
    userId,
    call: async () => {
      const parts = imageBase64
        ? [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, prompt]
        : [prompt];
      const res = await model.generateContent(parts);
      const meta = res.response.usageMetadata;
      return {
        result: parseMatchAnswer(firstJsonObject(res.response.text()), allowed),
        usage: { inputTokens: meta?.promptTokenCount ?? 0, outputTokens: meta?.candidatesTokenCount ?? 0 },
      };
    },
  });
}

async function fastText(prompt: string, userId: string | null, allowed: string[]): Promise<RoleSuggestion[] | null> {
  const entry = resolveEntry('fast');
  return trackedCompletion<RoleSuggestion[] | null>({
    agentId: `${AGENT.id}:text`,
    provider: entry.provider,
    model: entry.modelId,
    userId,
    call: async () => {
      const res = await generateText({ model: resolveModel('fast'), prompt, temperature: 0 });
      return {
        result: parseMatchAnswer(firstJsonObject(res.text), allowed),
        usage: { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 },
      };
    },
  });
}

export async function suggestRoles(params: {
  text: string;
  imageBase64: string | null;
  /** Roles and gear categories (matchCandidates). */
  roles: readonly MatchRole[];
  userId: string | null;
  mode: MatchMode;
}): Promise<MatchResult> {
  const { text, imageBase64, roles, userId, mode } = params;
  const allowed = roles.map((r) => r.slug);
  const prompt = buildMatchPrompt(text, roles, !!imageBase64, mode);

  try {
    const fromGemma = await gemma(prompt, imageBase64, userId, allowed);
    if (fromGemma && fromGemma.length) return { suggestions: fromGemma, source: 'ai' };
  } catch {
    console.error('[role-match] vision model failed; trying the text model');
  }
  if (text) {
    try {
      const fromText = await fastText(prompt, userId, allowed);
      if (fromText && fromText.length) return { suggestions: fromText, source: 'ai' };
    } catch {
      console.error('[role-match] text model failed; using keywords');
    }
  }
  return { suggestions: keywordMatch(text, roles, mode), source: 'keywords' };
}
