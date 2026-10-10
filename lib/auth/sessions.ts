import { createAdminClient } from '@/lib/supabase/server';

/**
 * End every session of one user: their refresh tokens stop working and the
 * Auth server refuses their current access token on /user, so the app sees
 * them as signed out at once (migration 079, admin_revoke_user_sessions).
 *
 * Used when an admin changes someone's role or suspends them (Phase 6
 * security AUTH-2 / AUTH-3). Server-only: service role. Never throws; the
 * caller reports `revoked: false` so a person knows to retry.
 */
export async function revokeUserSessions(userId: string): Promise<{ revoked: boolean; sessions: number }> {
  try {
    const { data, error } = await createAdminClient().rpc('admin_revoke_user_sessions', { p_user_id: userId });
    if (error) {
      console.error('[revokeUserSessions] failed:', error.message);
      return { revoked: false, sessions: 0 };
    }
    return { revoked: true, sessions: typeof data === 'number' ? data : 0 };
  } catch (err) {
    console.error('[revokeUserSessions] failed:', err);
    return { revoked: false, sessions: 0 };
  }
}
