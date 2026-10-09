export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { refundPayment } from '@/lib/payments/routing';
import {
  bulkDiscountPercentFor,
  calculateCancellationRefund,
  isCancellableStatus,
  paidOnlineForLine,
} from '@/lib/rental/cancellation';
import { logEvent } from '@/lib/data/events';
import { isManualReference } from '@/lib/payments/routing';
import { fromCents, toCents } from '@/lib/core/pricing/money';
import { refundObligationKey } from '@/lib/core/rental/refunds';
import { cancellation as cancellationJournal } from '@/lib/core/rental/ledger';
import { buildNotices } from '@/lib/core/rental/notifications';
import { submitRefund } from '@/lib/core/rental/use-cases';
import { systemClock } from '@/lib/core/ports';
import { paymentPort } from '@/lib/payments/ports';
import { SupabaseRefunds, isMissingPipeline, transitionBookings } from '@/lib/rental/repos';
import { dispatchOutbox } from '@/lib/rental/notify';
import { chargeOfBooking } from '@/lib/rental/charges';
import { paymentReference } from '@/lib/payments/eft';
import { deliveryCancellationPlan, settleAfterLineCancelled, type DeliveryCancellationPlan } from '@/lib/rental/delivery-settlement';

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
  /** Phase 4 delivery: the fee is refunded per leg by cancelDelivery (D-39), never with the hire. */
  phase4Delivery = false,
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
    if (!othersActive && !phase4Delivery) {
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

  // A cart line priced at checkout (070) carries its exact share of the charge,
  // with the discount's cent remainder already allocated across the order.
  // Re-deriving it per line could add up to more than was charged.
  const snap = booking.checkout_group_id && booking.payment_plan !== 'deposit_only' ? await lineSnapshot(booking.id) : null;
  if (snap) {
    paid.hire = fromCents(snap.hireCents);
    paid.deposit = fromCents(snap.depositCents);
  }

  return calculateCancellationRefund({
    startDate: booking.start_date,
    totalPrice: paid.hire,
    depositAmount: paid.deposit,
    deliveryFee: paid.delivery,
    bookedAt: booking.created_at,
  });
}

