import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { FraudFlag } from '@/lib/metadata/fraud-detection';
import type { VerificationMetadata } from '@/lib/metadata/verification';

// ─── Types ──────────────────────────────────────────────────────────────────

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type VerificationRecord = {
  id: string;
  display_name: string | null;
  email?: string;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  location: string | null;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  is_verified: boolean;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_rejected_reason: string | null;
  id_front_path: string | null;
  id_back_path: string | null;
  selfie_with_id_path: string | null;
  verification_metadata: VerificationMetadata | null;
  verification_ai_check: unknown | null;
  verification_fraud_flags: FraudFlag[];
  id_document_hash: string | null;
  verification_ip: string | null;
  verification_user_agent: string | null;
  verification_attempts: number;
  created_at: string | null;
};

// ─── Select columns ─────────────────────────────────────────────────────────

const VERIFICATION_COLUMNS = [
  'id',
  'display_name',
  'avatar_url',
  'bio',
  'phone',
  'location',
  'skills',
  'social_links',
  'is_verified',
  'verification_status',
  'verification_submitted_at',
  'verification_reviewed_at',
  'verification_rejected_reason',
  'id_front_path',
  'id_back_path',
  'selfie_with_id_path',
  'verification_metadata',
  'verification_ai_check',
  'verification_fraud_flags',
  'id_document_hash',
  'verification_ip',
  'verification_user_agent',
  'verification_attempts',
  'created_at',
].join(', ');

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns the verification-related fields for a given user from the profiles table.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getVerificationStatus(userId: string): Promise<VerificationRecord | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(VERIFICATION_COLUMNS)
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getVerificationStatus]', error.message);
    }
    return null;
  }

  return data as unknown as VerificationRecord;
}

// Writes to verification state (submit, approve, reject) are not offered here.
// They ran with the service role and checked nobody, and nothing called them
// (audit 2026-10-13). The real paths are POST /api/verifications (the user's
// own submission, through an RPC) and the admin review routes (requireAdmin).

/**
 * Returns all profiles with verification_status='pending',
 * ordered by submission date ascending (oldest first).
 */
export async function getPendingVerifications(): Promise<VerificationRecord[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(VERIFICATION_COLUMNS)
    .eq('verification_status', 'pending')
    .order('verification_submitted_at', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[getPendingVerifications]', error.message);
    return [];
  }

  return (data as unknown as VerificationRecord[]) ?? [];
}

/**
 * Returns all profiles that have ever submitted a verification request
 * (status != 'unverified'), ordered by submission date descending.
 */
export async function getAllVerifications(): Promise<VerificationRecord[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(VERIFICATION_COLUMNS)
    .neq('verification_status', 'unverified')
    .order('verification_submitted_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getAllVerifications]', error.message);
    return [];
  }

  return (data as unknown as VerificationRecord[]) ?? [];
}
