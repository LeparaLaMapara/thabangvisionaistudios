import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Constant-time string comparison (security AUTH-5): both sides are hashed
 * to a fixed length first, so neither the content nor the length of the
 * secret leaks through response timing.
 */
export function secretsEqual(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Validates that a cron request has the correct CRON_SECRET bearer token.
 * Vercel sends this automatically for configured cron jobs.
 * Returns null if valid, or an error response if invalid.
 */
export function validateCronAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  if (!secretsEqual(authHeader ?? '', `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
