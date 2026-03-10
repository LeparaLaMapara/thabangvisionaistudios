// ─── Auth Provider Abstraction ────────────────────────────────────────────────

import type { NextResponse } from 'next/server';

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthResult =
  | { user: AuthUser; error?: never }
  | { user?: never; error: NextResponse };

/**
 * Unified auth provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `AUTH_PROVIDER` env var in `lib/auth/index.ts`.
 */
export interface AuthProvider {
  /** Provider identifier (e.g., 'supabase') */
  readonly name: string;

  /**
   * Get the currently authenticated user from the request context.
   * Returns the user or null if not authenticated.
   * For use in Server Components and layouts.
   */
  getUser(): Promise<AuthUser | null>;

  /**
   * Require an authenticated user for an API route.
   * Returns the user or a 401 NextResponse error.
   */
  requireAuth(): Promise<AuthResult>;

  /**
   * Require an admin user for an API route.
   * Returns the user or a 401/403 NextResponse error.
   */
  requireAdmin(): Promise<AuthResult>;

  /**
   * Check if a user (by email) has admin privileges.
   */
  isAdmin(email: string): boolean;

  /**
   * Sign out the current user (client-side).
   * Returns a promise that resolves when sign-out is complete.
   */
  signOut(): Promise<void>;
}
