import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_EMAILS } from '@/lib/constants';

type AuthResult =
  | { user: { id: string; email: string }; error?: never }
  | { user?: never; error: NextResponse };

type AdminResult =
  | { user: { id: string; email: string }; error?: never }
  | { user?: never; error: NextResponse };

/**
 * Require an authenticated user for an API route.
 * Returns the user object or a 401 NextResponse error.
 */
export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return {
      error: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }

  return { user: { id: user.id, email: user.email } };
}

/**
 * Require an authenticated admin user for an API route.
 * Returns 401 if not authenticated, 403 if not an admin.
 */
export async function requireAdmin(): Promise<AdminResult> {
  const auth = await requireAuth();
  if (auth.error) return auth;

  if (!isAdmin(auth.user.email)) {
    return {
      error: NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      ),
    };
  }

  return { user: auth.user };
}

/**
 * Check if an email address belongs to an admin.
 */
export function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ─── Rate Limiting (in-memory, per-user) ─────────────────────────────────────

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
