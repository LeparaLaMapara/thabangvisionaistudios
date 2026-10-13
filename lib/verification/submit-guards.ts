import type { SupabaseClient } from '@supabase/supabase-js';
import { STUDIO } from '@/lib/constants';
import { checkConsents, requiredConsents } from '@/lib/consent';

/**
 * Checks before an ID-check submission, shared by the route that hands out
 * upload links and the route that records the submission.
 */
export interface CurrentVerification {
  verification_status: string | null;
  verification_attempts: number | null;
  id_front_path: string | null;
  id_back_path: string | null;
  selfie_with_id_path: string | null;
}

export type GuardResult =
  | { ok: true; current: CurrentVerification | null }
  | { ok: false; status: number; body: { error: string; code?: string } };

export async function checkCanSubmit(supabase: SupabaseClient, userId: string): Promise<GuardResult> {
  const { data: consentRow } = await supabase
    .from('profiles')
    .select('popia_consent_at')
    .eq('id', userId)
    .single();
  if (!consentRow?.popia_consent_at) {
    return {
      ok: false,
      status: 400,
      body: { error: 'You must accept the privacy notice before uploading ID documents.', code: 'POPIA_CONSENT_REQUIRED' },
    };
  }

  // Identity-check (biometric) consent, separate from POPIA. If the consent
  // store cannot be read we do not proceed: no record, no face comparison.
  const consent = await checkConsents(supabase, userId, requiredConsents('verification'));
  if (consent.status === 'unavailable') {
    console.error('[verifications] consent store unavailable:', consent.error);
    return {
      ok: false,
      status: 503,
      body: { error: 'Identity checks are temporarily unavailable. Please try again later.', code: 'CONSENT_UNAVAILABLE' },
    };
  }
  if (consent.status !== 'ok') {
    return { ok: false, status: 400, body: { error: 'Please accept the identity check notice first.', code: 'CONSENT_REQUIRED' } };
  }

  const { data: current } = await supabase
    .from('profiles')
    .select('verification_status, verification_attempts, id_front_path, id_back_path, selfie_with_id_path')
    .eq('id', userId)
    .single();

  if (current?.verification_status === 'pending') {
    return { ok: false, status: 409, body: { error: 'Your documents are already under review. Please wait for a response.' } };
  }
  if (current?.verification_status === 'verified') {
    return { ok: false, status: 409, body: { error: 'Your identity is already verified.' } };
  }
  if ((current?.verification_attempts ?? 0) >= STUDIO.verification.maxAttempts) {
    return {
      ok: false,
      status: 429,
      body: { error: `Maximum submission attempts reached. Contact support at ${STUDIO.supportEmail}` },
    };
  }
  return { ok: true, current: (current as CurrentVerification | null) ?? null };
}

/** Where the browser may upload an original before the check: the user's own staging folder. */
export const STAGING_FOLDER = 'staging';
export const STAGING_NAMES = { id_copy: 'id-copy', selfie_with_id: 'selfie-with-id' } as const;
export type PhotoSlot = keyof typeof STAGING_NAMES;

export function stagingPath(userId: string, slot: PhotoSlot, uuid: string): string {
  return `${userId}/${STAGING_FOLDER}/${uuid}-${STAGING_NAMES[slot]}`;
}

/** True only for a staging path this server could have issued to this user for this slot. */
export function isOwnStagingPath(path: unknown, userId: string, slot: PhotoSlot): path is string {
  if (typeof path !== 'string') return false;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const re = new RegExp(`^${userId.replace(/[^0-9a-f-]/gi, '')}/${STAGING_FOLDER}/${uuid}-${STAGING_NAMES[slot]}$`);
  return re.test(path);
}
