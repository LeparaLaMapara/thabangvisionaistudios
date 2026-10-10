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

/** Ban length for a suspension with no end date (GoTrue duration string). */
export const INDEFINITE_BAN = '876000h';

/**
 * Ban the Auth user so they cannot sign in again while suspended (Codex
 * review P1: ending the sessions alone let a suspended admin sign straight
 * back in). With `until`, the ban ends then (GoTrue lifts it by itself, as
 * the suspension expires); without, it lasts until liftBan(). Never throws.
 */
export async function banUser(userId: string, until: Date | null): Promise<boolean> {
  const seconds = until ? Math.ceil((until.getTime() - Date.now()) / 1000) : null;
  const ban_duration = seconds === null ? INDEFINITE_BAN : `${Math.max(1, seconds)}s`;
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration });
    if (error) {
      console.error('[banUser] failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[banUser] failed:', err);
    return false;
  }
}

/** Lift a ban (reinstatement). Never throws. */
export async function liftBan(userId: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (error) {
      console.error('[liftBan] failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[liftBan] failed:', err);
    return false;
  }
}
