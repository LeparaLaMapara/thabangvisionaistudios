export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { newServiceBookingReference } from '@/lib/payments/booking-reference';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';
import { email as emailProvider } from '@/lib/email';
import { logEvent } from '@/lib/data/events';
import { validateBookingRequest } from '@/lib/bookings/validate';
import { quoteHourly, quotePackage, splitServiceBooking } from '@/lib/bookings/pricing';
import { getBookablePackage } from '@/lib/bookings/packages';
import { checkBookableCreator, CREATOR_NOT_BOOKABLE_MESSAGE } from '@/lib/bookings/creator';
import { reportUnpaidRequest, PAYMENTS_OFF_MESSAGE } from '@/lib/payments/offline';
import { revisionPolicyText } from '@/lib/core/services/fulfilment';
import { mentionsFulfilmentSchema, withoutFulfilmentColumns } from '@/lib/supabase/queries/service-bookings';
import { appUrl } from '@/lib/app-url';
import { CLIENT_SERVICE_BOOKING_COLUMNS } from '@/lib/supabase/queries/columns';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

// ─── POST — Create a service booking + get Paystack payment URL ──────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Must be logged in to book' }, { status: 401 });
  }

  // Check if user is suspended
  const { suspended, reason: suspensionReason } = await checkNotSuspended(user.id);
  if (suspended) {
    return NextResponse.json(
      { error: 'Account suspended', reason: suspensionReason },
      { status: 403 },
    );
  }

  if (!(await checkRateLimit(`service-booking:${user.id}`, 5, 60_000))) {
    return NextResponse.json(
      { error: 'Too many booking requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const body = await request.json();

  // A studio package: its title, price and creator come from the database,
  // never from the browser.
  const pkg = typeof body.production_id === 'string' ? await getBookablePackage(supabase, body.production_id) : null;
  if (body.production_id && !pkg) {
    return NextResponse.json({ error: 'This package is no longer available.' }, { status: 404 });
  }
  if (pkg) {
    body.project_category = pkg.title;
    body.creator_id = pkg.creatorId ?? body.creator_id ?? null;
    if (pkg.priceUnit !== 'hour') body.duration_hours = pkg.hours ?? STUDIO.booking.minBookingHours;
  }

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

  // Prevent self-booking (creator cannot be the client — prevents self-payout exploit)
  if (creator_id && creator_id === user.id) {
    return NextResponse.json({ error: 'Cannot book yourself as creator' }, { status: 400 });
  }

  // A named creator (chosen in the form, or the one a package names) must be
  // bookable: ID verified, available for hire, not suspended. The Ubunye
  // path already checks this (lib/agent/offers.ts); this route did not. The
  // read fails closed. No creator named means our team assigns one.
  if (creator_id) {
    if (typeof creator_id !== 'string') {
      return NextResponse.json({ error: CREATOR_NOT_BOOKABLE_MESSAGE, code: 'creator_not_bookable' }, { status: 400 });
    }
    try {
      const creator = await checkBookableCreator(admin(), creator_id);
      if (!creator.ok) {
        return NextResponse.json({ error: CREATOR_NOT_BOOKABLE_MESSAGE, code: 'creator_not_bookable' }, { status: 409 });
      }
    } catch (err) {
      console.error('[service-bookings] creator check failed:', err);
      return NextResponse.json({ error: 'Could not check the creator just now. Please try again.' }, { status: 503 });
    }
  }

  // Validation lives in lib/bookings/validate.ts so it can be tested. It was
  // worth testing: this check used to require `deliverables`, which neither
  // Ubunye's link template nor the booking form has ever supplied, so every
  // studio booking was refused at the pay step.
  const validation = validateBookingRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const {
    projectDescription: descriptionText,
    deliverables: deliverablesText,
  } = validation;

  // Calculate pricing: the package's own price, or the hourly rate.
  const quote = pkg
    ? quotePackage(pkg.price, pkg.priceUnit, duration_hours, STUDIO.booking.vatRate)
    : quoteHourly(getHourlyRate(project_category), duration_hours, STUDIO.booking.vatRate);
  const { subtotal, vat, total } = quote;
  const { platformAmount, creatorAmount } = splitServiceBooking(quote, STUDIO.booking.platformCommission);

  const reference = newServiceBookingReference();
  const baseUrl = appUrl(STUDIO.meta.url);

  try {
    // What was agreed, recorded on the booking at the time it was made
    // (spec §8.3): deliverables, duration, the revision allowance and the
    // cancellation terms. Packages have no structured revision count yet, so
    // every booking gets the default allowance.
    const revisionsIncluded = STUDIO.booking.defaultRevisionsIncluded;
    const terms = {
      revisions_included: revisionsIncluded,
      revision_policy: revisionPolicyText(revisionsIncluded),
      cancellation_policy: STUDIO.booking.cancellationPolicy,
    };

    const row: Record<string, unknown> = {
      reference,
      client_id: user.id,
      client_email: user.email,
      creator_id: creator_id || null,
      booking_type: booking_type || 'production',
      project_category,
      project_description: descriptionText,
      deliverables: deliverablesText,
      duration_hours,
      location: location || null,
      preferred_dates: preferred_dates || null,
      // The booking form sends an ISO date. Promote it to a real column so
      // cancellation notice can actually be measured (migration 040).
      // The AI assistant may send free text, which stays null here.
      shoot_date: toShootDate(preferred_dates),
      subtotal,
      vat,
      total,
      platform_commission: STUDIO.booking.platformCommission,
      platform_amount: platformAmount,
      creator_amount: creatorAmount,
      status: 'pending',
      payment_status: 'unpaid',
      ...terms,
    };

    // Create booking record
    const insert = (values: Record<string, unknown>) => admin()
      .from('bookings')
      .insert(values)
      .select('id, reference')
      .single();
    let { data: booking, error } = await insert(row);
    // Before migration 073 the terms columns do not exist yet.
    if (error && mentionsFulfilmentSchema(error.message)) ({ data: booking, error } = await insert(withoutFulfilmentColumns(row)));

    if (error || !booking) {
      console.error('[service-bookings] Insert error:', error?.message);
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    // Initialize Paystack payment
    if (!payments.isConfigured()) {
      reportUnpaidRequest({
        kind: 'service',
        reference,
        userId: user.id,
        userEmail: user.email,
        amount: total,
        summary: pkg ? `${project_category}: ${quote.line}` : `${project_category}, ${duration_hours} hours`,
      });
      return NextResponse.json({
        success: true,
        booking: { id: booking.id, reference, total },
        payments_offline: true,
        message: PAYMENTS_OFF_MESSAGE,
        terms,
      });
    }

    const { paymentUrl, accessCode } = await payments.createCheckout({
      paymentId: reference,
      amount: total,
      itemName: `Booking: ${project_category}`,
      itemDescription: pkg ? `${project_category} — ${quote.line}` : `${project_category} — ${duration_hours}hrs`,
      email: user.email!,
      returnUrl: `${baseUrl}/api/service-bookings/callback?reference=${reference}`,
      cancelUrl: `${baseUrl}/dashboard/bookings?status=cancelled&ref=${reference}`,
      metadata: {
        customStr1: 'service_booking',
        customStr2: booking.id,
      },
    });

    // Save access code + reference
    // Not needed to confirm the payment (the webhook finds the booking by
    // `reference`), so a failure is logged and the client still gets the link.
    const { error: refError } = await admin()
      .from('bookings')
      .update({ paystack_reference: reference, paystack_access_code: accessCode || null })
      .eq('id', booking.id);
    if (refError) console.error('[service-bookings] Could not save the payment reference:', booking.id, refError.message);

    // Email admin about new booking
    try {
      await emailProvider.sendEmail({
        to: STUDIO.bookingEmail,
        subject: `New booking: ${project_category} — ${reference}`,
        text: `A new service booking has been created.\n\nReference: ${reference}\nClient: ${user.email}\nCategory: ${project_category}\nDuration: ${duration_hours} hours\nTotal: R${total}\n\nThe client has been redirected to Paystack to pay.\n\nView in admin: ${baseUrl}/admin/service-bookings`,
      });
    } catch { /* don't block */ }

    logEvent({
      eventType: 'booking_created',
      eventCategory: 'booking',
      userId: user.id,
      metadata: { reference, project_category, duration_hours, total, has_creator: !!creator_id },
    });

    return NextResponse.json({
      success: true,
      booking: { id: booking.id, reference, total },
      paymentUrl,
      terms,
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
    .select(`${CLIENT_SERVICE_BOOKING_COLUMNS}, creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)`)
    .eq('client_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }

  // The client's own session cannot read another person's profile row, so the
  // join above comes back empty and the client never saw who their creator
  // is. Their public card (public_profiles: name, photo, slug) fills it in.
  type Row = Record<string, unknown> & { creator_id?: string | null; creator?: unknown };
  const rows = (data ?? []) as unknown as Row[];
  const missing = [...new Set(rows.filter((r) => r.creator_id && !r.creator).map((r) => r.creator_id as string))];
  if (missing.length > 0) {
    const { data: cards } = await supabase.from('public_profiles').select('id, display_name, avatar_url, crew_slug').in('id', missing);
    const byId = new Map(((cards ?? []) as { id: string }[]).map((c) => [c.id, c]));
    for (const r of rows) if (!r.creator && r.creator_id) r.creator = byId.get(r.creator_id) ?? null;
  }

  return NextResponse.json({ bookings: rows });
}

/**
 * Accepts a YYYY-MM-DD string and returns it, or null for anything else.
 * The booking form uses <input type="date">, so it always sends this shape;
 * the Ubunye assistant can send genuinely free text ("first week of March"),
 * which we deliberately do not guess at.
 */
function toShootDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}
