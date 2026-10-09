import { CREATOR_SPECIALIZATIONS, type CreatorSpecialization } from '@/lib/constants';

/**
 * Creator specialisations (profiles.specializations) on one vocabulary.
 * Pure. Creator search filters on this column (lower-case values from
 * CREATOR_SPECIALIZATIONS); onboarding detects finer skills from the
 * portfolio ("wedding_photography", "Portrait Photography"), which used to
 * be kept only in onboarding_progress and so never made a creator findable.
 */

const VALUES = CREATOR_SPECIALIZATIONS.map((s) => s.value) as readonly string[];

// Checked in order: "product photography" is photography, not producing.
const KEYWORDS: readonly (readonly [RegExp, CreatorSpecialization])[] = [
  [/photo/, 'photography'],
  [/cinemat|video|film|camera ?operat|showreel/, 'cinematography'],
  [/edit|post.?produc|colou?r ?grad/, 'editing'],
  [/sound|audio/, 'sound'],
  [/direct/, 'directing'],
  [/light|gaffer/, 'lighting'],
  [/produc/, 'producing'],
];

/** One skill name or id → a specialisation, or null when it maps to none. */
export function toSpecialization(raw: unknown): CreatorSpecialization | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!v) return null;
  if (VALUES.includes(v)) return v as CreatorSpecialization;
  for (const [pattern, spec] of KEYWORDS) if (pattern.test(v)) return spec;
  return null;
}

/**
 * The specialisations after adding the confirmed skills: existing values
 * are kept (normalised where they can be), new ones appended, no repeats.
 */
export function mergeSpecializations(existing: readonly unknown[] | null | undefined, skills: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const e of existing ?? []) {
    const v = toSpecialization(e) ?? (typeof e === 'string' && e.trim() ? e.trim().toLowerCase() : null);
    if (v && !out.includes(v)) out.push(v);
  }
  for (const s of skills) {
    const v = toSpecialization(s);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
