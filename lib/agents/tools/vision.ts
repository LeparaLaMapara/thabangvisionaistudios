import { GoogleGenerativeAI } from '@google/generative-ai';
import { RENTAL_CATEGORIES, type RentalCategorySlug } from '@/lib/constants';
import type { GearIdentificationResult, IdExtractionResult } from '../types';

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: 'gemma-4-31b-it' });

const CATEGORY_LIST = RENTAL_CATEGORIES.map(c => `"${c.value}" (${c.label})`).join(', ');

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export async function identifyGear(imageUrl: string): Promise<GearIdentificationResult> {
  const imageData = await fetchImageAsBase64(imageUrl);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageData,
      },
    },
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

  // Validate category against known values
  const validCategory = RENTAL_CATEGORIES.find(c => c.value === parsed.category);
  if (!validCategory) parsed.category = 'specialized-solutions' satisfies RentalCategorySlug;

  return parsed as unknown as GearIdentificationResult;
}

export async function extractIdFields(imageUrl: string): Promise<IdExtractionResult> {
  const imageData = await fetchImageAsBase64(imageUrl);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageData,
      },
    },
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

  return JSON.parse(jsonMatch[0]) as IdExtractionResult;
}
