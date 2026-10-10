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
    try {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = await createClient();

      // Primary: check app_metadata.role (set via Supabase dashboard or service role)
      const { data: { user } } = await supabase.auth.getUser();
      sessionUser = user ?? null;
      if (user && user.id === userId && user.app_metadata?.role === 'admin') return true;

      // Secondary: check profiles.role column
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (data?.role === 'admin') return true;
    } catch (err) {
      // Fall through to the constant, but never silently. A swallowed failure
      // here demotes a real admin to a normal user with no trace of why, and
      // silent catches around Supabase calls have been the single most common
      // source of invisible faults in this codebase.
      console.error('[isAdmin] role lookup failed, falling back to ADMIN_EMAILS:', err);
    }

    // Break-glass (CLAUDE.md level 3): ADMIN_EMAILS, a fixed allowlist, so a
    // database fault cannot lock the owner out of their own admin. Checked
    // against the AUTHENTICATED session's own user, never a passed-in email,
    // and only once that address has been CONFIRMED (Phase 6 security AUTH-1:
    // anyone who could open a session under the address, e.g. a sign-up with
    // e-mail confirmation off, got full admin).
    return isBreakGlassAdmin(sessionUser, userId);
  },

  async signOut(): Promise<void> {
    // Client-side sign out — uses the browser Supabase client
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.auth.signOut();
  },
};
