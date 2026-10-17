import { GoogleGenerativeAI } from '@google/generative-ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import { PHOTO_INSTRUCTIONS, photoNote, type PhotoMime } from '@/lib/ubunye/photo';

/**
 * Reads a client's photo with the free Gemma 4 model (owner, 2026-10-17:
 * free models for photos, Gemini Flash keeps the chat). Gemma's free quota is
 * about 16 000 input tokens a minute for the whole site, so a busy minute is
 * expected and reported as `busy`, never retried here.
 */

const PHOTO_MODEL = process.env.AI_PHOTO_MODEL ?? 'gemma-4-26b-a4b-it';
const TIMEOUT_MS = 30_000;

export type PhotoReading =
  | { ok: true; text: string }
  | { ok: false; code: 'busy' | 'failed' };

type Part = { text?: string; thought?: boolean };

function isQuotaError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.message} ${(err as { status?: number }).status ?? ''}` : String(err);
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(s);
}

export async function readPhoto(base64: string, mime: PhotoMime, userId: string | null): Promise<PhotoReading> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, code: 'failed' };
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: PHOTO_MODEL });
  try {
    const text = await trackedCompletion<string>({
      agentId: 'ubunye:photo',
      provider: 'google',
      model: PHOTO_MODEL,
      userId,
      call: async () => {
        const result = await model.generateContent(
          {
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: PHOTO_INSTRUCTIONS }] }],
            // Minimal thinking: about 2 seconds instead of 10 to 25, same answer
            // quality on test photos (2026-10-17). The SDK types predate it.
            generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } as Record<string, unknown>,
          },
          { timeout: TIMEOUT_MS },
        );
        // Gemma 4 thinks out loud in parts marked `thought`; only the answer counts.
        const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as Part[];
        const answer = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join(' ');
        const usage = result.response.usageMetadata;
        return { result: answer, usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 } };
      },
    });
    const note = photoNote(text);
    return note ? { ok: true, text: note } : { ok: false, code: 'failed' };
  } catch (err) {
    if (isQuotaError(err)) return { ok: false, code: 'busy' };
    console.error('[ubunye:photo] read failed:', err instanceof Error ? err.message.slice(0, 200) : err);
    return { ok: false, code: 'failed' };
  }
}
