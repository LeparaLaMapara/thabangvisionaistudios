export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all service bookings (admin) ────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bookings')
    .select('*, creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/service-bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }

  return NextResponse.json({ bookings: data ?? [] });
}
