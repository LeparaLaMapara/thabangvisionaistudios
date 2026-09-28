export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { meetsLeadTime, leadTimeMessage } from '@/lib/rental/leadTime';
import { logEvent } from '@/lib/data/events';
import { reportUnpaidRequest, PAYMENTS_OFF_MESSAGE } from '@/lib/payments/offline';
import { checkProtection, itemValue } from '@/lib/rental/protection';
import { loadRenterRecord } from '@/lib/rental/protection-server';
import { availabilityFor } from '@/lib/rental/availability-server';
import { availabilityMessage } from '@/lib/rental/availability';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

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
    console.error('[bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings.' }, { status: 500 });
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

  // Check if user is suspended
  const { suspended, reason: suspensionReason } = await checkNotSuspended(user.id);
  if (suspended) {
    return NextResponse.json(
      { error: 'Account suspended', reason: suspensionReason },
      { status: 403 },
    );
  }

  // The ID check and the notice period are enforced here, not only by hiding
  // the button: dates and prices are now shown to everyone, and a hidden
  // button never stopped anyone calling this route directly. Same rules as
  // the cart checkout.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('id', user.id)
    .single();
  if (profileError) {
    console.error('[bookings] profile read failed:', profileError.message);
    return NextResponse.json({ error: 'Could not check your account. Please try again.' }, { status: 500 });
  }
  if (profile?.verification_status !== 'verified') {
    logEvent({ eventType: 'booking_blocked', eventCategory: 'booking', userId: user.id, metadata: { reason: 'verification_required', kind: 'gear' } });
    return NextResponse.json(
      { error: 'Identity verification is required to rent equipment.', code: 'verification_required' },
      { status: 403 },
    );
  }

  // H3: Rate limit booking creation — 5 requests per minute per user
  if (!(await checkRateLimit(`booking:${user.id}`, 5, 60_000))) {
    return NextResponse.json(
      { error: 'Too many booking requests. Please wait before trying again.' },
      { status: 429 },
    );
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

  // M8: Validate dates are in the future
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (start < now) {
    return NextResponse.json(
      { error: 'Cannot book for past dates.' },
      { status: 400 },
    );
  }

  if (!meetsLeadTime(start_date, new Date())) {
    logEvent({ eventType: 'booking_blocked', eventCategory: 'booking', userId: user.id, metadata: { reason: 'lead_time', kind: 'gear', start_date } });
    return NextResponse.json({ error: leadTimeMessage(new Date()) }, { status: 400 });
  }

  const bookingDays = Math.ceil(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  // The Terms allow an online hire of up to maxBookingDays; longer is arranged with us.
  if (bookingDays > STUDIO.rental.maxBookingDays) {
    return NextResponse.json(
      { error: `Online hires run up to ${STUDIO.rental.maxBookingDays} days. For longer, contact us.` },
      { status: 400 },
    );
  }

  // Fetch the rental item
  const { data: rental, error: rentalError } = await supabase
    .from('smart_rentals')
    .select('id, title, price_per_day, price_per_week, deposit_amount, replacement_value, currency, is_available, quantity')
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

  // Trust ladder (TASK-067): a limit on gear value at a time, rising with
  // clean returns. Told before payment, with what raises it.
  const record = await loadRenterRecord(admin(), user.id);
  const protection = checkProtection({ ...record, orderValue: itemValue(rental), delivery: false });
  if (!protection.ok) {
    logEvent({ eventType: 'booking_blocked', eventCategory: 'booking', userId: user.id, metadata: { reason: protection.code, kind: 'gear', rentalId: rental_id } });
    return NextResponse.json({ error: protection.message, code: protection.code }, { status: 403 });
  }

  // M9: Deduplication — reject if same user+rental+dates was created in the last 60 seconds
  const recentCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: duplicates } = await supabase
    .from('equipment_bookings')
    .select('id')
    .eq('user_id', user.id)
    .eq('rental_id', rental_id)
    .eq('start_date', start_date)
    .eq('end_date', end_date)
    .gte('created_at', recentCutoff)
    .limit(1);

  if (duplicates && duplicates.length > 0) {
    return NextResponse.json(
      { error: 'Duplicate booking detected. Please wait before trying again.' },
      { status: 409 },
    );
  }

  // Double-booking prevention. Reads every customer's bookings (not only
  // this visitor's) and counts units, so a listing with two cameras rents two.
  let availability;
  try {
    availability = await availabilityFor({ rentalId: rental_id, stock: rental.quantity, startDate: start_date, endDate: end_date });
  } catch (err) {
    console.error('[bookings] availability check failed:', err);
    return NextResponse.json({ error: 'Could not confirm availability just now. Please try again.' }, { status: 503 });
  }
  if (!availability.available) {
    return NextResponse.json({ error: availabilityMessage(rental.title ?? 'This item', availability) }, { status: 409 });
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
  const { data: booking, error: insertError } = await admin()
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
    console.error('[bookings] Insert error:', insertError.message);
    return NextResponse.json({ error: 'Failed to create booking.' }, { status: 500 });
  }

  // Build payment checkout URL if configured
  let paymentUrl: string | null = null;

  if (payments.isConfigured() && totalPrice > 0) {
    try {
      const checkout = await payments.createCheckout({
        paymentId: booking.id,
        amount: totalPrice,
        itemName: `Rental: ${rental.title ?? 'Equipment'}`,
        itemDescription: `Booking ${start_date} to ${end_date} (${days} days)`,
        email: user.email ?? undefined,
        returnUrl: `/dashboard/bookings/${booking.id}?payment=success`,
        cancelUrl: `/dashboard/bookings/${booking.id}?payment=cancelled`,
        metadata: {
          customStr1: 'equipment_booking',
          customStr2: user.id,
          customStr3: rental_id,
        },
      });
      paymentUrl = checkout.paymentUrl;
    } catch (err) {
      console.error('[bookings] Payment error:', err);
      // Booking is created but payment URL generation failed — don't fail the whole request
    }
  }

  // Create payment record
  await admin().from('booking_payments').insert({
    booking_id: booking.id,
    amount: totalPrice,
    currency,
    status: 'pending',
  });

  logEvent({
    eventType: 'booking_created',
    eventCategory: 'booking',
    userId: user.id,
    metadata: { kind: 'gear', source: 'listing', bookingId: booking.id, rentalId: rental_id, amount: totalPrice, paymentLink: Boolean(paymentUrl) },
  });

  if (!payments.isConfigured() && totalPrice > 0) {
    reportUnpaidRequest({
      kind: 'gear',
      reference: booking.id,
      userId: user.id,
      userEmail: user.email,
      amount: totalPrice,
      summary: `${rental.title ?? 'Equipment'}, ${start_date} to ${end_date}`,
    });
    return NextResponse.json(
      { ...booking, payment_url: null, payments_offline: true, message: PAYMENTS_OFF_MESSAGE },
      { status: 201 },
    );
  }

  return NextResponse.json(
    { ...booking, payment_url: paymentUrl },
    { status: 201 },
  );
}
