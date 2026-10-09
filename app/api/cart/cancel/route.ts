export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { addToCart, getCartItems } from '@/lib/supabase/queries/cart';
import { isMissingPipeline } from '@/lib/rental/repos';
import { logEvent } from '@/lib/data/events';
import { paymentAdapterFor } from '@/lib/payments/ports';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINE_COLUMNS = 'id, rental_id, quantity, start_date, end_date, status, payfast_payment_id';

interface OrderLine {
  id: string;
  rental_id: string;
  quantity: number | null;
  start_date: string;
  end_date: string;
  status: string;
  payfast_payment_id: string | null;
  /** Absent before migration 070. */
  hold_expires_at?: string | null;
}

type ChargeCheck = 'unpaid' | 'paid' | 'in_progress' | 'unknown';

/** Provider statuses that mean no money moved and none is on its way. */
const UNPAID_STATUSES = new Set(['abandoned', 'failed', 'reversed']);
/** Provider statuses that mean the money arrived. */
const PAID_STATUSES = new Set(['success']);
/** Intent states that mean the money arrived (or arrived and is being returned). */
const MONEY_RECEIVED_STATES = new Set(['paid', 'mismatch', 'refund_due', 'refunded']);

/**
 * Ask the payment provider, through the payments abstraction, whether this
 * order's charge went through. The browser landing on the cancel page proves
 * nothing: a customer can pay and still come back this way, and a webhook can
 * be slow. Anything other than a definite "not charged" keeps the hold.
 */
async function checkCharge(intent: { reference: string; provider: string }): Promise<ChargeCheck> {
  const selection = paymentAdapterFor(['chargeVerification']);
  // Only the provider that took the payment can say whether it did.
  if (!selection.ok || selection.adapter.provider !== intent.provider) return 'unknown';
  try {
    const v = await selection.adapter.verifyCharge(intent.reference);
    if (!v.ok) {
      // "No such transaction" is a definite answer: the payment page was never
      // used. Any other refusal (bad key, rate limit) says nothing about the money.
      return v.kind === 'rejected' && /not\s*found/i.test(v.message) ? 'unpaid' : 'unknown';
    }
    const status = (v.value.status ?? '').toLowerCase();
    if (PAID_STATUSES.has(status)) return 'paid';
    if (UNPAID_STATUSES.has(status)) return 'unpaid';
    // ongoing, pending, processing, queued, or anything new: not settled yet.
    return 'in_progress';
  } catch {
    return 'unknown';
  }
}

const paymentReceived = (bookingId: string) =>
  NextResponse.json(
    {
      released: false,
      code: 'PAYMENT_RECEIVED',
      booking_id: bookingId,
      error: 'Your payment for this order went through, so your dates stay booked. It shows as confirmed shortly.',
    },
    { status: 409 },
  );

const paymentInProgress = (bookingId: string) =>
  NextResponse.json(
    {
      released: false,
      code: 'PAYMENT_IN_PROGRESS',
      booking_id: bookingId,
      error: 'Your payment for this order is still being processed, so your dates stay held. Check your booking again in a few minutes.',
    },
    { status: 409 },
  );

const cannotCheck = (bookingId: string) =>
  NextResponse.json(
    {
      released: false,
      code: 'PAYMENT_CHECK_UNAVAILABLE',
      booking_id: bookingId,
      error: "We can't check your payment right now, so your dates stay held. Please try again shortly.",
    },
    { status: 503 },
  );

