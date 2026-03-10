import type { AuthProvider } from './types';
import { supabaseAuth } from './supabase';

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

export function isAdmin(email: string) {
  return auth.isAdmin(email);
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
