import { ROLES_POLICY } from '@/lib/constants';
import type { EvidenceSource, ProofStep, RoleEvidence } from './types';

/**
 * The profile maker's proof steps. Pure.
 */

export interface StepProgress {
  key: string;
  /** Items that count towards the step (a before/after pair counts once). */
  done: number;
  min: number;
  complete: boolean;
}

type EvidenceLike = Pick<RoleEvidence, 'step_key' | 'kind' | 'pair_group' | 'pair_side'>;

function countFor(step: ProofStep, evidence: readonly EvidenceLike[]): number {
  const mine = evidence.filter((e) => e.step_key === step.key);
  if (step.kind === 'pair') {
    const groups = new Map<string, Set<string>>();
    for (const e of mine) {
      if (!e.pair_group || !e.pair_side) continue;
      const sides = groups.get(e.pair_group) ?? new Set<string>();
      sides.add(e.pair_side);
      groups.set(e.pair_group, sides);
    }
    return [...groups.values()].filter((s) => s.has('before') && s.has('after')).length;
  }
  if (step.kind === 'text') return mine.length;
  return mine.filter((e) => e.kind === 'photo' || e.kind === 'video').length;
}

export function proofProgress(steps: readonly ProofStep[], evidence: readonly EvidenceLike[]): StepProgress[] {
  return steps.map((s) => {
    const done = countFor(s, evidence);
    return { key: s.key, done, min: s.min, complete: done >= s.min };
  });
}

export function proofComplete(steps: readonly ProofStep[], evidence: readonly EvidenceLike[]): boolean {
  return proofProgress(steps, evidence).every((p) => p.complete);
}

/**
 * Whether a file counts as captured in the app: it came from the camera
 * button AND it is fresh (the photo's own date, else the file time, within
 * ROLES_POLICY.captureFreshnessMinutes of now). Anything else is an upload.
 * Honest labelling, not proof: the reviewer still looks.
 */
export function classifySource(input: {
  fromCameraButton: boolean;
  exifDate: string | null;
  fileLastModified: number | null;
  now: number;
}): EvidenceSource {
  if (!input.fromCameraButton) return 'uploaded';
  const windowMs = ROLES_POLICY.captureFreshnessMinutes * 60_000;
  const exif = input.exifDate ? Date.parse(input.exifDate) : NaN;
  const when = Number.isFinite(exif) ? exif : input.fileLastModified;
  if (when === null || !Number.isFinite(when)) return 'uploaded';
  const age = input.now - when;
  // A little slack for a phone clock running ahead.
  return age <= windowMs && age >= -5 * 60_000 ? 'captured_in_app' : 'uploaded';
}

/** The step the maker should open next: the first that is not complete. */
export function nextIncompleteStep(steps: readonly ProofStep[], evidence: readonly EvidenceLike[]): string | null {
  const p = proofProgress(steps, evidence).find((x) => !x.complete);
  return p ? p.key : null;
}
