export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';
import { email as emailProvider } from '@/lib/email';

// ─── POST — Create a service booking + get Paystack payment URL ──────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Must be logged in to book' }, { status: 401 });
  }

  if (!checkRateLimit(`service-booking:${user.id}`, 5, 60_000)) {
    return NextResponse.json(
      { error: 'Too many booking requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const body = await request.json();
  const {
    creator_id,
    booking_type,
    project_category,
    project_description,
    deliverables,
    duration_hours,
    location,
    preferred_dates,
  } = body;

  // Validate required fields
  if (!project_category || !project_description || !deliverables || !duration_hours) {
    return NextResponse.json({ error: 'Missing required fields: project_category, project_description, deliverables, duration_hours' }, { status: 400 });
  }

  if (typeof duration_hours !== 'number' || duration_hours < STUDIO.booking.minBookingHours || duration_hours > STUDIO.booking.maxBookingHours) {
    return NextResponse.json({ error: `Duration must be between ${STUDIO.booking.minBookingHours} and ${STUDIO.booking.maxBookingHours} hours` }, { status: 400 });
  }

  if (project_description.length < 20) {
    return NextResponse.json({ error: 'Project description must be at least 20 characters' }, { status: 400 });
  }

  // Calculate pricing
  const hourlyRate = getHourlyRate(project_category);
  const subtotal = Math.round(hourlyRate * duration_hours);
  const vat = Math.round(subtotal * (STUDIO.booking.vatRate / 100));
  const total = subtotal + vat;
  const platformAmount = Math.round(total * (STUDIO.booking.platformCommission / 100));
  const creatorAmount = total - platformAmount;

  const reference = `BK-${nanoid(10)}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://thabangvision.com';

  try {
    // Create booking record
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert({
        reference,
        client_id: user.id,
        client_email: user.email,
        creator_id: creator_id || null,
        booking_type: booking_type || 'production',
        project_category,
        project_description,
        deliverables,
        duration_hours,
        location: location || null,
        preferred_dates: preferred_dates || null,
        subtotal,
        vat,
        total,
        platform_commission: STUDIO.booking.platformCommission,
        platform_amount: platformAmount,
        creator_amount: creatorAmount,
        status: 'pending',
        payment_status: 'unpaid',
      })
      .select('id, reference')
      .single();

    if (error || !booking) {
      console.error('[service-bookings] Insert error:', error?.message);
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    // Initialize Paystack payment
    if (!payments.isConfigured()) {
      return NextResponse.json({
        success: true,
        booking: { id: booking.id, reference, total },
        message: 'Booking created. Payment provider not configured — contact admin.',
      });
    }

    const { paymentUrl } = await payments.createCheckout({
      paymentId: reference,
      amount: total,
      itemName: `Booking: ${project_category}`,
      itemDescription: `${project_category} — ${duration_hours}hrs`,
      email: user.email!,
      returnUrl: `${baseUrl}/api/service-bookings/callback?reference=${reference}`,
      cancelUrl: `${baseUrl}/dashboard/bookings?status=cancelled`,
      metadata: {
        customStr1: 'service_booking',
        customStr2: booking.id,
      },
    });

    // Save access code
    await supabase
      .from('bookings')
      .update({ paystack_reference: reference })
      .eq('id', booking.id);

    // Email admin about new booking
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `New booking: ${project_category} — ${reference}`,
        text: `A new service booking has been created.\n\nReference: ${reference}\nClient: ${user.email}\nCategory: ${project_category}\nDuration: ${duration_hours} hours\nTotal: R${total}\n\nThe client has been redirected to Paystack to pay.\n\nView in admin: ${baseUrl}/admin/service-bookings`,
      });
    } catch { /* don't block */ }

    return NextResponse.json({
      success: true,
      booking: { id: booking.id, reference, total },
      paymentUrl,
    });
  } catch (err) {
    console.error('[service-bookings] Unexpected error:', err);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}

// ─── GET — List client's bookings ────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('*, creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)')
    .eq('client_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }

  return NextResponse.json({ bookings: data ?? [] });
}
