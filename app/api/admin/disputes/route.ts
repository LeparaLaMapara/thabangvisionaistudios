export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

const VALID_STATUSES = ['open', 'investigating', 'resolved', 'escalated', 'dismissed'];
const VALID_TYPES = [
  'gear_damage', 'gear_not_returned', 'creator_no_show',
  'client_cancellation', 'quality_dispute', 'payment_dispute',
];

// ─── GET — Admin list all disputes ──────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const pageStr = searchParams.get('page') ?? '1';
  const limitStr = searchParams.get('limit') ?? '20';

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const supabase = createAdminClient();

    let query = supabase
      .from('disputes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && VALID_STATUSES.includes(status)) {
      query = query.eq('status', status);
    }
    if (type && VALID_TYPES.includes(type)) {
      query = query.eq('dispute_type', type);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('[admin/disputes] Query error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch disputes.' }, { status: 500 });
    }

    // Get status counts for tabs
    const { data: countData } = await supabase
      .from('disputes')
      .select('status');

    const counts: Record<string, number> = {
      all: 0,
      open: 0,
      investigating: 0,
      resolved: 0,
      escalated: 0,
      dismissed: 0,
    };

    for (const row of countData ?? []) {
      counts.all++;
      const s = row.status as string;
      if (s in counts) counts[s]++;
    }

    return NextResponse.json({
      disputes: data ?? [],
      total: count ?? 0,
      page,
      limit,
      counts,
    });
  } catch (err) {
    console.error('[admin/disputes] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