/**
 * POST /api/cart/cancel — the customer came back from the payment page
 * without paying ({ checkout_group_id }).
 *
 * The checkout empties the cart and holds the dates while the customer pays.
 * Here the unpaid hold is ended now instead of when it runs out, and the
 * items go back into the cart with their dates, so trying again does not
 * reserve the same gear twice or count it twice against the renter's limit.
 *
 * Before anything is released the payment provider is asked whether the
 * order was paid: the database alone can lag behind a slow webhook. Paid or
 * still processing: 409 and the hold stays; the webhook, or the missed-payment
 * recovery (recoverMissedPayments in lib/rental/workers.ts), confirms it.
 * Provider unreachable: 503 and the hold stays (fail closed).
 *
 * Ending the hold uses the Phase 1 rule for lapsed holds (hold_expires_at in
 * the past, on the lines and on the payment intent): the gear is free for
 * others at once, and a payment that still arrives for this order is treated
 * as a late payment, confirmed only if the gear is still free and the renter
 * still within their limit, otherwise refunded. Nothing is deleted.
 *
 * Idempotent: only lines whose hold is still running are released, and only
 * the lines this call released go back in the cart. A second call (Back
 * button, retry) changes nothing and says so.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await checkRateLimit(`cart-cancel:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { checkout_group_id?: unknown };
  const groupId = typeof body.checkout_group_id === 'string' ? body.checkout_group_id : '';
  if (!UUID.test(groupId)) return NextResponse.json({ error: 'Unknown order.' }, { status: 400 });

  const admin = createAdminClient();
  const loadLines = async (): Promise<OrderLine[] | null> => {
    const read = (columns: string) =>
      admin
        .from('equipment_bookings')
        .select(columns)
        .eq('checkout_group_id', groupId)
        .eq('user_id', user.id);
    let { data, error } = await read(`${LINE_COLUMNS}, hold_expires_at`);
    // Before migration 070 there is no hold_expires_at column.
    if (error && isMissingPipeline(error)) ({ data, error } = await read(LINE_COLUMNS));
    return error ? null : ((data ?? []) as unknown as OrderLine[]);
  };

  const lines = await loadLines();
  if (lines === null) return NextResponse.json({ error: 'Could not load your order just now. Please try again.' }, { status: 503 });
  if (lines.length === 0) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const paid = (rows: OrderLine[]): boolean =>
    rows.some((l) => l.payfast_payment_id || !['pending', 'cancelled'].includes(l.status));
  if (paid(lines)) {
    return NextResponse.json(
      { released: false, code: 'ALREADY_PAID', booking_id: lines[0].id, error: 'This order is already paid or confirmed.' },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const holding = (l: OrderLine): boolean =>
    l.status === 'pending' &&
    !l.payfast_payment_id &&
    // undefined: the column does not exist yet (before 070); the update below says so.
    (l.hold_expires_at === undefined || (!!l.hold_expires_at && Date.parse(l.hold_expires_at) > now));
  if (!lines.some(holding)) {
    // Already released (an earlier call, or the hold ran out): nothing to do,
    // and nothing goes back in the cart a second time.
    return NextResponse.json({
      released: false,
      code: 'ALREADY_RELEASED',
      restored: 0,
      booking_id: lines[0].id,
      message: 'These dates were already released. Anything we put back is in your cart.',
    });
  }

  // Ask the provider before letting go of anything (see above).
  const intentRes = await admin
    .from('rental_payment_intents')
    .select('reference, provider, state')
    .eq('checkout_group_id', groupId)
    .maybeSingle();
  if (intentRes.error && !isMissingPipeline(intentRes.error)) {
    console.error('[cart/cancel] could not load the payment intent:', intentRes.error.message);
    return NextResponse.json({ error: 'Could not load your order just now. Please try again.' }, { status: 503 });
  }
  const intent = intentRes.error ? null : (intentRes.data as { reference: string; provider: string; state: string } | null);
  if (intent) {
    if (MONEY_RECEIVED_STATES.has(intent.state)) return paymentReceived(lines[0].id);
    const charge = await checkCharge(intent);
    if (charge === 'paid') {
      logEvent({ eventType: 'checkout_cancel_refused', eventCategory: 'booking', userId: user.id, metadata: { checkoutGroupId: groupId, reason: 'paid' } });
      return paymentReceived(lines[0].id);
    }
    if (charge === 'in_progress') return paymentInProgress(lines[0].id);
    if (charge === 'unknown') return cannotCheck(lines[0].id);
  }
  // No intent: nothing was sent to a payment provider for this order (payments
  // offline), or migration 070 is not applied (the hold cannot be ended below).

  // The payment intent first: from here a payment for this order is "late".
  const intentEnd = await admin
    .from('rental_payment_intents')
    .update({ hold_expires_at: nowIso, updated_at: nowIso })
    .eq('checkout_group_id', groupId)
    .in('state', ['initiated', 'failed']);
  if (intentEnd.error && !isMissingPipeline(intentEnd.error)) {
    console.error('[cart/cancel] could not end the payment hold:', intentEnd.error.message);
    return NextResponse.json({ error: 'Could not release your dates just now. Please try again.' }, { status: 503 });
  }
  // Only lines still holding: a second call matches nothing. The rows returned
  // are exactly the ones this call released.
  const linesRes = await admin
    .from('equipment_bookings')
    .update({ hold_expires_at: nowIso, updated_at: nowIso })
    .eq('checkout_group_id', groupId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .is('payfast_payment_id', null)
    .gt('hold_expires_at', nowIso)
    .select('id');
  if (intentEnd.error || linesRes.error) {
    if (isMissingPipeline(linesRes.error) || isMissingPipeline(intentEnd.error)) {
      // Before migration 070 a hold cannot be ended early. The booking stays
      // pending (and can be cancelled from its page); the cart is not refilled,
      // so the same gear is not reserved twice.
      return NextResponse.json({ released: false, code: 'HOLD_KEPT', booking_id: lines[0].id });
    }
    console.error('[cart/cancel] could not end the hold:', linesRes.error?.message);
    return NextResponse.json({ error: 'Could not release your dates just now. Please try again.' }, { status: 503 });
  }
  const releasedIds = new Set(((linesRes.data ?? []) as { id: string }[]).map((r) => r.id));
  if (releasedIds.size === 0) {
    // Another call released them a moment ago: it refilled the cart.
    return NextResponse.json({
      released: false,
      code: 'ALREADY_RELEASED',
      restored: 0,
      booking_id: lines[0].id,
      message: 'These dates were already released. Anything we put back is in your cart.',
    });
  }

  // A payment confirmed in the meantime wins: nothing goes back in the cart.
  const after = await loadLines();
  if (after === null) return NextResponse.json({ error: 'Could not load your order just now. Please try again.' }, { status: 503 });
  if (paid(after)) {
    return NextResponse.json(
      { released: false, code: 'ALREADY_PAID', booking_id: lines[0].id, error: 'This order is already paid or confirmed.' },
      { status: 409 },
    );
  }

  // Back in the cart: only what this call released, never a cancelled line.
  const toRestore = after.filter((l) => releasedIds.has(l.id) && l.status === 'pending');
  // The cart holds one line per item: a newer choice for the same gear (added
  // in another tab since this checkout) is kept, not overwritten by the old order.
  const inCart = new Set((await getCartItems(user.id)).map((c) => c.rental_id));
  let restored = 0;
  let kept = 0;
  for (const line of toRestore) {
    if (inCart.has(line.rental_id)) {
      kept += 1;
      continue;
    }
    const item = await addToCart(user.id, line.rental_id, Math.max(1, line.quantity ?? 1), line.start_date, line.end_date);
    if (item) restored += 1;
  }

  logEvent({ eventType: 'checkout_payment_cancelled', eventCategory: 'booking', userId: user.id, metadata: { checkoutGroupId: groupId, items: toRestore.length, restored } });
  return NextResponse.json({ released: true, restored, kept, items: toRestore.length });
}
