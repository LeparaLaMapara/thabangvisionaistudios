import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a named creator may be booked right now. The same rule the
 * Ubunye booking path applies (lib/agent/offers.ts checkCreator), shared so
 * POST /api/service-bookings applies it too: the creator's ID check is
 * verified, they have not switched "available for hire" off, and their
 * account is not suspended (a suspension whose end date has passed does not
 * count). Pricing is not decided here.
 */

export interface CreatorBookingFacts {
  verification_status?: string | null;
  available_for_hire?: boolean | null;
  is_suspended?: boolean | null;
  suspension_expires_at?: string | null;
}

export type CreatorBookingProblem = 'not_found' | 'not_verified' | 'not_available' | 'suspended';

export const CREATOR_NOT_BOOKABLE_MESSAGE =
  'That creator cannot be booked right now. Choose another creator, or leave it to our team to assign one.';

/** Pure: the reason a creator cannot be booked, or null when they can. */
export function creatorBookingProblem(c: CreatorBookingFacts | null, now: Date = new Date()): CreatorBookingProblem | null {
  if (!c) return 'not_found';
  if (c.is_suspended === true) {
    const ended = c.suspension_expires_at ? new Date(c.suspension_expires_at) < now : false;
    if (!ended) return 'suspended';
  }
  if (c.verification_status !== 'verified') return 'not_verified';
  if (c.available_for_hire === false) return 'not_available';
  return null;
}

/**
 * Reads the creator with the given (service-role) client and applies the
 * rule. Throws when the read fails, so the caller fails closed.
 */
export async function checkBookableCreator(
  admin: SupabaseClient,
  creatorId: string,
): Promise<{ ok: true } | { ok: false; problem: CreatorBookingProblem }> {
  const { data, error } = await admin
    .from('profiles')
    .select('verification_status, available_for_hire, is_suspended, suspension_expires_at')
    .eq('id', creatorId)
    .maybeSingle();
  if (error) throw new Error(`checkBookableCreator: ${error.message}`);
  const problem = creatorBookingProblem(data as CreatorBookingFacts | null);
  return problem ? { ok: false, problem } : { ok: true };
}
