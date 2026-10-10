import { NextResponse } from 'next/server';
import { ADMIN_EMAILS } from '@/lib/constants';
import type { AuthProvider, AuthUser, AuthResult } from './types';

// ─── Break-glass admin (ADMIN_EMAILS) ────────────────────────────────────────

export interface BreakGlassUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

/**
 * True only when the session's user is the user being checked, their email is
 * in ADMIN_EMAILS, and that email has been confirmed (email_confirmed_at set
 * by Supabase Auth after the mailbox owner proved control of it).
 */
export function isBreakGlassAdmin(sessionUser: BreakGlassUser | null | undefined, userId: string): boolean {
  if (!sessionUser || sessionUser.id !== userId) return false;
  const email = sessionUser.email?.toLowerCase();
  if (!email || !ADMIN_EMAILS.some((a) => a.toLowerCase() === email)) return false;
  return Boolean(sessionUser.email_confirmed_at);
}

interface AdminProfileRow {
  role?: string | null;
  is_suspended?: boolean | null;
  suspension_expires_at?: string | null;
}

/** Suspended and not yet expired (as checkNotSuspended reads it). */
function isSuspendedNow(p: AdminProfileRow | null): boolean {
  if (!p?.is_suspended) return false;
  return !(p.suspension_expires_at && new Date(p.suspension_expires_at) < new Date());
}

// ─── Supabase Auth Provider ──────────────────────────────────────────────────

export const supabaseAuth: AuthProvider = {
  name: 'supabase',

  async getUser(): Promise<AuthUser | null> {
    // Dynamic import to avoid pulling server code into client bundles
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) return null;
    return { id: user.id, email: user.email };
  },

  async requireAuth(): Promise<AuthResult> {
    const user = await this.getUser();

    if (!user) {
      return {
        error: NextResponse.json(
          { error: 'Authentication required.' },
          { status: 401 },
        ),
      };
    }

    return { user };
  },

  async requireAdmin(): Promise<AuthResult> {
    const auth = await this.requireAuth();
    if (auth.error) return auth;

    const admin = await this.isAdmin(auth.user.id, auth.user.email);
    if (!admin) {
      return {
        error: NextResponse.json(
          { error: 'Admin access required.' },
          { status: 403 },
        ),
      };
    }

    return { user: auth.user };
  },

  async isAdmin(userId: string): Promise<boolean> {
    // The session's own user record, fresh from the Auth server (getUser()
    // validates the token with Supabase Auth; it is not a decoded JWT).
    let sessionUser: BreakGlassUser | null = null;
    // One profile read serves both the role (level 2) and the suspension check.
    let profile: AdminProfileRow | null | undefined;
    let granted = false;
    try {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = await createClient();

      // Primary: check app_metadata.role (set via Supabase dashboard or service role)
      const { data: { user } } = await supabase.auth.getUser();
      sessionUser = user ?? null;
      if (user && user.id === userId && user.app_metadata?.role === 'admin') granted = true;

      const { data, error } = await supabase
        .from('profiles')
        .select('role, is_suspended, suspension_expires_at')
        .eq('id', userId)
        .single();
      profile = error ? undefined : ((data as AdminProfileRow | null) ?? null);

      // Secondary: check profiles.role column
      if (profile?.role === 'admin') granted = true;
    } catch (err) {
      // Never silently: a swallowed failure here is invisible. Since Codex
      // review P1 the profile (suspension) must be readable for ANY level to
      // grant admin, so a database fault now fails closed.
      console.error('[isAdmin] role/suspension lookup failed; admin refused:', err);
      profile = undefined;
    }

    // Break-glass (CLAUDE.md level 3): ADMIN_EMAILS, a fixed allowlist.
    // Checked against the AUTHENTICATED session's own user, never a
    // passed-in email, and only once that address has been CONFIRMED (Phase
    // 6 security AUTH-1).
    if (!granted) granted = isBreakGlassAdmin(sessionUser, userId);
    if (!granted) return false;

    // A suspended account is never admin, whichever level granted it (Codex
    // review P1: a suspended admin could sign in again and use /admin). If
    // the profile could not be read, suspension is unknown: refuse.
    if (profile === undefined) {
      console.error('[isAdmin] profile unreadable; admin refused (fail closed):', userId);
      return false;
    }
    return !isSuspendedNow(profile);
  },

  async signOut(): Promise<void> {
    // Client-side sign out — uses the browser Supabase client
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.auth.signOut();
  },
};
