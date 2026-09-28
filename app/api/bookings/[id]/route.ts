export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { refundPayment } from '@/lib/payments/paystack';
import {
  bulkDiscountPercentFor,
  calculateCancellationRefund,
  isCancellableStatus,
  paidOnlineForLine,
} from '@/lib/rental/cancellation';
import { logEvent } from '@/lib/data/events';

type BookingForQuote = {
  id: string;
  start_date: string;
  created_at: string;
  total_price: number | null;
  deposit_amount: number | null;
  delivery_fee: number | null;
  payment_plan: string | null;
  checkout_group_id: string | null;
};

/**
 * Prices a cancellation from what was actually paid online for this line.
 * A cart order shares one payment: the bulk discount depends on the whole
 * order's size, and the delivery fee is refunded once, when the last line
 * still active in the order is cancelled.
 */
async function quoteCancellation(
  booking: BookingForQuote,
): Promise<ReturnType<typeof calculateCancellationRefund>> {
  let discountPercent = 0;
  let deliveryFee = 0;

  if (booking.checkout_group_id) {
    const { data: group } = await createAdminClient()
      .from('equipment_bookings')
      .select('id, quantity, status, delivery_fee')
      .eq('checkout_group_id', booking.checkout_group_id);
    const lines = group ?? [];
    discountPercent = bulkDiscountPercentFor(
      lines.reduce((sum, l) => sum + (Number(l.quantity) || 1), 0),
    );
    const othersActive = lines.some((l) => l.id !== booking.id && l.status !== 'cancelled');
    if (!othersActive) {
      deliveryFee = lines.reduce((sum, l) => sum + Number(l.delivery_fee ?? 0), 0);
    }
  }

  const paid = paidOnlineForLine({
    totalPrice: Number(booking.total_price ?? 0),
    depositAmount: Number(booking.deposit_amount ?? 0),
    deliveryFee,
    paymentPlan: booking.payment_plan,
    checkoutGroupId: booking.checkout_group_id,
    discountPercent,
  });

  return calculateCancellationRefund({
    startDate: booking.start_date,
    totalPrice: paid.hire,
    depositAmount: paid.deposit,
    deliveryFee: paid.delivery,
    bookedAt: booking.created_at,
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    console.error('[bookings/[id]] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch booking.' }, { status: 500 });
  }

  // Let the client show what a cancellation would return before confirming it.
  const cancellation = isCancellableStatus(data.status)
    ? await quoteCancellation(data as BookingForQuote)
    : null;

  return NextResponse.json({ ...data, cancellation });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { status, notes } = body;

  // H7: Users can only cancel their own bookings. Other transitions are
  // system-only, driven by the payment webhook and the return pipeline.
  const userAllowedStatuses = ['cancelled'];
  if (status && !userAllowedStatuses.includes(status)) {
    return NextResponse.json(
      { error: 'You can only cancel bookings.' },
      { status: 403 },
    );
  }

  // Read first: a cancellation needs the dates and amounts to price the refund,
  // and we must not cancel equipment that is already out on hire.
  const { data: booking, error: readError } = await supabase
    .from('equipment_bookings')
    .select('id, status, start_date, created_at, total_price, deposit_amount, delivery_fee, payment_plan, checkout_group_id, payfast_payment_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (readError) {
    if (readError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    console.error('[bookings/[id]] PUT read error:', readError.message);
    return NextResponse.json({ error: 'Failed to load booking.' }, { status: 500 });
  }

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) update.notes = notes?.trim() || null;

  let quote: ReturnType<typeof calculateCancellationRefund> | null = null;

  if (status === 'cancelled') {
    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'This booking is already cancelled.' }, { status: 409 });
    }
    if (!isCancellableStatus(booking.status)) {
      return NextResponse.json(
        {
          error:
            'This hire can no longer be cancelled online because the equipment has been released. Please contact support.',
        },
        { status: 409 },
      );
    }

    quote = await quoteCancellation(booking);

    update.status = 'cancelled';
    update.cancelled_at = new Date().toISOString();
    update.cancellation_refund_percent = quote.refundPercent;
    update.cancellation_fee = quote.cancellationFee;
    update.cancellation_refund_amount = quote.totalRefund;

    // Only a paid booking has anything to refund; an unpaid one is just closed.
    const isPaid = Boolean(booking.payfast_payment_id);
    update.cancellation_refund_status =
      isPaid && quote.totalRefund > 0 ? 'pending' : 'not_required';
  }

  const { data, error } = await updateBooking(createAdminClient(), id, user.id, update);

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    console.error('[bookings/[id]] PUT error:', error.message);
    return NextResponse.json({ error: 'Failed to update booking.' }, { status: 500 });
  }

  if (quote) {
    logEvent({
      eventType: 'booking_cancelled',
      eventCategory: 'booking',
      userId: user.id,
      metadata: { kind: 'gear', bookingId: id, refund: quote.totalRefund, refundPercent: quote.refundPercent, coolingOff: quote.coolingOff },
    });
  }

  // Money moves last, so a refund is never issued against a booking we failed
  // to actually cancel.
  if (quote && update.cancellation_refund_status === 'pending') {
    const result = await refundPayment(booking.payfast_payment_id!, quote.totalRefund);

    await updateBooking(createAdminClient(), id, user.id, {
      cancellation_refund_status: result.success ? 'refunded' : 'failed',
      cancellation_refunded_at: result.success ? new Date().toISOString() : null,
      cancellation_refund_error: result.success ? null : (result.error ?? 'Refund failed'),
      updated_at: new Date().toISOString(),
    });

    if (!result.success) {
      // The booking IS cancelled; only the money did not move. Say that plainly
      // rather than implying the whole cancellation failed.
      console.error('[bookings/[id]] cancellation refund failed:', result.error);
      return NextResponse.json({
        ...data,
        cancellation: quote,
        refund_status: 'failed',
        message:
          'Your booking is cancelled, but the refund could not be processed automatically. Our team has been notified and will complete it manually.',
      });
    }

    return NextResponse.json({ ...data, cancellation: quote, refund_status: 'refunded' });
  }

  return NextResponse.json(
    quote
      ? { ...data, cancellation: quote, refund_status: update.cancellation_refund_status }
      : data,
  );
}

/**
 * Applies an update, retrying without the cancellation_* fields if the database
 * does not have them yet. Migrations here are applied by hand
 * (lib/migrations/045-cancellation-refunds.sql), so cancelling must not break
 * in an environment where 038 has not been run.
 */
// Called with the service-role client: the owner check is the user_id filter
// below (and the route reads the booking with the user's session first).
async function updateBooking(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  userId: string,
  update: Record<string, unknown>,
) {
  const attempt = (payload: Record<string, unknown>) =>
    supabase
      .from('equipment_bookings')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

  const result = await attempt(update);

  // 42703 = undefined_column; PostgREST surfaces the same thing as PGRST204.
  if (result.error && (result.error.code === '42703' || result.error.code === 'PGRST204')) {
    console.warn(
      '[bookings/[id]] cancellation columns missing — run lib/migrations/045-cancellation-refunds.sql',
    );
    const fallback = Object.fromEntries(
      Object.entries(update).filter(([k]) => !k.startsWith('cancellation_')),
    );
    return attempt(fallback);
  }

  return result;
}
