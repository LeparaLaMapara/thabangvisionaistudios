import { createClient } from '@/lib/supabase/server';

// ─── Types ──────────────────────────────────────────────────────────────────

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type VerificationRecord = {
  id: string;
  display_name: string | null;
  email?: string;
  avatar_url: string | null;
  is_verified: boolean;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_rejected_reason: string | null;
  id_front_path: string | null;
  id_back_path: string | null;
  proof_of_address_path: string | null;
};

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns the verification-related fields for a given user from the profiles table.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getVerificationStatus(userId: string): Promise<VerificationRecord | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, avatar_url, is_verified, verification_status, verification_submitted_at, verification_reviewed_at, verification_rejected_reason, id_front_path, id_back_path, proof_of_address_path',
    )
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getVerificationStatus]', error.message);
    }
    return null;
  }

  return data as VerificationRecord;
}

/**
 * Submits a verification request by updating the profile with document paths
 * and setting verification_status to 'pending'.
 */
export async function submitVerification(
  userId: string,
  paths: { idFront: string; idBack: string; proofOfAddress: string },
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({
      id_front_path: paths.idFront,
      id_back_path: paths.idBack,
      proof_of_address_path: paths.proofOfAddress,
      verification_status: 'pending' as VerificationStatus,
      verification_submitted_at: new Date().toISOString(),
      verification_reviewed_at: null,
      verification_rejected_reason: null,
    })
    .eq('id', userId);

  if (error) {
    console.error('[submitVerification]', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Approves a user's verification: sets is_verified=true, status='verified',
 * and records the review timestamp.
 */
export async function approveVerification(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({
      verification_status: 'verified' as VerificationStatus,
      is_verified: true,
      verification_reviewed_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    console.error('[approveVerification]', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Rejects a user's verification: sets is_verified=false, status='rejected',
 * records the review timestamp, and stores the rejection reason.
 */
export async function rejectVerification(
  userId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({
      verification_status: 'rejected' as VerificationStatus,
      is_verified: false,
      verification_reviewed_at: new Date().toISOString(),
      verification_rejected_reason: reason,
    })
    .eq('id', userId);

  if (error) {
    console.error('[rejectVerification]', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Returns all profiles with verification_status='pending',
 * ordered by submission date ascending (oldest first).
 */
export async function getPendingVerifications(): Promise<VerificationRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, avatar_url, is_verified, verification_status, verification_submitted_at, verification_reviewed_at, verification_rejected_reason, id_front_path, id_back_path, proof_of_address_path',
    )
    .eq('verification_status', 'pending')
    .order('verification_submitted_at', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[getPendingVerifications]', error.message);
    return [];
  }

  return (data as VerificationRecord[]) ?? [];
}

/**
 * Returns all profiles that have ever submitted a verification request
 * (status != 'unverified'), ordered by submission date descending.
 */
export async function getAllVerifications(): Promise<VerificationRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, avatar_url, is_verified, verification_status, verification_submitted_at, verification_reviewed_at, verification_rejected_reason, id_front_path, id_back_path, proof_of_address_path',
    )
    .neq('verification_status', 'unverified')
    .order('verification_submitted_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getAllVerifications]', error.message);
    return [];
  }

  return (data as VerificationRecord[]) ?? [];
}
