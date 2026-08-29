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
