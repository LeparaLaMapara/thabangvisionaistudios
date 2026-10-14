import type { LegalRequirement } from './types';

/**
 * "Are you allowed?" Only what the law asks for (plus any rule the platform
 * adds, always labelled as ours). Pure.
 *
 * A requirement with `when` applies only when the person answered yes to its
 * question (a driver who never carries people needs no PrDP). Age
 * requirements (code starting "age_") are met by the age check, not a
 * document.
 */

export interface HeldDocument {
  legal_code: string | null;
  /** A reviewer checked the document. */
  verified: boolean;
}

export interface LegalStatus {
  /** Every requirement that applies is in hand and checked. */
  met: boolean;
  /** Requirements that apply to this person. */
  applicable: LegalRequirement[];
  /** Applicable and nothing uploaded yet. */
  missing: LegalRequirement[];
  /** Uploaded, waiting for a person to check. */
  pending: LegalRequirement[];
}

export const isAgeRequirement = (r: LegalRequirement): boolean => r.code.startsWith('age_');

export function applicableRequirements(
  requirements: readonly LegalRequirement[],
  answers: Record<string, unknown>,
): LegalRequirement[] {
  return requirements.filter((r) => r.required && (!r.when || answers[r.when] === true));
}

/** The yes/no questions the maker must ask before it knows what applies. */
export function legalQuestions(requirements: readonly LegalRequirement[]): { key: string; ask: string }[] {
  const seen = new Set<string>();
  const out: { key: string; ask: string }[] = [];
  for (const r of requirements) {
    if (r.when && r.ask && !seen.has(r.when)) {
      seen.add(r.when);
      out.push({ key: r.when, ask: r.ask });
    }
  }
  return out;
}

export function legalStatus(
  requirements: readonly LegalRequirement[],
  answers: Record<string, unknown>,
  held: readonly HeldDocument[],
  opts: { ageOk?: boolean } = {},
): LegalStatus {
  const applicable = applicableRequirements(requirements, answers);
  const missing: LegalRequirement[] = [];
  const pending: LegalRequirement[] = [];
  for (const r of applicable) {
    if (isAgeRequirement(r)) {
      if (opts.ageOk !== true) pending.push(r);
      continue;
    }
    const docs = held.filter((d) => d.legal_code === r.code);
    if (docs.length === 0) missing.push(r);
    else if (!docs.some((d) => d.verified)) pending.push(r);
  }
  return { met: missing.length === 0 && pending.length === 0, applicable, missing, pending };
}

/** Requirements that still need a document from the person (for the submit check). */
export function documentsStillNeeded(
  requirements: readonly LegalRequirement[],
  answers: Record<string, unknown>,
  held: readonly HeldDocument[],
): LegalRequirement[] {
  return applicableRequirements(requirements, answers).filter(
    (r) => !isAgeRequirement(r) && !held.some((d) => d.legal_code === r.code),
  );
}

/** Every question that decides what applies has an answer (true or false). */
export function legalQuestionsAnswered(requirements: readonly LegalRequirement[], answers: Record<string, unknown>): boolean {
  return legalQuestions(requirements).every((q) => typeof answers[q.key] === 'boolean');
}
