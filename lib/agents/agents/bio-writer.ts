import type { UbunyeAgent } from '../types';

export const bioWriterAgent: UbunyeAgent = {
  id: 'bio-writer',
  name: 'Ubunye Bio Writer',
  description: 'Generates a first-person creator bio from portfolio analysis and profile data',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  tools: [],
  rateLimit: { guest: 0, free: 5, pro: 10, studio: 20 },
  costTier: 'medium',
};

export interface BioWriterInput {
  displayName: string | null;
  location: string | null;
  yearsExperience: number | null;
  topSceneTypes: Array<{ name: string; percentage: number }>;
  detectedGear: string[];
  topDescriptions: string[];
}

export function buildBioWriterPrompt(input: BioWriterInput): string {
  const scenes = input.topSceneTypes.length > 0
    ? input.topSceneTypes.slice(0, 3).map((s) => `${s.name} (${s.percentage}%)`).join(', ')
    : 'none yet';

  const gear = input.detectedGear.length > 0
    ? input.detectedGear.slice(0, 5).join(', ')
    : 'not detected';

  const samples = input.topDescriptions.length > 0
    ? input.topDescriptions.slice(0, 3).map((d, i) => `${i + 1}. ${d}`).join('\n')
    : 'No portfolio samples yet.';

  return `You are writing a first-person bio for a South African creator's public profile on a creative-production marketplace.

Creator facts:
- Name: ${input.displayName ?? 'Unknown'}
- Location: ${input.location ?? 'South Africa'}
- Years of experience: ${input.yearsExperience ?? 'unspecified'}
- Top scene types from portfolio: ${scenes}
- Detected gear: ${gear}
- Sample portfolio captions:
${samples}

Write a natural, confident bio in first person, 2 to 3 sentences, maximum 280 characters total.
Use South African English spelling. Do not use hashtags, emojis, or marketing clichés like "passionate" or "creative eye".
Focus on what they actually shoot, where they're based, and one concrete specialty.
Return only the bio text — no quotes, no preamble, no explanation.`;
}

export const MAX_BIO_CHARS = 280;

/** What the model returned, made safe to show: no wrapping quotes or labels, never over the cap. */
export function cleanBio(text: string, max: number = MAX_BIO_CHARS): string {
  const QUOTES = /^["'\u201C\u2018]+|["'\u201D\u2019]+$/g;
  let bio = text.trim().replace(QUOTES, '').trim();
  bio = bio.replace(/^bio:\s*/i, '').replace(QUOTES, '').trim();
  // No long dashes in what the creator shows the world.
  bio = bio.replace(/\s*[\u2014\u2013]\s*/g, ', ');
  if (bio.length <= max) return bio;
  const cut = bio.slice(0, max);
  const lastStop = cut.lastIndexOf('.');
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

/**
 * A plain starting bio from what we already know, used when no AI provider
 * answers (an Anthropic key out of credit with no working fallback). The
 * creator edits it; it is never empty.
 */
export function templateBio(input: BioWriterInput, max: number = MAX_BIO_CHARS): string {
  const place = input.location?.trim() || 'South Africa';
  const scenes = input.topSceneTypes.slice(0, 2).map((s) => s.name.trim()).filter(Boolean);
  const what = scenes.length === 2
    ? `${scenes[0]} and ${scenes[1]}`
    : scenes.length === 1
      ? scenes[0]
      : 'photo and video work';
  const years = input.yearsExperience && input.yearsExperience > 0
    ? ` with ${input.yearsExperience} year${input.yearsExperience === 1 ? '' : 's'} of experience`
    : '';
  const bio = `I am a creator based in ${place}${years}. I shoot ${what}, and I care about clear communication and delivering on time. Tell me about your shoot and I will help you plan it.`;
  return cleanBio(bio, max);
}
