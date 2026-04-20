// Maps Gemini vision scene-types to platform skill IDs used in creator profiles
// and the creator-search index. One scene can map to multiple skills; the flow
// aggregates across all portfolio photos and ranks skills by prevalence.

export type SceneType =
  | 'wedding'
  | 'portrait'
  | 'corporate'
  | 'product'
  | 'event'
  | 'landscape'
  | 'fashion'
  | 'food'
  | 'real_estate'
  | 'other';

export type PlatformSkillId =
  | 'wedding_photography'
  | 'portrait_photography'
  | 'corporate_photography'
  | 'product_photography'
  | 'event_photography'
  | 'landscape_photography'
  | 'fashion_photography'
  | 'food_photography'
  | 'real_estate_photography'
  | 'editorial_photography'
  | 'commercial_photography';

export const PLATFORM_SKILL_LABELS: Record<PlatformSkillId, string> = {
  wedding_photography: 'Wedding Photography',
  portrait_photography: 'Portrait Photography',
  corporate_photography: 'Corporate Photography',
  product_photography: 'Product Photography',
  event_photography: 'Event Photography',
  landscape_photography: 'Landscape Photography',
  fashion_photography: 'Fashion Photography',
  food_photography: 'Food Photography',
  real_estate_photography: 'Real Estate Photography',
  editorial_photography: 'Editorial Photography',
  commercial_photography: 'Commercial Photography',
};

export const SCENE_TO_SKILL_MAP: Record<SceneType, PlatformSkillId[]> = {
  wedding: ['wedding_photography', 'event_photography'],
  portrait: ['portrait_photography', 'editorial_photography'],
  corporate: ['corporate_photography', 'commercial_photography'],
  product: ['product_photography', 'commercial_photography'],
  event: ['event_photography'],
  landscape: ['landscape_photography'],
  fashion: ['fashion_photography', 'editorial_photography'],
  food: ['food_photography', 'commercial_photography'],
  real_estate: ['real_estate_photography', 'commercial_photography'],
  other: [],
};

export interface SkillMapInput {
  sceneType: string;
}

export interface PlatformSkill {
  id: PlatformSkillId;
  label: string;
  percentage: number;
}

export function normalizeSceneType(raw: string): SceneType {
  const key = raw.toLowerCase().trim() as SceneType;
  return (SCENE_TO_SKILL_MAP[key] ? key : 'other');
}

// Aggregates scene-type observations into ranked platform skills.
// Each observation contributes 1/N weight; if a scene maps to multiple skills,
// each mapped skill gets the full weight (skills can co-occur for one photo).
export function mapScenesToSkills(scenes: SkillMapInput[]): PlatformSkill[] {
  if (scenes.length === 0) return [];

  const skillWeights = new Map<PlatformSkillId, number>();
  const perSceneWeight = 100 / scenes.length;

  for (const { sceneType } of scenes) {
    const scene = normalizeSceneType(sceneType);
    const skills = SCENE_TO_SKILL_MAP[scene];
    for (const skillId of skills) {
      skillWeights.set(skillId, (skillWeights.get(skillId) ?? 0) + perSceneWeight);
    }
  }

  return Array.from(skillWeights.entries())
    .map(([id, raw]) => ({
      id,
      label: PLATFORM_SKILL_LABELS[id],
      percentage: Math.round(raw),
    }))
    .filter((s) => s.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);
}
