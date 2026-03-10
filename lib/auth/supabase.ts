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

    if (!this.isAdmin(auth.user.email)) {
      return {
        error: NextResponse.json(
          { error: 'Admin access required.' },
          { status: 403 },
        ),
      };
    }

    return { user: auth.user };
  },

  isAdmin(email: string): boolean {
    return ADMIN_EMAILS.includes(email.toLowerCase());
  },

  async signOut(): Promise<void> {
    // Client-side sign out — uses the browser Supabase client
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    await supabase.auth.signOut();
  },
};
