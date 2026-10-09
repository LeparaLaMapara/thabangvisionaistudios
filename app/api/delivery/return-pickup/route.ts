export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { buildNotices } from '@/lib/core/rental/notifications';
import { FINAL_DELIVERY_STATES } from '@/lib/core/delivery/state';
import { quoteDelivery, scheduleReturnPickup } from '@/lib/core/delivery/use-cases';
import { quoteIsLive } from '@/lib/core/delivery/quote';
import { deliveryDeps } from '@/lib/delivery/server';
import { isWindowId, legDate, publicQuote, windowFor } from '@/lib/delivery/checkout';
import { returnPickupOption } from '@/lib/delivery/customer-view';

/**
 * Arrange a return pickup during the hire (spec §4.12, §4.17). A separate leg
 * with its own quote (D18). Offered only when the gear went out by delivery
 * (D-44), from the same verified address, on the last hire day.
 *
 *   { booking_id, action: 'quote', window }               → a stored, expiring quote
 *   { booking_id, action: 'approve', quote_id, approved_cents }
 *       the renter approves that exact price (D08). An expired quote is
 *       re-quoted and must be approved again (D07).
 *
 * A return pickup bought at checkout is booked after payment and shown on the
 * booking. One added during the hire has no online payment yet, so an
 * approved request goes to staff, who confirm it and how to pay before the
 * return day; nothing is dispatched unpaid. A free pickup is booked at once.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { suspended } = await checkNotSuspended(user.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  if (!(await checkRateLimit(`delivery-return:${user.id}`, 6, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }

  let body: { booking_id?: unknown; action?: unknown; window?: unknown; quote_id?: unknown; approved_cents?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id : '';
  if (!UUID.test(bookingId)) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const { data: booking } = await supabase.from('equipment_bookings').select('id, checkout_group_id').eq('id', bookingId).eq('user_id', user.id).maybeSingle();
  const groupId = (booking as { checkout_group_id: string | null } | null)?.checkout_group_id ?? null;
  if (!booking || !groupId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  try {
    const deps = await deliveryDeps();
    const [group, shipments] = await Promise.all([deps.bookings.getGroup(groupId), deps.repo.listShipments(groupId)]);
    if (!group || group.renterId !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    const option = returnPickupOption(shipments, group.lines.map((l) => l.status));
    if (!option.allowed) return NextResponse.json({ error: option.message, code: option.reason }, { status: 409 });
    const outbound = shipments.find((s) => s.leg === 'outbound' && !FINAL_DELIVERY_STATES.includes(s.status));
    if (!outbound) return NextResponse.json({ error: 'Gear collected in person is returned in person.', code: 'collected_in_person' }, { status: 409 });
    const lines = group.lines.filter((l) => ['confirmed', 'active', 'overdue'].includes(l.status));
    const caller = { kind: 'renter' as const, userId: user.id };

    const quoteFor = async (window: { start: string | null; end: string | null }) =>
      quoteDelivery(
        // The same verified address the gear went to, back to where it came from.
        { caller, renterId: user.id, bookingGroupId: groupId, leg: 'return', originAddressId: outbound.destinationAddressId, destinationAddressId: outbound.originAddressId, lines, window },
        deps,
      );

    if (body.action === 'quote') {
      const day = legDate(lines, 'return');
      const window = day && isWindowId(body.window) ? windowFor(day, body.window) : null;
      if (!window) return NextResponse.json({ error: 'Choose a pickup window.', code: 'WINDOW_REQUIRED' }, { status: 400 });
      const r = await quoteFor(window);
      if (!r.ok) return NextResponse.json({ ok: false, collection_only: true, code: r.code, message: r.message });
      return NextResponse.json({ ok: true, quote: publicQuote(r.quotes[0]) }, { status: 201 });
    }

    if (body.action === 'approve') {
      const quoteId = typeof body.quote_id === 'string' ? body.quote_id : '';
      const approved = typeof body.approved_cents === 'number' && Number.isSafeInteger(body.approved_cents) ? body.approved_cents : null;
      const q = quoteId ? await deps.repo.getQuote(quoteId) : null;
      if (!q || q.renterId !== user.id || q.leg !== 'return' || q.bookingGroupId !== groupId || q.status !== 'active') {
        return NextResponse.json({ error: 'That pickup quote is not valid. Please get a new quote.', code: 'DELIVERY_QUOTE_INVALID' }, { status: 400 });
      }
      if (!quoteIsLive(q, deps.clock.now())) {
        // D07: a fresh price for the same window, approved again.
        const r = await quoteFor(q.window);
        if (!r.ok) return NextResponse.json({ ok: false, collection_only: true, code: r.code, message: r.message });
        await deps.repo.setQuoteStatus(q.id, ['active'], 'superseded');
        return NextResponse.json({ error: 'Your pickup quote expired. Please confirm the current price.', code: 'DELIVERY_REQUOTE', quote: publicQuote(r.quotes[0]) }, { status: 409 });
      }
      if (approved !== q.customerFeeCents) {
        // D08: the price shown to the renter must be the stored price.
        return NextResponse.json({ error: 'The pickup price changed. Please confirm the current price.', code: 'DELIVERY_PRICE_CHANGED', quote: publicQuote(q) }, { status: 409 });
      }
      if (q.customerFeeCents === 0) {
        const r = await scheduleReturnPickup({ caller, bookingGroupId: groupId, quoteId: q.id }, deps);
        if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: 409 });
        return NextResponse.json({ ok: true, scheduled: true });
      }
      // No online payment for a pickup added during the hire yet: a person
      // confirms it and takes the fee before anything is dispatched.
      await deps.repo.post([], buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: group.lines.map((l) => l.bookingId), discriminator: `delivery:return_pickup_requested:${q.id}`, data: { what: 'delivery_return_pickup_requested', reference: q.id, amountCents: q.customerFeeCents } }));
      logEvent({ eventType: 'delivery_return_pickup_requested', eventCategory: 'booking', userId: user.id, metadata: { bookingGroupId: groupId, quoteId: q.id, feeCents: q.customerFeeCents } });
      return NextResponse.json({ ok: true, requested: true, quote: publicQuote(q) });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[delivery/return-pickup] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not arrange the pickup just now. Please try again, or bring the gear back in person.' }, { status: 503 });
  }
}
