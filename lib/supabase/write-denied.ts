/**
 * Recognising and reporting writes the database refused (migration 067).
 *
 * 067 locks privileged columns (role, verification, ID documents, suspension,
 * banking verification) with column privileges and BEFORE triggers. Both raise
 * SQLSTATE 42501 (insufficient_privilege); the triggers also set a HINT so the
 * reason can be told apart:
 *   tv_name_locked       a verified person tried to change their legal name
 *   tv_privileged_column a client tried to set a platform-only column
 *   tv_ownership_column  a client tried to move a row to another account
 *
 * The refused attempt cannot be logged inside the database (the transaction
 * rolls back with it), so server routes log it to platform_events through
 * logEvent(). This module is pure (no server imports) so client components
 * can use the message helpers too.
 */

import type { PlatformEvent } from '@/lib/data/events';

/** Shown when a verified person tries to change their name. Matches the DB message in 067. */
export const NAME_LOCKED_MESSAGE =
  'Your name is locked after ID verification. Contact support to correct it.';

/** Shown when any other platform-only field was refused. */
export const PLATFORM_ONLY_MESSAGE =
  'Some of these details can only be changed by the platform. Contact support if something needs correcting.';

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

/** True when Postgres refused the write for lack of privilege (column grant, RLS or a 067 trigger). */
export function isWriteDenied(error: DbErrorLike | null | undefined): boolean {
  return error?.code === '42501';
}

/** True when the refusal is the verified-name lock. */
export function isNameLocked(error: DbErrorLike | null | undefined): boolean {
  if (!isWriteDenied(error)) return false;
  return (
    error?.hint === 'tv_name_locked' ||
    (error?.message ?? '').includes('locked after ID verification')
  );
}

/** True when the person has passed ID verification (either flag counts, as in the DB trigger). */
export function isVerifiedProfile(
  profile: { verification_status?: string | null; is_verified?: boolean | null } | null | undefined,
): boolean {
  return profile?.verification_status === 'verified' || profile?.is_verified === true;
}

/** True when a submitted name differs from the stored one (whitespace-insensitive at the ends). */
export function nameChanged(
  stored: string | null | undefined,
  submitted: string | null | undefined,
): boolean {
  return (stored ?? '').trim() !== (submitted ?? '').trim();
}

/**
 * The platform_events row for a refused write. No personal data: only the
 * route, the table, the SQLSTATE and the 067 hint.
 */
export function writeDeniedEvent(params: {
  userId: string | null;
  route: string;
  table: string;
  error: DbErrorLike | null | undefined;
}): PlatformEvent {
  return {
    eventType: 'security_write_denied',
    eventCategory: 'security',
    userId: params.userId,
    metadata: {
      route: params.route,
      table: params.table,
      code: params.error?.code ?? null,
      hint: params.error?.hint ?? null,
    },
  };
}
