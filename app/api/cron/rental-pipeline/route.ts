export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { runRentalPipeline } from '@/lib/rental/pipeline';

/**
 * Daily rental pipeline pass at 05:45 UTC = 07:45 SAST (collection reminders
 * go out then). Daily because the current Vercel plan rejects sub-daily crons
 * (CLAUDE.md). Webhooks, checkouts and admin actions do their own work
 * immediately; this pass retries and sweeps up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;
  const result = await runRentalPipeline();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
