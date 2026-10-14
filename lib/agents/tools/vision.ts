import { GoogleGenerativeAI } from '@google/generative-ai';
import { RENTAL_CATEGORIES, type RentalCategorySlug } from '@/lib/constants';
import { trackedCompletion } from '@/lib/ai/tracked';
import { firstJsonObject } from '@/lib/ai/json-answer';
import { fetchImageAsBase64Safe } from '@/lib/security/safe-fetch';
import type {
  FaceMatchResult,
  GearIdentificationResult,
} from '../types';

const MODEL_ID = 'gemma-4-31b-it';
const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = client.getGenerativeModel({ model: MODEL_ID });

const CATEGORY_LIST = RENTAL_CATEGORIES.map(c => `"${c.value}" (${c.label})`).join(', ');

/**
 * Fetch an image the SERVER chose (matchFaces: short-lived Supabase Storage
 * signed URLs made by /api/verifications). Never pass a user-supplied URL
 * here; those go through fetchImageAsBase64Safe (security INJ-2).
 */
async function fetchTrustedImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
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
  // imageUrl comes from the person (the route checks it is our own upload);
  // the guarded fetch refuses private/loopback addresses and redirects to them.
  const imageData = await fetchImageAsBase64Safe(imageUrl);

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
      const parsed = firstJsonObject(text);
      if (!parsed) throw new Error('Failed to parse gear identification response');
      const validCategory = RENTAL_CATEGORIES.find(c => c.value === parsed.category);
      if (!validCategory) parsed.category = 'specialized-solutions' satisfies RentalCategorySlug;

      return {
        result: parsed as unknown as GearIdentificationResult,
        usage: extractUsage(result.response.usageMetadata),
      };
    },
  });
}

export async function matchFaces(
  selfieUrl: string,
  idPhotoUrl: string,
  userId?: string | null,
): Promise<FaceMatchResult> {
  const [selfieData, idData] = await Promise.all([
    fetchTrustedImageAsBase64(selfieUrl),
    fetchTrustedImageAsBase64(idPhotoUrl),
  ]);
  return matchFacesFromData(selfieData, idData, userId);
}

/** matchFaces on JPEG bytes the server already holds (base64). */
export async function matchFacesFromData(
  selfieData: string,
  idData: string,
  userId?: string | null,
): Promise<FaceMatchResult> {
  return trackedCompletion<FaceMatchResult>({
    agentId: 'verification:face-match',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: selfieData } },
        { inlineData: { mimeType: 'image/jpeg', data: idData } },
        `You are comparing two images for identity verification.
         The FIRST image is a selfie photo of a person.
         The SECOND image is a photo of their South African ID document, which contains a face photo.

         Determine whether the face in the selfie is the same person as the face on the ID.
         Consider age, facial structure, eye shape, nose, mouth, and overall resemblance.
         Ignore differences in lighting, angle, facial hair, glasses, or image quality unless
         they indicate a completely different person.

         Return ONLY valid JSON with:
         - match: boolean (true if same person, false if clearly different)
         - confidence: number between 0 and 1 (your confidence in the match verdict)
         - reasoning: string (one-sentence explanation of the key visual evidence)

         Return ONLY the JSON object, no markdown, no explanation.`,
      ]);

      const text = result.response.text().trim();
      const parsed = firstJsonObject(text) as Partial<FaceMatchResult> | null;
      if (!parsed) throw new Error('Failed to parse face-match response');

      return {
        result: {
          match: Boolean(parsed.match),
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
          reasoning: String(parsed.reasoning ?? ''),
        },
        usage: extractUsage(result.response.usageMetadata),
      };
    },
  });
}


/**
 * Read the ID document in a photo the server holds (JPEG, base64). The model
 * only transcribes; lib/verification/id-reading.ts cleans the answer and does
 * the checks (check digit, birth date, expiry). Returns the raw JSON object.
 */
export async function readIdDocument(
  idData: string,
  userId?: string | null,
): Promise<unknown> {
  return trackedCompletion<unknown>({
    agentId: 'verification:read-id',
    provider: 'google',
    model: MODEL_ID,
    userId,
    call: async () => {
      const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: idData } },
        `This photo should show a South African identity document: a smart ID card,
         a green ID book, a passport photo page or a driving licence.
         Transcribe what is printed. Do not guess: use null for anything you cannot read clearly.

         Return ONLY valid JSON with:
         - document_type: one of "smart_id_card", "green_id_book", "passport", "drivers_licence", "other_id", "not_an_id"
         - readable: boolean (true if the printed text is sharp enough to read with confidence)
         - id_number: string or null (the 13-digit South African ID number / personal number, digits only)
         - surname: string or null
         - names: string or null (forenames)
         - date_of_birth: string or null (YYYY-MM-DD)
         - expiry_date: string or null (YYYY-MM-DD; null if the document shows none)
         - confidence: number between 0 and 1 (how sure you are of the transcription)

         Return ONLY the JSON object, no markdown, no explanation.`,
      ]);

      const text = result.response.text().trim();
      const parsed = firstJsonObject(text);
      if (!parsed) throw new Error('Failed to parse ID reading response');

      return {
        result: parsed as unknown,
        usage: extractUsage(result.response.usageMetadata),
      };
    },
  });
}
