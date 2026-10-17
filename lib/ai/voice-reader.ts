import { GoogleGenerativeAI } from '@google/generative-ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import { providerDefault } from '@/lib/ai/registry';
import { STUDIO } from '@/lib/constants';
import { VOICE_INSTRUCTIONS, voiceText, type VoiceMime } from '@/lib/ubunye/voice';

/**
 * Transcribes a client's voice note. Gemma 4 (free) has no audio input on the
 * Gemini API ("Audio input modality is not enabled", 2026-10-17), so this
 * uses Google's chat model (Gemini Flash), at well under a cent a note.
 */

const TIMEOUT_MS = 30_000;

export type VoiceReading = { ok: true; text: string } | { ok: false; code: 'busy' | 'silent' | 'failed' };

type Part = { text?: string; thought?: boolean };

function isQuotaError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.message} ${(err as { status?: number }).status ?? ''}` : String(err);
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(s);
}

export async function transcribeVoice(base64: string, mime: VoiceMime, userId: string | null): Promise<VoiceReading> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, code: 'failed' };
  const modelId = process.env.AI_VOICE_MODEL ?? providerDefault('google').modelId;
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: modelId });
  try {
    const answer = await trackedCompletion<string>({
      agentId: 'ubunye:voice',
      provider: 'google',
      model: modelId,
      userId,
      call: async () => {
        const result = await model.generateContent(
          { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: VOICE_INSTRUCTIONS }] }] },
          { timeout: TIMEOUT_MS },
        );
        const parts = (result.response.candidates?.[0]?.content?.parts ?? []) as Part[];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join(' ');
        const usage = result.response.usageMetadata;
        return { result: text, usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 } };
      },
    });
    const text = voiceText(answer, STUDIO.security.chat.maxMessageChars);
    return text ? { ok: true, text } : { ok: false, code: 'silent' };
  } catch (err) {
    if (isQuotaError(err)) return { ok: false, code: 'busy' };
    console.error('[ubunye:voice] transcription failed:', err instanceof Error ? err.message.slice(0, 200) : err);
    return { ok: false, code: 'failed' };
  }
}
