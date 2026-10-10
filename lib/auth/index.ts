import { NextResponse } from 'next/server';
import type { AuthProvider } from './types';
import { supabaseAuth } from './supabase';
import { createClient, createAdminClient } from '@/lib/supabase/server';

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

  // Auto-reinstate if suspension expired. Suspension fields are platform-only
  // (migration 067), so the user's own session cannot clear them — the service
  // role does, and only for this user whose suspension has demonstrably expired.
  if (data.suspension_expires_at && new Date(data.suspension_expires_at) < new Date()) {
    await createAdminClient()
      .from('profiles')
      .update({
        is_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        suspension_expires_at: null,
      })
      .eq('id', userId);
    // The Auth ban set at suspension ended with it; lift it explicitly too.
    const { liftBan } = await import('@/lib/auth/sessions');
    await liftBan(userId);
    return { suspended: false };
  }

  return { suspended: true, reason: data.suspension_reason ?? undefined };
}

// ─── Rate Limiting (provider-agnostic) ───────────────────────────────────────

/**
 * Best-effort, per-instance fallback.
 *
 * This used to be THE rate limiter. On Vercel each lambda has its own module
 * scope and that scope dies with the instance, so "5 per minute" was really
 * "5 per minute per warm instance, until it is recycled" -- which under any
 * concurrency is not a limit. It is kept only as a degraded fallback for when
 * the shared counter is unreachable, so a database blip narrows the limit
 * instead of removing it entirely.
 *
 * Do not call this directly. Use checkRateLimit().
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimitInMemory(
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
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

/**
 * Shared rate limiter. Returns true if the request is allowed.
 *
 * Counts live in Postgres (migration 054) and are incremented by a single
 * atomic upsert, so concurrent lambdas cannot each read a stale count and each
 * decide they are under the limit.
 *
 * ASYNC ON PURPOSE, and renamed from the old synchronous version rather than
 * changed in place: `if (!checkRateLimit(key, n, ms))` against a Promise is
 * always falsy, so an in-place change would have silently disabled rate
 * limiting at every call site while still type-checking. Renaming forced every
 * caller to be revisited.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server');
    const { data, error } = await createAdminClient().rpc('rate_limit_hit', {
      p_key: key,
      p_limit: maxRequests,
      p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (err) {
    // Degrade to the per-instance counter rather than failing open. Locking
    // everyone out during a database blip would be worse than a loose limit,
    // but allowing unlimited requests would be worse still.
    console.error('[rate-limit] shared counter unavailable, degraded to in-memory:', err);
    return checkRateLimitInMemory(key, maxRequests, windowMs);
  }
}

// ─── Admin Rate Limiting ────────────────────────────────────────────────────

export type AdminRateTier = 'standard' | 'sensitive';

const ADMIN_RATE_LIMITS: Record<AdminRateTier, { maxRequests: number; windowMs: number }> = {
  standard:  { maxRequests: 30, windowMs: 60_000 },
  sensitive: { maxRequests: 5,  windowMs: 60_000 },
};

/**
 * Rate-limit an admin write operation. Call AFTER requireAdmin().
 * Returns a 429 NextResponse if rate-limited, or null if allowed.
 *
 * Tiers:
 *  - standard (30/min): CRUD on content (rentals, productions, press, careers),
 *    and recording a delivery's progress (lib/delivery/staff-rate-tier.ts)
 *  - sensitive (5/min): payouts, suspensions, role changes, dispute resolution
 */
export async function rateLimitAdmin(
  userId: string,
  tier: AdminRateTier = 'standard',
): Promise<NextResponse | null> {
  const { maxRequests, windowMs } = ADMIN_RATE_LIMITS[tier];
  const key = `admin:${tier}:${userId}`;
  if (!(await checkRateLimit(key, maxRequests, windowMs))) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again shortly.' },
      { status: 429 },
    );
  }
  return null;
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
