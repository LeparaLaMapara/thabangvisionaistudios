/**
 * The age check (model is 18+). Pure.
 *
 * The date of birth comes from the ID check when it read one
 * (verification_metadata.id_document.date_of_birth), else from what the
 * person typed, which a reviewer confirms against their ID. "unknown" never
 * passes: the reviewer must see a date.
 */

export type AgeCheck = 'not_required' | 'ok' | 'too_young' | 'unknown';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Whole years between a YYYY-MM-DD date of birth and `now`, or null if unreadable. */
export function ageOn(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (!dateOfBirth) return null;
  const m = ISO_DATE.exec(dateOfBirth.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (probe.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function checkAge(minAge: number | null | undefined, dateOfBirth: string | null | undefined, now: Date): AgeCheck {
  if (minAge === null || minAge === undefined || minAge <= 0) return 'not_required';
  const age = ageOn(dateOfBirth, now);
  if (age === null) return 'unknown';
  return age >= minAge ? 'ok' : 'too_young';
}

/** Prefer the date the ID check read; fall back to what the person typed. */
export function bestDateOfBirth(fromIdCheck: string | null | undefined, typed: unknown): string | null {
  if (typeof fromIdCheck === 'string' && ISO_DATE.test(fromIdCheck)) return fromIdCheck.slice(0, 10);
  if (typeof typed === 'string' && ISO_DATE.test(typed)) return typed.slice(0, 10);
  return null;
}
