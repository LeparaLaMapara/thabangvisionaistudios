export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPayFastConfigured, buildPaymentData, getPayFastUrl } from '@/lib/payfast';
import { STUDIO } from '@/lib/constants';

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
    .select('*')
    .eq('user_id', user.id)
    .order('start_date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { rental_id, start_date, end_date, notes } = body;

  if (!rental_id || !start_date || !end_date) {
    return NextResponse.json(
      { error: 'rental_id, start_date, and end_date are required.' },
      { status: 400 },
    );
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (end <= start) {
    return NextResponse.json(
      { error: 'end_date must be after start_date.' },
      { status: 400 },
    );
  }

  // Fetch the rental item
  const { data: rental, error: rentalError } = await supabase
    .from('smart_rentals')
    .select('id, title, price_per_day, price_per_week, deposit_amount, currency, is_available, quantity')
    .eq('id', rental_id)
    .eq('is_available', true)
    .is('deleted_at', null)
    .single();

  if (rentalError || !rental) {
    return NextResponse.json(
      { error: 'Rental item not found or unavailable.' },
      { status: 404 },
    );
  }

  // Double-booking prevention: check for conflicting bookings
  const { data: conflicts } = await supabase
    .from('equipment_bookings')
    .select('id')
    .eq('rental_id', rental_id)
    .in('status', ['pending', 'confirmed', 'active'])
    .lt('start_date', end_date)
    .gt('end_date', start_date);

  if (conflicts && conflicts.length > 0) {
    return NextResponse.json(
      { error: 'This item is already booked for the selected dates.' },
      { status: 409 },
    );
  }

  // Calculate total price
  const days = Math.ceil(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  let totalPrice: number;
  if (weeks > 0 && rental.price_per_week) {
    totalPrice =
      weeks * rental.price_per_week +
      remainingDays * (rental.price_per_day ?? 0);
  } else {
    totalPrice = days * (rental.price_per_day ?? 0);
  }

  const depositAmount = rental.deposit_amount ?? 0;
  const currency = rental.currency ?? STUDIO.currency.code;

  // Create booking record first (status: pending)
  const { data: booking, error: insertError } = await supabase
    .from('equipment_bookings')
    .insert({
      user_id: user.id,
      rental_id,
      start_date,
      end_date,
      total_price: totalPrice,
      deposit_amount: depositAmount,
      currency,
      status: 'pending',
      notes: notes?.trim() || null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Build PayFast payment data if configured
  let paymentUrl: string | null = null;

  if (isPayFastConfigured() && totalPrice > 0) {
    try {
      const paymentData = buildPaymentData({
        amount: totalPrice,
        itemName: `Rental: ${rental.title ?? 'Equipment'}`,
        itemDescription: `Booking ${start_date} to ${end_date} (${days} days)`,
        email: user.email ?? undefined,
        paymentId: booking.id,
        returnUrl: `/dashboard/bookings/${booking.id}?payment=success`,
        cancelUrl: `/dashboard/bookings/${booking.id}?payment=cancelled`,
        customStr1: 'equipment_booking',
        customStr2: user.id,
        customStr3: rental_id,
      });

      // Build the redirect URL with form params
      const params = new URLSearchParams(paymentData as Record<string, string>);
      paymentUrl = `${getPayFastUrl()}?${params.toString()}`;
    } catch (err) {
      console.error('[bookings] PayFast error:', err);
      // Booking is created but payment URL generation failed — don't fail the whole request
    }
  }

  // Create payment record
  await supabase.from('booking_payments').insert({
    booking_id: booking.id,
    amount: totalPrice,
    currency,
    status: 'pending',
  });

  return NextResponse.json(
    { ...booking, payment_url: paymentUrl },
    { status: 201 },
  );
}
