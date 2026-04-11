export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — Fetch moderation log for a user (admin only) ─────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id: targetUserId } = await params;

  try {
    const supabase = createAdminClient();

    const { data: entries, error } = await supabase
      .from('moderation_log')
      .select('id, user_id, action, reason, admin_id, dispute_id, metadata, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin/users/moderation-log] Fetch error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch moderation log.' }, { status: 500 });
    }

    return NextResponse.json(entries ?? []);
  } catch (err) {
    console.error('[admin/users/moderation-log] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
