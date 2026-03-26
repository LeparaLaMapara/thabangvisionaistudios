export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix', 'duplicate'] as const;

// ─── PATCH — Update bug report status/notes (admin only) ────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const { status, admin_notes } = body;

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = status;
  }

  if (admin_notes !== undefined) {
    update.admin_notes = admin_notes;
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bug_reports')
    .update(update)
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[admin/bug-reports] PATCH error:', error.message);
    return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
