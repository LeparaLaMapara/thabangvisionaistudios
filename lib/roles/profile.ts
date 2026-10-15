import { ROLES_POLICY } from '@/lib/constants';
import { checkAge, type AgeCheck } from './age';
import { documentsStillNeeded, legalQuestionsAnswered, legalStatus, type HeldDocument } from './legal';
import { proofProgress } from './proof';
import type { Role, RoleEvidence } from './types';

/**
 * What a client sees, and whether a draft may be sent for review. Pure.
 *
 * Hide the machinery: one "Verified" mark (ID checked AND every legal check
 * the role needs), a real job count, the price and the platform promise.
 * Never the level.
 */

export interface VerifiedFacts {
  identityVerified: boolean;
  /** A reviewer checked the role's legal documents (person_roles.legal_verified_at). */
  legalVerified: boolean;
  /** The role has legal requirements at all. */
  roleHasLegal: boolean;
}

export function isVerified(f: VerifiedFacts): boolean {
  return f.identityVerified && (!f.roleHasLegal || f.legalVerified);
}

/** "New on ThabangVision" for 0, else "N jobs done on ThabangVision". Never invented. */
export function jobsLine(confirmedJobs: number): string {
  const n = Math.max(0, Math.floor(confirmedJobs));
  return n === 0 ? ROLES_POLICY.copy.newOnPlatform : ROLES_POLICY.copy.jobsDone(n);
}

export interface SubmitInput {
  role: Pick<Role, 'status' | 'min_age' | 'legal_requirements' | 'proof_task'>;
  answers: Record<string, unknown>;
  evidence: readonly Pick<RoleEvidence, 'step_key' | 'kind' | 'pair_group' | 'pair_side' | 'legal_code' | 'verified_at'>[];
  priceCents: number | null;
  /** Date of birth from the ID check, else the typed one. */
  dateOfBirth: string | null;
  now: Date;
}

export interface SubmitCheck {
  ok: boolean;
  /** Plain-words list of what is left, in the order the maker shows it. */
  todo: string[];
  age: AgeCheck;
}

export function canSubmit(input: SubmitInput): SubmitCheck {
  const todo: string[] = [];
  if (input.role.status !== 'live') todo.push('this kind of work opens soon');

  const age = checkAge(input.role.min_age, input.dateOfBirth, input.now);
  if (age === 'unknown') todo.push('add your date of birth');
  if (age === 'too_young') todo.push(`you need to be ${input.role.min_age} or older for this work`);

  if (!legalQuestionsAnswered(input.role.legal_requirements, input.answers)) todo.push('answer the questions about your work');
  const held: HeldDocument[] = input.evidence
    .filter((e) => e.kind === 'document')
    .map((e) => ({ legal_code: e.legal_code, verified: !!e.verified_at }));
  for (const r of documentsStillNeeded(input.role.legal_requirements, input.answers, held)) {
    todo.push(`add a photo of: ${r.label}`);
  }

  const steps = input.role.proof_task;
  for (const p of proofProgress(steps, input.evidence)) {
    if (!p.complete) {
      const step = steps.find((s) => s.key === p.key);
      todo.push(`${step?.title ?? p.key}: ${p.min - p.done} more`);
    }
  }

  if (input.priceCents === null || input.priceCents <= 0) todo.push('set your price');

  return { ok: todo.length === 0, todo, age };
}

/** For the reviewer: the legal picture of a submitted profile. */
export function reviewLegal(
  role: Pick<Role, 'legal_requirements' | 'min_age'>,
  answers: Record<string, unknown>,
  evidence: readonly Pick<RoleEvidence, 'kind' | 'legal_code' | 'verified_at'>[],
  dateOfBirth: string | null,
  now: Date,
): ReturnType<typeof legalStatus> & { age: AgeCheck } {
  const age = checkAge(role.min_age, dateOfBirth, now);
  const held: HeldDocument[] = evidence
    .filter((e) => e.kind === 'document')
    .map((e) => ({ legal_code: e.legal_code, verified: !!e.verified_at }));
  return { ...legalStatus(role.legal_requirements, answers, held, { ageOk: age === 'ok' || age === 'not_required' }), age };
}

/** "N jobs · on time N/N", or "New on ThabangVision" at zero. Never invented. */
export function recordLine(jobs: number, onTime: number | null): string {
  return ROLES_POLICY.copy.recordLine(Math.max(0, Math.floor(jobs)), onTime === null ? null : Math.max(0, Math.floor(onTime)));
}

/** "Comes with": one label, optional evidence ids (person_roles.comes_with). */
export interface ComesWith {
  label: string;
  evidenceIds: string[];
}

export function parseComesWith(raw: unknown): ComesWith | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  if (!label) return null;
  const ids = Array.isArray(r.evidence_ids) ? r.evidence_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 8) : [];
  return { label, evidenceIds: ids };
}

export interface Album<T> {
  name: string;
  items: T[];
}

/**
 * Work grouped into albums, in the order albums first appear. Work without
 * an album goes under `fallback`. One album only: no tabs needed.
 */
export function groupAlbums<T extends { album: string | null }>(items: readonly T[], fallback = 'Work'): Album<T>[] {
  const out: Album<T>[] = [];
  for (const item of items) {
    const name = item.album?.trim() || fallback;
    const found = out.find((a) => a.name === name);
    if (found) found.items.push(item);
    else out.push({ name, items: [item] });
  }
  return out;
}
