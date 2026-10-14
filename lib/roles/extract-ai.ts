import { GoogleGenerativeAI } from '@google/generative-ai';
import { unzipSync, strFromU8 } from 'fflate';
import { trackedCompletion } from '@/lib/ai/tracked';
import { firstJsonObject } from '@/lib/ai/json-answer';
import { resolveEntry } from '@/lib/ai/registry';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';
import { buildExtractPrompt, sanitizeFacts, stripPII, EMPTY_FACTS, type ProfileFacts } from './facts';

/**
 * Server side of facts extraction (agent 'profile-extract').
 *
 * A PDF, a photo of a CV or a voice note goes to Gemini as inline data; a
 * Word file is unzipped and read as text first. Whatever the model returns
 * is cleaned by sanitizeFacts (strict schema, PII stripped). Nothing is
 * logged: not the file, not the text, not the facts. With no AI key it
 * returns empty facts and the person types them on the review screen.
 */

const AGENT = UBUNYE_AGENTS['profile-extract'];

export type ExtractInput =
  | { kind: 'cv'; mime: string; data: Buffer }
  | { kind: 'voice'; mime: string; data: Buffer }
  | { kind: 'text'; text: string };

/** The text of a .docx (word/document.xml), tags removed. */
export function docxText(data: Buffer): string {
  try {
    const files = unzipSync(new Uint8Array(data), { filter: (f) => f.name === 'word/document.xml' });
    const xml = files['word/document.xml'];
    if (!xml) return '';
    return strFromU8(xml)
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .trim()
      .slice(0, 20_000);
  } catch {
    return '';
  }
}

function modelId(): string {
  const fast = resolveEntry('fast');
  return fast.provider === 'google' ? fast.modelId : AGENT.model;
}

export async function extractFacts(input: ExtractInput, userId: string): Promise<{ facts: ProfileFacts; source: 'ai' | 'none' }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { facts: { ...EMPTY_FACTS }, source: 'none' };

  // Word files become text; everything else the model reads itself.
  let parts: (string | { inlineData: { mimeType: string; data: string } })[];
  if (input.kind === 'text') {
    parts = [buildExtractPrompt('text', stripPII(input.text))];
  } else if (input.kind === 'cv' && /word|officedocument/.test(input.mime)) {
    parts = [buildExtractPrompt('text', stripPII(docxText(input.data)))];
  } else {
    parts = [{ inlineData: { mimeType: input.mime, data: input.data.toString('base64') } }, buildExtractPrompt(input.kind)];
  }

  const id = modelId();
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: id });
  try {
    const facts = await trackedCompletion<ProfileFacts>({
      agentId: AGENT.id,
      provider: 'google',
      model: id,
      userId,
      call: async () => {
        const res = await model.generateContent(parts);
        const meta = res.response.usageMetadata;
        return {
          result: sanitizeFacts(firstJsonObject(res.response.text())),
          usage: { inputTokens: meta?.promptTokenCount ?? 0, outputTokens: meta?.candidatesTokenCount ?? 0 },
        };
      },
    });
    return { facts, source: 'ai' };
  } catch {
    console.error('[profile-extract] model failed');
    return { facts: { ...EMPTY_FACTS }, source: 'none' };
  }
}
