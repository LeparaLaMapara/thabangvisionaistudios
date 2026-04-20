import { GoogleGenerativeAI } from '@google/generative-ai';
import { RENTAL_CATEGORIES, type RentalCategorySlug } from '@/lib/constants';
import { trackedCompletion } from '@/lib/ai/tracked';
import type { GearIdentificationResult, IdExtractionResult } from '../types';

const MODEL_ID = 'gemma-4-31b-it';
const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: MODEL_ID });

const CATEGORY_LIST = RENTAL_CATEGORIES.map(c => `"${c.value}" (${c.label})`).join(', ');

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

function extractUsage(meta: UsageMetadata | undefined) {
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  };
}

export async function identifyGear(
  imageUrl: string,
  userId?: string | null,
): Promise<GearIdentificationResult> {
  const imageData = await fetchImageAsBase64(imageUrl);

  return trackedCompletion<GearIdentificationResult>({
    agentId: 'onboarding:identify-gear',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageData } },
        `You are an expert at identifying camera and production equipment from photos.
         Identify the equipment in this photo. Return ONLY valid JSON with:
         - brand: string (manufacturer name)
         - model: string (model name/number)
         - equipmentType: string (camera body, lens, light, drone, microphone, tripod, gimbal, monitor, recorder, other)
         - condition: "new" | "like_new" | "good" | "fair" | "for_parts"
         - category: one of these EXACT values: ${CATEGORY_LIST}
         - confidence: number 0-100

         Return ONLY the JSON object, no markdown, no explanation.`,
      ]);

      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse gear identification response');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const validCategory = RENTAL_CATEGORIES.find(c => c.value === parsed.category);
      if (!validCategory) parsed.category = 'specialized-solutions' satisfies RentalCategorySlug;

      return {
        result: parsed as unknown as GearIdentificationResult,
        usage: extractUsage(result.response.usageMetadata),
      };
    },
  });
}

export async function extractIdFields(
  imageUrl: string,
  userId?: string | null,
): Promise<IdExtractionResult> {
  const imageData = await fetchImageAsBase64(imageUrl);

  return trackedCompletion<IdExtractionResult>({
    agentId: 'onboarding:capture-id',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageData } },
        `Extract information from this South African ID document.
         Return ONLY valid JSON with:
         - firstName: string or null
         - lastName: string or null
         - idNumber: string or null
         - dateOfBirth: string (YYYY-MM-DD format) or null

         If any field is unreadable, set it to null.
         Return ONLY the JSON object, no markdown, no explanation.`,
      ]);

      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse ID extraction response');

      return {
        result: JSON.parse(jsonMatch[0]) as IdExtractionResult,
        usage: extractUsage(result.response.usageMetadata),
      };
    },
  });
}
