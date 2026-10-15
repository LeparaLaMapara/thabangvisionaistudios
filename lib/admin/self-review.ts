import type { SupabaseClient } from '@supabase/supabase-js';
import { logEvent } from '@/lib/data/events';

/**
 * An admin deciding on their own record (their own ID check, their own People
 * profile). Not blocked: the owner is the only admin today, so a two-person
 * rule would lock him out. Instead it is written down where admins look, the
 * person's moderation log (action 'admin_self_review', migration 096), and as
 * a platform event, so a self-approval is never silent.
 *
 * Best effort: a failed write is logged and the decision stands.
 */
export async function recordSelfReview(
  db: SupabaseClient,
  p: { adminId: string; what: 'verification_approved' | 'verification_rejected' | 'role_approved' | 'role_changes' | 'role_face_check' | 'role_vouch_verified'; ref?: string | null },
): Promise<void> {
  const reason = `Admin decided on their own record: ${p.what.replace(/_/g, ' ')}.`;
  logEvent({
    eventType: 'admin_self_review',
    eventCategory: 'admin',
    userId: p.adminId,
    metadata: { what: p.what, ref: p.ref ?? null },
  });
  try {
    const { error } = await db.from('moderation_log').insert({
      user_id: p.adminId,
      admin_id: p.adminId,
      action: 'admin_self_review',
      reason,
      metadata: { what: p.what, ref: p.ref ?? null },
    });
    if (error) console.error('[admin/self-review] moderation log write failed:', error.message);
  } catch (err) {
    console.error('[admin/self-review] moderation log write threw:', err);
  }
}
