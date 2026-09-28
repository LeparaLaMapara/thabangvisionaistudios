export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { paymentReference } from '@/lib/payments/eft';

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
      // profiles has no email column (emails live in auth.users); asking for
      // one made this query fail, so the admin Bookings page never loaded.
      '*, rental:smart_rentals!rental_id(id, title, category), user:profiles!user_id(id, display_name, first_name, last_name)',
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
  // The whole order's amount lives on its first line; every line gets it, so
  // the owner can match an EFT to its reference and amount at a glance.
  const orderAmount = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.amount_due != null) orderAmount.set(row.checkout_group_id ?? row.id, Number(row.amount_due));
  }

  // Emails come from auth, once per customer.
  const emails = new Map<string, string>();
  for (const uid of new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean))) {
    const { data: u } = await supabase.auth.admin.getUserById(uid);
    if (u?.user?.email) emails.set(uid, u.user.email);
  }

  const bookings = (data ?? []).map((row) => {
    const rental = row.rental as { id: string; title: string; category: string } | null;
    const user = row.user as { id: string; display_name: string | null; first_name: string | null; last_name: string | null } | null;
    return {
      ...row,
      rental_title: rental?.title ?? 'Unknown',
      rental_category: rental?.category ?? '',
      user_email: emails.get(row.user_id) ?? '',
      user_name: user?.display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || null),
      payment_reference: paymentReference(row.checkout_group_id ?? row.id),
      order_amount_due: orderAmount.get(row.checkout_group_id ?? row.id) ?? null,
      // Remove nested objects to keep response flat
      rental: undefined,
      user: undefined,
    };
  });

  return NextResponse.json(bookings);
}
