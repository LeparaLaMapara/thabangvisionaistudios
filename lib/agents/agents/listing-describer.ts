import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { trackedCompletion } from '@/lib/ai/tracked';
import type { UbunyeAgent } from '../types';

export const listingDescriberAgent: UbunyeAgent = {
  id: 'listing-describer',
  name: 'Ubunye Listing Describer',
  description: 'Writes a title, description, and rental-includes for a rental listing from detected gear facts',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 20, pro: 40, studio: 60 },
  costTier: 'medium',
};

export interface ListingDescriberInput {
  brand: string;
  model: string;
  category: string;
  condition: string;
  city?: string | null;
}

export interface ListingDescriberOutput {
  title: string;
  description: string;
  rentalIncludes: string[];
  suggestedUpsells: string[];
}

export function buildListingDescriberPrompt(input: ListingDescriberInput): string {
  const location = input.city ?? 'South Africa';
  return `You are drafting a rental listing for a South African creative-equipment marketplace.

Gear facts:
- Brand: ${input.brand}
- Model: ${input.model}
- Category: ${input.category}
- Condition: ${input.condition}
- Owner city: ${location}

Return ONLY valid JSON with these fields:
{
  "title": "string (max 60 chars, includes brand and model, no emoji)",
  "description": "string (2 sentences, SA English, practical — who uses it and what shoots it suits, no marketing fluff)",
  "rentalIncludes": ["string", ...] (3-5 items actually included with the base rental, like body, one battery, strap, hard case — be realistic for the gear type, not aspirational),
  "suggestedUpsells": ["string", ...] (2-3 add-ons the owner could offer later — extra batteries, memory cards, tripod, lens rental — keep them obviously distinct from the included items)
}

Rules:
- No markdown, no preamble, no trailing prose — only the JSON object.
- Do not invent specs you cannot know (serial numbers, exact firmware, warranty).
- Do not use the words "passionate", "creative eye", "best-in-class".
- rentalIncludes must be concrete physical items, not services.`;
}

export function parseListingDescriberOutput(text: string): ListingDescriberOutput {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Listing describer response did not contain JSON.');
  const parsed = JSON.parse(jsonMatch[0]) as Partial<ListingDescriberOutput>;

  return {
    title: (parsed.title ?? '').toString().trim(),
    description: (parsed.description ?? '').toString().trim(),
    rentalIncludes: Array.isArray(parsed.rentalIncludes)
      ? parsed.rentalIncludes.map((s) => String(s).trim()).filter(Boolean)
      : [],
    suggestedUpsells: Array.isArray(parsed.suggestedUpsells)
      ? parsed.suggestedUpsells.map((s) => String(s).trim()).filter(Boolean)
      : [],
  };
}

/**
 * Runs the listing describer once, tracked in ai_token_usage under this
 * agent's id. Callers rate-limit it (the daily limit is
 * listingDescriberAgent.rateLimit.free). Throws when the call or the
 * parse fails; every caller treats the output as an untrusted suggestion.
 */
export async function describeListing(
  input: ListingDescriberInput,
  userId: string | null,
): Promise<ListingDescriberOutput> {
  return trackedCompletion<ListingDescriberOutput>({
    agentId: listingDescriberAgent.id,
    provider: listingDescriberAgent.provider,
    model: listingDescriberAgent.model,
    userId,
    call: async () => {
      const res = await generateText({
        model: anthropic(listingDescriberAgent.model),
        prompt: buildListingDescriberPrompt(input),
        temperature: 0.6,
      });
      return {
        result: parseListingDescriberOutput(res.text),
        usage: {
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
        },
      };
    },
  });
}
