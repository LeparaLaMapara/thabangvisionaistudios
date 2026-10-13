export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * Retired subscription initiation path (Phase 0, 2026-10-08).
 *
 * This route used to create a subscription with the user's own session and
 * without recording the price the server expected, so a webhook could never
 * check the amount paid against it. Every subscription now starts at
 * POST /api/payfast/checkout, which resolves the plan and price on the server
 * and records the expected amount for the webhook to verify.
 *
 * GET /api/subscriptions/me, /plans and /cancel are separate routes and are
 * unaffected.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint is retired. Start a subscription from the pricing page.' },
    { status: 410 },
  );
}
