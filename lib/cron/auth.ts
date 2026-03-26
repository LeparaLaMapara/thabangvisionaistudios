import { NextRequest, NextResponse } from 'next/server';

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

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
