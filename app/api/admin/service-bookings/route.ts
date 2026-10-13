export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all service bookings (admin) ────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();

  // Only show paid bookings to admin — unpaid/pending auto-cancel after 72h
  const { data, error } = await supabase
    .from('bookings')
    .select('*, creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)')
    .neq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/service-bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }

  // client_id points at auth.users, so the client's name is read separately.
  const rows = (data ?? []) as { client_id: string | null }[];
  const clientIds = [...new Set(rows.map((b) => b.client_id).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (clientIds.length) {
    const { data: people } = await supabase
      .from('profiles')
      .select('id, display_name, first_name, last_name')
      .in('id', clientIds);
    for (const p of (people ?? []) as { id: string; display_name: string | null; first_name: string | null; last_name: string | null }[]) {
      const name = p.display_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      if (name) names.set(p.id, name);
    }
  }

  return NextResponse.json({
    bookings: rows.map((b) => ({ ...b, client_name: (b.client_id && names.get(b.client_id)) || null })),
  });
}
