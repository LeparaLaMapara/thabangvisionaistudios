export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all bug reports (admin only) ────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/bug-reports] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}
