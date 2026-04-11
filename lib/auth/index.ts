import type { AuthProvider } from './types';
import { supabaseAuth } from './supabase';
import { createClient } from '@/lib/supabase/server';

// Re-export types for convenience
export type { AuthProvider, AuthUser, AuthResult } from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, AuthProvider> = {
  supabase: supabaseAuth,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.AUTH_PROVIDER ?? 'supabase').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[auth] Unknown AUTH_PROVIDER="${providerName}". Falling back to supabase. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active auth provider, determined by `AUTH_PROVIDER` env var.
 * Defaults to Supabase if not set or unrecognized.
 */
export const auth: AuthProvider = providers[providerName] ?? supabaseAuth;

// ─── Convenience re-exports ──────────────────────────────────────────────────
// These delegate to the active provider for backward compatibility.

export async function requireAuth() {
  return auth.requireAuth();
}

export async function requireAdmin() {
  return auth.requireAdmin();
}

export function isAdmin(userId: string, email?: string) {
  return auth.isAdmin(userId, email);
}

// ─── Suspension Check ───────────────────────────────────────────────────────

export async function checkNotSuspended(userId: string): Promise<{
  suspended: boolean;
  reason?: string;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('is_suspended, suspension_reason, suspension_expires_at')
    .eq('id', userId)
    .single();

  if (!data?.is_suspended) return { suspended: false };

  // Auto-reinstate if suspension expired
  if (data.suspension_expires_at && new Date(data.suspension_expires_at) < new Date()) {
    await supabase
      .from('profiles')
      .update({
        is_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        suspension_expires_at: null,
      })
      .eq('id', userId);
    return { suspended: false };
  }

  return { suspended: true, reason: data.suspension_reason ?? undefined };
}

// ─── Rate Limiting (provider-agnostic) ───────────────────────────────────────

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-memory rate limiter.
 * Returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Validate that a URL uses a safe protocol (http/https only).
 * Blocks javascript:, data:, and other dangerous protocols.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