/** The line's hire and deposit as snapshotted at checkout, or null before 070. */
async function lineSnapshot(id: string): Promise<{ hireCents: number; depositCents: number } | null> {
  const { data, error } = await createAdminClient().from('equipment_bookings').select('hire_cents, deposit_cents').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as { hire_cents: number | null; deposit_cents: number | null };
  if (row.hire_cents == null || row.deposit_cents == null) return null;
  return { hireCents: row.hire_cents, depositCents: row.deposit_cents };
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
  let deliveryPlan: DeliveryCancellationPlan | null = null;
  if (isCancellableStatus(data.status)) {
    try {
      deliveryPlan = await deliveryCancellationPlan(createAdminClient(), { bookingGroupId: data.checkout_group_id ?? null, bookingId: data.id });
    } catch {
      deliveryPlan = null;
    }
  }
  const cancellation = isCancellableStatus(data.status)
    ? await quoteCancellation(data as BookingForQuote, deliveryPlan?.phase4 ?? false)
    : null;
  // Phase 4 delivery on this order: what cancelling returns of the delivery fee (D-39).
  const deliveryCancellation =
    deliveryPlan?.phase4 && deliveryPlan.lastLine
      ? { refund_cents: deliveryPlan.feeCents, courier_booked: deliveryPlan.courierBooked, too_late: deliveryPlan.tooLate }
      : null;

  // The page names the booking by what was rented, not "Equipment".
  const { data: rental } = await supabase
    .from('smart_rentals')
    .select('title')
    .eq('id', data.rental_id)
    .maybeSingle();

  // How to pay, while the order waits for an EFT or cash at collection. The
  // amount lives on the order's first line; any line of the order finds it.
  let paymentInfo: { method: string; reference: string; amountDue: number } | null = null;
  if (data.status === 'pending' && (data.payment_method === 'eft' || data.payment_method === 'cash')) {
    const orderId: string = data.checkout_group_id ?? data.id;
    let amountDue = data.amount_due as number | null;
    if (amountDue == null && data.checkout_group_id) {
      const { data: first } = await createAdminClient()
        .from('equipment_bookings')
        .select('amount_due')
        .eq('checkout_group_id', data.checkout_group_id)
        .not('amount_due', 'is', null)
        .maybeSingle();
      amountDue = (first?.amount_due as number | null) ?? null;
    }
    paymentInfo = { method: data.payment_method, reference: paymentReference(orderId), amountDue: Number(amountDue ?? 0) };
  }

  return NextResponse.json({ ...data, rental_title: rental?.title ?? null, cancellation, delivery_cancellation: deliveryCancellation, payment_info: paymentInfo });
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
  let deliveryPlan: DeliveryCancellationPlan | null = null;

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

    // Phase 4 delivery (D-39): read before anything changes, fail closed.
    try {
      deliveryPlan = await deliveryCancellationPlan(createAdminClient(), { bookingGroupId: booking.checkout_group_id, bookingId: booking.id });
    } catch {
      return NextResponse.json({ error: 'Could not cancel just now. Nothing was changed; please try again.' }, { status: 503 });
    }
    if (deliveryPlan.tooLate) {
      return NextResponse.json({ error: 'Your gear is already on its way, so this booking cannot be cancelled online. Please contact us.', code: 'DELIVERY_UNDER_WAY' }, { status: 409 });
    }
    quote = await quoteCancellation(booking, deliveryPlan.phase4);

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

  if (quote && status === 'cancelled') {
    const viaPipeline = await cancelThroughPipeline(booking, user.id, quote, update, deliveryPlan);
    if (viaPipeline) return viaPipeline;
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
 * Cancellation through the Phase 1 pipeline (070): a guarded transition that
 * records the cancellation, books the ledger and creates ONE refund
 * obligation, all in one transaction. The refund is then submitted. If the
 * provider is slow or down, the daily pipeline reconciles it and never sends
 * it twice (T13). Returns null while 070 is not applied, so the caller falls
 * back to the earlier path.
 */
async function cancelThroughPipeline(
  booking: { id: string; status: string; checkout_group_id: string | null; payfast_payment_id: string | null; deposit_amount?: number | null },
  userId: string,
  quote: ReturnType<typeof calculateCancellationRefund>,
  update: Record<string, unknown>,
  deliveryPlan: DeliveryCancellationPlan | null = null,
): Promise<NextResponse | null> {
  const db = createAdminClient();
  const reference = booking.payfast_payment_id;
  const onProvider = Boolean(reference) && !isManualReference(reference as string);
  // Cents from the quote, which is priced from the line's checkout snapshot.
  const depositRefundCents = toCents(quote.depositRefund);
  const deliveryRefundCents = toCents(quote.deliveryRefund);
  const hireHeldCents = toCents(quote.hireRefund + quote.cancellationFee);
  const hireRefundCents = Math.min(toCents(quote.hireRefund), hireHeldCents);
  const refundCents = hireRefundCents + deliveryRefundCents + depositRefundCents;

  let intentPaid = false;
  let chargedCents = refundCents;
  if (booking.checkout_group_id) {
    const { data: intent, error } = await db.from('rental_payment_intents').select('state, expected_amount_cents').eq('checkout_group_id', booking.checkout_group_id).maybeSingle();
    if (error && isMissingPipeline(error)) return null;
    // Any other error is not "unpaid": cancelling now could refund without the
    // ledger entry behind it. Nothing has changed yet, so ask them to retry.
    if (error) {
      return NextResponse.json({ error: 'Could not cancel just now. Nothing was changed; please try again.' }, { status: 503 });
    }
    if (intent && (intent as { state: string }).state === 'paid') {
      intentPaid = true;
      chargedCents = (intent as { expected_amount_cents: number }).expected_amount_cents;
    }
  }
  // Outside the ledger (paid before 070): cap the refund at the real charge
  // for the order (its recorded payments), never at the refund itself.
  if (onProvider && refundCents > 0 && !intentPaid) {
    let charge: { totalCents: number; remainderCents: number };
    try {
      charge = await chargeOfBooking(db, booking);
    } catch {
      return NextResponse.json({ error: 'Could not cancel just now. Nothing was changed; please try again.' }, { status: 503 });
    }
    if (refundCents > charge.remainderCents) {
      return NextResponse.json({ error: 'This booking cannot be cancelled online. Please contact support so we can refund you correctly.' }, { status: 409 });
    }
    chargedCents = charge.totalCents;
  }

  const refunds = onProvider && refundCents > 0
    ? [{
        obligationKey: refundObligationKey('cancellation', booking.id),
        reason: 'cancellation',
        amountCents: refundCents,
        chargedCents: Math.max(chargedCents, refundCents),
        transactionReference: reference,
        // No journal on completion for an order the ledger never held.
        ledgered: intentPaid,
        userId,
        bookingGroupId: booking.checkout_group_id,
        bookingIds: [booking.id],
      }]
    : [];
  const journals = intentPaid && booking.checkout_group_id && hireHeldCents + deliveryRefundCents + depositRefundCents > 0
    ? [cancellationJournal({
        bookingId: booking.id,
        bookingGroupId: booking.checkout_group_id,
        hireCents: hireHeldCents + deliveryRefundCents,
        hireRefundCents: hireRefundCents + deliveryRefundCents,
        depositCents: depositRefundCents,
      })]
    : [];
  // A paid booking settled by hand (EFT/cash) is refunded by a person.
  const manual = Boolean(reference) && !onProvider && refundCents > 0;
  const notices = manual
    ? buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [booking.id], discriminator: `manual-refund:${booking.id}`, data: { what: 'manual_cancellation_refund', reference: booking.id } })
    : [];

  const patch: Record<string, unknown> = { ...update, cancel_reason: 'customer' };
  delete patch.status;
  delete patch.updated_at;
  delete patch.cancelled_at;
  delete patch.notes;

  const moved = await transitionBookings(db, {
    ids: [booking.id],
    from: ['pending', 'confirmed'],
    to: 'cancelled',
    actor: 'customer',
    actorId: userId,
    reason: 'cancelled by the customer',
    patch,
    journals,
    refunds,
    notices,
  });
  if (moved.result === 'missing_pipeline') return null;
  if (moved.result === 'conflict') {
    return NextResponse.json({ error: 'This booking changed and can no longer be cancelled online. Please contact support.' }, { status: 409 });
  }
  if (moved.result === 'already') {
    return NextResponse.json({ error: 'This booking is already cancelled.' }, { status: 409 });
  }

  logEvent({ eventType: 'booking_cancelled', eventCategory: 'booking', userId, metadata: { kind: 'gear', bookingId: booking.id, refundCents, refundPercent: quote.refundPercent, coolingOff: quote.coolingOff } });

  let refundStatus: string = refunds.length ? 'pending' : manual ? 'pending' : 'not_required';
  if (refunds.length) {
    const { data: ob } = await db.from('refund_obligations').select('id').eq('obligation_key', refundObligationKey('cancellation', booking.id)).maybeSingle();
    if (ob) {
      const outcome = await submitRefund((ob as { id: string }).id, { refunds: new SupabaseRefunds(db), payments: paymentPort, clock: systemClock }).catch(() => 'unknown_outcome');
      refundStatus = outcome === 'submitted' ? 'initiated' : outcome === 'escalated' ? 'failed' : 'pending';
    }
  }
  // Phase 4 delivery: the last line went, so its delivery legs go too. The fee
  // is refunded in full unless a courier was already booked, when the
  // courier's cancellation fee is passed on at cost, capped at the fee (D-39).
  // A paid quote no leg was made from is refunded too. Sent now like the hire
  // refund; the daily pipeline retries it if the provider is slow (never twice).
  // The booking is already cancelled; a leg that cannot be cancelled goes to
  // the ops queue, never back to the customer as an error. The order is read
  // again now that this line is cancelled: a concurrent cancellation of its
  // other line may have made this the last one (review fix round 2, finding 6).
  let legRefundCents = 0;
  if (deliveryPlan) {
    legRefundCents = await settleAfterLineCancelled(
      db,
      { before: deliveryPlan, bookingGroupId: booking.checkout_group_id, bookingId: booking.id, caller: { kind: 'renter', userId }, reason: 'booking cancelled by the customer' },
      deliveryCancellationPlan,
    );
    if (legRefundCents > 0 && refundStatus === 'not_required') refundStatus = 'pending';
  }
  await dispatchOutbox(10).catch(() => undefined);

  const { data } = await db.from('equipment_bookings').select('*').eq('id', booking.id).maybeSingle();
  return NextResponse.json({
    ...(data ?? {}),
    cancellation: quote,
    delivery_refund_cents: legRefundCents,
    refund_status: refundStatus,
    message:
      refundStatus === 'initiated'
        ? 'Your booking is cancelled and the refund has been sent to the payment provider. Banks usually take a few working days.'
        : refundStatus === 'failed'
          ? 'Your booking is cancelled, but the refund could not be sent automatically. Our team has been notified and will complete it.'
          : refundStatus === 'pending'
            ? 'Your booking is cancelled. Your refund is being processed.'
            : 'Your booking is cancelled.',
  });
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
