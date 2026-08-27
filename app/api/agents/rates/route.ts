export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { suggestRates, compareMarketRates } from '@/lib/agents/tools/pricing';

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

  // Daily rate limit
  const supabase = createAdminClient();
  const todaySAST = getTodaySAST();
  const { data: usage } = await supabase
    .from('ubunye_usage')
    .select('id, message_count')
    .eq('user_id', auth.user.id)
    .eq('date', todaySAST)
    .single();

  const currentCount = usage?.message_count ?? 0;
  if (currentCount >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: 'Daily limit reached for rate suggestions.', limit: DAILY_LIMIT },
      { status: 429 },
    );
  }

  // Increment usage
  if (usage) {
    await supabase.from('ubunye_usage').update({ message_count: currentCount + 1 }).eq('id', usage.id);
  } else {
    await supabase.from('ubunye_usage').insert({ user_id: auth.user.id, date: todaySAST, message_count: 1 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
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

    return NextResponse.json(
      { error: 'Invalid action. Use "suggest-rates" or "compare-market".' },
      { status: 400 },
    );
  } catch (err) {
    console.error('[agents/rates] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
