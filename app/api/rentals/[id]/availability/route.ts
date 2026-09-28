export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { availabilityFor } from '@/lib/rental/availability-server';

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

  // Every customer's bookings count, not only the visitor's own.
  let result;
  try {
    result = await availabilityFor({ rentalId: id, stock: rental.quantity, startDate, endDate });
  } catch (err) {
    console.error('[rentals/availability]', err);
    return NextResponse.json({ error: 'Could not check availability just now.' }, { status: 503 });
  }
  const bookedCount = result.booked;
  const totalQuantity = result.stock;
  const available = result.available;

  // M3: Only return availability status, not booking details
  return NextResponse.json({
    available,
    booked_count: bookedCount,
    total_quantity: totalQuantity,
  });
}
