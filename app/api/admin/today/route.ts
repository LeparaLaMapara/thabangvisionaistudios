export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { loadTodayFacts } from '@/lib/admin/control-room/load';
import { buildToday } from '@/lib/admin/control-room/today';

/**
 * The menu's waiting counts (the numbers beside "ID checks", "Disputes" and
 * so on). The Today page itself renders on the server; this is for every
 * other admin page, read after the page has shown.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const facts = await loadTodayFacts(createAdminClient());
    const view = buildToday(facts, {});
    return NextResponse.json(
      { counts: view.counts, areas: view.areas, needs: view.needs.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[admin/today] failed:', err);
    return NextResponse.json({ error: 'Could not read the counts.' }, { status: 500 });
  }
}
