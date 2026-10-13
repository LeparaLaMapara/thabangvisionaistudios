export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RENTER_EQUIPMENT_BOOKING_COLUMNS } from '@/lib/supabase/queries/columns';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('equipment_bookings')
    .select(`${RENTER_EQUIPMENT_BOOKING_COLUMNS}, smart_rentals(title)`)
    .eq('user_id', user.id)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('[bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings.' }, { status: 500 });
  }

  // The list names each booking by what was rented, as the booking page does.
  type Row = Record<string, unknown> & { smart_rentals?: { title?: string | null } | { title?: string | null }[] | null };
  return NextResponse.json(
    ((data ?? []) as unknown as Row[]).map(({ smart_rentals: rental, ...row }) => ({
      ...row,
      rental_title: (Array.isArray(rental) ? rental[0]?.title : rental?.title) ?? null,
    })),
  );
}

/**
 * Retired single-item booking path (Phase 1, 2026-10-08).
 *
 * It read availability and then inserted, with no lock, used the old trust
 * ladder, and started a payment with no recorded expected amount. Nothing in
 * the app called it. Every gear hire now goes through POST /api/cart/checkout,
 * which reserves under a database lock, records the expected payment and
 * applies the server-side trust tiers.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint is retired. Add the item to your cart and check out.', code: 'USE_CART_CHECKOUT' },
    { status: 410 },
  );
}
