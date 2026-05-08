export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { recalculateAllRankings } from '@/lib/ranking/calculate';

// ─── POST — Recalculate all rental ranking scores (admin only) ──────────────

export async function POST() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const supabase = createAdminClient();
    const result = await recalculateAllRankings(supabase);

    return NextResponse.json({
      success: true,
      count: result.count,
      durationMs: result.durationMs,
    });
  } catch (err) {
    console.error('[admin/recalculate-rankings] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to recalculate rankings.' },
      { status: 500 },
    );
  }
}
