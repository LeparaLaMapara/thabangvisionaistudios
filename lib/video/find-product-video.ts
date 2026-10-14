import { GoogleGenerativeAI } from '@google/generative-ai';
import { trackedCompletion } from '@/lib/ai/tracked';
import { firstJsonObject } from '@/lib/ai/json-answer';
import { fetchImageAsBase64Safe } from '@/lib/security/safe-fetch';
import { checkYouTubeVideo, searchYouTube, youtubeWatchUrl, type YouTubeCandidate } from './youtube';

/**
 * Find a video that explains a rental item: the maker's own video if there is
 * one, else a clear overview of the same model.
 *
 * A language model asked for a link invents one (tried 2026-10-14: 16 of 16
 * made-up ids). So YouTube's search supplies real candidates (only ones that
 * may play on other websites) and the model only CHOOSES among them, reading
 * the item's name, description and photo. The pick is checked again before
 * it is returned. Nothing is saved here: the caller decides.
 */

const MODEL_ID = 'gemma-4-31b-it';

export interface ProductVideoInput {
  title: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  description?: string | null;
  /** The listing's first photo, so the pick matches what is actually rented. */
  imageUrl?: string | null;
}

export interface ProductVideoPick {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  /** From the maker's own channel. */
  official: boolean;
  reason: string;
}

export type ProductVideoResult =
  | { found: true; pick: ProductVideoPick; candidates: number }
  | { found: false; reason: string; candidates: number };

/** What we search YouTube for: the item's name, with the brand and model when known. */
export function videoQuery(i: ProductVideoInput): string {
  const brandModel = [i.brand, i.model].filter((p): p is string => Boolean(p && p.trim())).join(' ');
  // Brand and model together are the sharpest search; listing titles are close behind.
  const base = i.brand?.trim() && i.model?.trim() ? brandModel : i.title;
  return base.replace(/\s+/g, ' ').trim().slice(0, 150);
}

/** The maker's channel: the channel name contains the brand ("DJI", "Sony | Alpha Universe"). */
export function looksOfficial(channel: string, brand: string | null | undefined, title: string): boolean {
  const b = (brand?.trim() || title.trim().split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z0-9&]/g, '');
  if (b.length < 2) return false;
  const c = channel.toLowerCase().replace(/[^a-z0-9&]/g, '');
  return c.includes(b);
}

/** The model's answer, held to the candidates it was shown. */
export function parseChoice(raw: unknown, candidates: YouTubeCandidate[]): { index: number | null; reason: string } {
  const o = (typeof raw === 'string' ? firstJsonObject(raw) : raw) as Record<string, unknown> | null;
  if (!o) return { index: null, reason: 'no answer' };
  const n = typeof o.choice === 'number' ? o.choice : typeof o.choice === 'string' && /^\d+$/.test(o.choice) ? Number(o.choice) : null;
  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 200) : '';
  if (n === null || !Number.isInteger(n) || n < 1 || n > candidates.length) return { index: null, reason: reason || 'none matched' };
  return { index: n - 1, reason };
}

export async function findProductVideo(input: ProductVideoInput, userId?: string | null): Promise<ProductVideoResult> {
  const query = videoQuery(input);
  const candidates = await searchYouTube(query, 8);
  if (candidates.length === 0) return { found: false, reason: 'YouTube found no playable videos', candidates: 0 };

  let photo: string | null = null;
  if (input.imageUrl) {
    try {
      photo = await fetchImageAsBase64Safe(input.imageUrl);
    } catch {
      photo = null; // the name and description are enough to choose
    }
  }

  const list = candidates
    .map((c, i) => `${i + 1}. "${c.title}" by ${c.channel}${looksOfficial(c.channel, input.brand, input.title) ? ' (maker\'s channel)' : ''}\n   ${c.description.replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n');
  const prompt = `We rent out this item and want one YouTube video on its page that shows customers what it is and how it works.

Item: ${input.title}
${input.brand ? `Brand: ${input.brand}\n` : ''}${input.model ? `Model: ${input.model}\n` : ''}${input.category ? `Category: ${input.category}\n` : ''}${input.description ? `Description: ${input.description.slice(0, 600)}\n` : ''}${photo ? 'The photo is the actual item.\n' : ''}
Videos found on YouTube:
${list}

Choose the best ONE. Rules:
- It must be about this exact product (same model; for a lens the same focal length and aperture; for a filter the same kind of filter). Never a different model.
- Prefer the maker's own channel (launch, introduction or product video). Otherwise a clear overview, review or "how to use" of this product.
- Not a comparison with another product, not a giveaway, not a short or meme, not mainly about something else.
- In English (our customers read English). A video with no speech is fine.
- If none fits, choose 0.

Return ONLY JSON: {"choice": <number 1-${candidates.length}, or 0>, "reason": "<one short sentence>"}`;

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = client.getGenerativeModel({ model: MODEL_ID });
  const answer = await trackedCompletion<unknown>({
    agentId: 'rentals:find-video',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const parts = photo ? [{ inlineData: { mimeType: 'image/jpeg', data: photo } }, prompt] : [prompt];
      const result = await model.generateContent(parts);
      const meta = result.response.usageMetadata;
      return {
        result: result.response.text(),
        usage: { inputTokens: meta?.promptTokenCount ?? 0, outputTokens: meta?.candidatesTokenCount ?? 0 },
      };
    },
  });

  const choice = parseChoice(answer, candidates);
  if (choice.index === null) return { found: false, reason: choice.reason || 'none of the videos matched', candidates: candidates.length };

  const c = candidates[choice.index];
  // Search said it may play elsewhere; check once more before anyone saves it.
  const check = await checkYouTubeVideo(c.id, { cache: 'no-store' });
  if (check.status === 'not_embeddable' || check.status === 'not_found') {
    return { found: false, reason: 'the chosen video cannot play on other websites', candidates: candidates.length };
  }
  return {
    found: true,
    candidates: candidates.length,
    pick: {
      videoId: c.id,
      url: youtubeWatchUrl(c.id),
      title: c.title,
      channel: c.channel,
      official: looksOfficial(c.channel, input.brand, input.title),
      reason: choice.reason,
    },
  };
}
