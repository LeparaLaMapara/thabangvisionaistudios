export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'start_date and end_date query params are required.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Check the rental exists
  const { data: rental, error: rentalError } = await supabase
    .from('smart_rentals')
    .select('id, is_available, quantity')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (rentalError || !rental) {
    return NextResponse.json(
      { error: 'Rental item not found.' },
      { status: 404 },
    );
  }

  if (!rental.is_available) {
    return NextResponse.json({ available: false, reason: 'Item is marked unavailable.' });
  }

  // Find conflicting bookings
  const { data: conflicts } = await supabase
    .from('equipment_bookings')
    .select('id, start_date, end_date, status')
    .eq('rental_id', id)
    .in('status', ['pending', 'confirmed', 'active'])
    .lt('start_date', endDate)
    .gt('end_date', startDate);

  const bookedCount = conflicts?.length ?? 0;
  const totalQuantity = rental.quantity ?? 1;
  const available = bookedCount < totalQuantity;

  // M3: Only return availability status, not booking details
  return NextResponse.json({
    available,
    booked_count: bookedCount,
    total_quantity: totalQuantity,
  });
}
