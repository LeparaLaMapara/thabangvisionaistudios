import { NextResponse } from 'next/server';
import { ADMIN_EMAILS } from '@/lib/constants';
import type { AuthProvider, AuthUser, AuthResult } from './types';

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

  async isAdmin(userId: string, email?: string): Promise<boolean> {
    try {
      const { createClient } = await import('@/lib/supabase/server');
      const supabase = await createClient();

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (data?.role === 'admin') return true;
    } catch {
      // DB check failed — fall through to constant fallback
    }

    // Fallback: check ADMIN_EMAILS constant so you're never locked out
    if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return true;

    return false;
  },

  async signOut(): Promise<void> {
    // Client-side sign out — uses the browser Supabase client
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.auth.signOut();
  },
};
