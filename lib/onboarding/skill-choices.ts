/**
 * Creator onboarding when the AI cannot help. Pure and browser-safe.
 *
 * The portfolio step asks a vision model to tag each photo, and the skills
 * step builds the creator's skills from those tags. When the model is down
 * or out of quota every photo comes back "Analysis unavailable"
 * (qualityScore 0), the step offered no way on, and creators could only
 * "Skip to dashboard" with no skills, specialisations or bio saved (found by
 * the local journey tests). Now the creator continues and picks their skills
 * from the platform vocabulary themselves.
 */
import { CREATOR_SPECIALIZATIONS } from '@/lib/constants';
import type { SceneAnalysisResult, SkillDetectionResult } from '@/lib/agents/types';

export interface SelectableSkill {
  id: string;
  name: string;
  percentage: number;
  selected: boolean;
}

interface PortfolioItemState {
  url?: string | null;
  uploading?: boolean;
  error?: string | null;
  analysis?: SceneAnalysisResult | null;
}

const usable = (a: SceneAnalysisResult | null | undefined): a is SceneAnalysisResult => !!a && a.qualityScore > 0;

/**
 * Every uploaded photo has been through analysis, yet fewer than two came
 * back usable: the AI could not help. The creator may continue anyway.
 */
export function analysisUnavailable(items: readonly PortfolioItemState[], analyzing: boolean): boolean {
  if (analyzing) return false;
  const uploaded = items.filter((i) => i.url && !i.uploading && !i.error);
  if (uploaded.length < 2 || items.some((i) => i.uploading)) return false;
  if (!uploaded.every((i) => i.analysis)) return false;
  return uploaded.filter((i) => usable(i.analysis)).length < 2;
}

/** What the skills step goes on with when continuing without a usable analysis (tags the creator corrected are kept). */
export function analysesForUploaded(items: readonly PortfolioItemState[]): SceneAnalysisResult[] {
  return items
    .filter((i) => i.url && !i.uploading && !i.error && i.analysis)
    .map((i) => i.analysis as SceneAnalysisResult);
}

/** The platform's own skill list, none ticked: the creator chooses. */
export function manualSkillChoices(): SelectableSkill[] {
  return CREATOR_SPECIALIZATIONS.map((s) => ({ id: s.value, name: s.label, percentage: 0, selected: false }));
}

/**
 * The skills to offer. Detected platform skills (ticked) when there are any;
 * otherwise, or when detection failed, the manual list.
 */
export function skillChoices(result: SkillDetectionResult | null): { skills: SelectableSkill[]; manual: boolean } {
  const detected = result?.platformSkills ?? [];
  if (detected.length > 0) {
    return { skills: detected.map((s) => ({ id: s.id, name: s.label, percentage: s.percentage, selected: true })), manual: false };
  }
  return { skills: manualSkillChoices(), manual: true };
}
