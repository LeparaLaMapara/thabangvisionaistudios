export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all equipment bookings (admin) ─────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = createAdminClient();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  let query = supabase
    .from('equipment_bookings')
    .select(
      '*, rental:smart_rentals!rental_id(id, title, category), user:profiles!user_id(id, email, display_name)',
    )
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[admin/equipment-bookings] GET error:', error.message);
    return NextResponse.json(
      { error: 'Failed to fetch equipment bookings' },
      { status: 500 },
    );
  }

  // Flatten joined fields for the admin UI
  const bookings = (data ?? []).map((row) => {
    const rental = row.rental as { id: string; title: string; category: string } | null;
    const user = row.user as { id: string; email: string; display_name: string | null } | null;
    return {
      ...row,
      rental_title: rental?.title ?? 'Unknown',
      rental_category: rental?.category ?? '',
      user_email: user?.email ?? '',
      user_name: user?.display_name ?? null,
      // Remove nested objects to keep response flat
      rental: undefined,
      user: undefined,
    };
  });

  return NextResponse.json(bookings);
}
