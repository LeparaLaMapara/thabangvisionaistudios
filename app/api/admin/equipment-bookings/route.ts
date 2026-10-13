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
      '*, rental:smart_rentals!rental_id(id, title, category), user:profiles!user_id(id, display_name, first_name, last_name, phone, verification_status)',
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

  // Emails come from auth, once per customer, a few at a time (one by one
  // took seconds once there were dozens of customers).
  const emails = new Map<string, string>();
  const uids = [...new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean))];
  for (let i = 0; i < uids.length; i += 10) {
    await Promise.all(
      uids.slice(i, i + 10).map(async (uid) => {
        const { data: u } = await supabase.auth.admin.getUserById(uid);
        if (u?.user?.email) emails.set(uid, u.user.email);
      }),
    );
  }

  // Open disputes, so a booking shows it has one.
  const openDispute = new Map<string, string>();
  const bookingIds = (data ?? []).map((r) => r.id as string);
  if (bookingIds.length) {
    const { data: disputes } = await supabase
      .from('disputes')
      .select('id, equipment_booking_id')
      .in('equipment_booking_id', bookingIds)
      .in('status', ['open', 'investigating', 'escalated']);
    for (const d of (disputes ?? []) as { id: string; equipment_booking_id: string | null }[]) {
      if (d.equipment_booking_id) openDispute.set(d.equipment_booking_id, d.id);
    }
  }

  const bookings = (data ?? []).map((row) => {
    const rental = row.rental as { id: string; title: string; category: string } | null;
    const user = row.user as {
      id: string; display_name: string | null; first_name: string | null; last_name: string | null;
      phone: string | null; verification_status: string | null;
    } | null;
    return {
      ...row,
      rental_title: rental?.title ?? 'Unknown',
      rental_category: rental?.category ?? '',
      user_email: emails.get(row.user_id) ?? '',
      user_name: user?.display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || null),
      payment_reference: paymentReference(row.checkout_group_id ?? row.id),
      order_amount_due: orderAmount.get(row.checkout_group_id ?? row.id) ?? null,
      user_phone: user?.phone ?? null,
      user_verification: user?.verification_status ?? null,
      open_dispute_id: openDispute.get(row.id) ?? null,
      // Remove nested objects to keep response flat
      rental: undefined,
      user: undefined,
    };
  });

  return NextResponse.json(bookings);
}
