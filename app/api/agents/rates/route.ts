export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { suggestRates, compareMarketRates } from '@/lib/agents/tools/pricing';
import { releaseMessage, reserveMessage } from '@/lib/agents/usage';

// Daily rate limit for rates agent (per user)
const DAILY_LIMIT = 10;

function getTodaySAST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

// ─── POST — Get rate suggestions or market comparison ───────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const suspendCheck = await checkNotSuspended(auth.user.id);
  if (suspendCheck.suspended) {
    return NextResponse.json(
      { error: `Account suspended: ${suspendCheck.reason ?? 'Contact support.'}` },
      { status: 403 },
    );
  }

  // Burst rate limit
  if (!(await checkRateLimit(`agent-rates:${auth.user.id}`, 5, 60_000))) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      { status: 429 },
    );
  }

  // Daily rate limit: one slot RESERVED atomically before any work (078
  // ubunye_reserve_message), given back if nothing was produced. The old
  // read-then-write let parallel requests pass the cap (security LLM-6).
  const supabase = createAdminClient();
  const todaySAST = getTodaySAST();
  const slot = { userId: auth.user.id, date: todaySAST };
  let reservation;
  try {
    reservation = await reserveMessage(supabase, { ...slot, limit: DAILY_LIMIT });
  } catch (err) {
    console.error('[agents/rates] usage reserve failed:', err);
    return NextResponse.json({ error: 'Rate suggestions are unavailable just now.' }, { status: 503 });
  }
  if (reservation.kind === 'limit_reached') {
    return NextResponse.json(
      { error: 'Daily limit reached for rate suggestions.', limit: DAILY_LIMIT },
      { status: 429 },
    );
  }
  const giveBack = async (): Promise<void> => {
    try {
      await releaseMessage(supabase, slot);
    } catch (err) {
      console.error('[agents/rates] usage release failed:', err);
    }
  };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await giveBack();
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { action } = body as { action?: string };

  try {
    if (action === 'suggest-rates') {
      const suggestions = await suggestRates(auth.user.id);
      return NextResponse.json({ suggestions });
    }

    if (action === 'compare-market') {
      const comparison = await compareMarketRates(auth.user.id);
      return NextResponse.json({ comparison });
    }

    await giveBack();
    return NextResponse.json(
      { error: 'Invalid action. Use "suggest-rates" or "compare-market".' },
      { status: 400 },
    );
  } catch (err) {
    console.error('[agents/rates] Error:', err);
    await giveBack();
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
