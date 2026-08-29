import type { UbunyeAgent } from '../types';

export const productionDescriberAgent: UbunyeAgent = {
  id: 'production-describer',
  name: 'Ubunye Production Describer',
  description: 'Analyzes production cover images with Gemma Vision, then generates descriptions and tags with Claude',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 20, pro: 40, studio: 60 },
  costTier: 'medium',
};

export interface ProductionDescriberInput {
  title: string;
  projectType: string;
  imageUrl: string;
  subCategory?: string | null;
  client?: string | null;
  year?: number | null;
}

export interface VisionAnalysis {
  sceneType: string;
  mood: string;
  subjects: string;
  style: string;
  lighting: string;
  setting: string;
}

export interface ProductionDescriberOutput {
  description: string;
  tags: string[];
}

export function buildVisionPrompt(): string {
  return `Analyze this production image. Return ONLY valid JSON with:
- sceneType: string (wedding, portrait, corporate, product, event, landscape, fashion, food, real_estate, music_video, documentary, commercial, editorial, concert, other)
- mood: string (dramatic, intimate, cinematic, energetic, serene, bold, warm, dark, luxurious, raw, playful)
- subjects: string (brief description of who/what is in frame)
- style: string (moody, high-key, low-key, editorial, candid, staged, aerial, close-up, wide-angle, abstract)
- lighting: string (natural, studio, golden_hour, flash, ambient, mixed, neon, dramatic, soft)
- setting: string (indoor, outdoor, studio, urban, rural, venue, on-location)

Return ONLY the JSON object, no markdown, no explanation.`;
}

export function buildDescriptionPrompt(
  input: ProductionDescriberInput,
  vision: VisionAnalysis,
): string {
  const year = input.year ? ` (${input.year})` : '';
  const client = input.client ? `\nClient: ${input.client}` : '';
  const subCategory = input.subCategory ? `\nSub-category: ${input.subCategory}` : '';

  return `You are writing a production listing for a South African creative production marketplace.

Production:
- Title: ${input.title}${year}
- Type: ${input.projectType}${subCategory}${client}

Visual analysis of cover image:
- Scene: ${vision.sceneType}
- Mood: ${vision.mood}
- Subjects: ${vision.subjects}
- Style: ${vision.style}
- Lighting: ${vision.lighting}
- Setting: ${vision.setting}

Return ONLY valid JSON with:
{
  "description": "string (2-3 sentences, SA English. Describe what this production delivers — the vibe, the visual approach, and who it's for. Be specific based on the visual analysis. No marketing fluff.)",
  "tags": ["string", ...] (8-12 relevant tags without # symbol — mix of genre, style, mood, and technique tags that help clients find this production)
}

Rules:
- No markdown, no preamble, no trailing prose — only the JSON object.
- Do not use "passionate", "creative eye", "best-in-class", "world-class", "cutting-edge".
- Write as if a client is browsing — they want to know what they'll get.
- Tags should be lowercase, no spaces (use hyphens).`;
}

export function parseVisionOutput(text: string): VisionAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      sceneType: 'other',
      mood: 'cinematic',
      subjects: 'unknown',
      style: 'editorial',
      lighting: 'natural',
      setting: 'on-location',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<VisionAnalysis>;
    return {
      sceneType: String(parsed.sceneType ?? 'other'),
      mood: String(parsed.mood ?? 'cinematic'),
      subjects: String(parsed.subjects ?? 'unknown'),
      style: String(parsed.style ?? 'editorial'),
      lighting: String(parsed.lighting ?? 'natural'),
      setting: String(parsed.setting ?? 'on-location'),
    };
  } catch {
    return {
      sceneType: 'other',
      mood: 'cinematic',
      subjects: 'unknown',
      style: 'editorial',
      lighting: 'natural',
      setting: 'on-location',
    };
  }
}

export function parseDescriptionOutput(text: string): ProductionDescriberOutput {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Production describer response did not contain JSON.');
  const parsed = JSON.parse(jsonMatch[0]) as Partial<ProductionDescriberOutput>;

  return {
    description: (parsed.description ?? '').toString().trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      : [],
  };
}
