export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { DELIVERY_OPS } from '@/lib/constants';
import { FINAL_DELIVERY_STATES } from '@/lib/core/delivery/state';
import { confirmHandover } from '@/lib/core/delivery/use-cases';
import { deliveryDeps } from '@/lib/delivery/server';
import { dispatchOutbox } from '@/lib/rental/notify';

/**
 * The renter confirms what arrived (spec §4.10–4.11, D15, D-43). Only the
 * booking's own renter, signed in, can accept an item; nobody else (not
 * staff, not an owner, not Ubunye) can do it for them. Per item:
 *
 *   { booking_id, items: [{ booking_id, rental_id, outcome: 'accepted' }] }
 *   { booking_id, items: [{ booking_id, rental_id, outcome: 'exception',
 *                           kind: 'damaged' | 'lost', detail: '…' }] }
 *
 * `booking_id` is the booking page the renter is on; each item names the
 * order's line and listing. Accepting every item earns the outbound fee; an
 * exception opens an incident for a person (no blame, nothing charged).
 * Idempotent: confirming twice records it once. Items confirmed by nobody
 * are deemed accepted after DELIVERY_POLICY.deemedAcceptanceHours (D-48).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 20;

type ItemIn = { booking_id?: unknown; rental_id?: unknown; outcome?: unknown; kind?: unknown; detail?: unknown };

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { suspended } = await checkNotSuspended(user.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  if (!(await checkRateLimit(`delivery-accept:${user.id}`, DELIVERY_OPS.acceptRateLimit.max, DELIVERY_OPS.acceptRateLimit.windowMs))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }

  let body: { booking_id?: unknown; items?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id : '';
  if (!UUID.test(bookingId)) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const raw = Array.isArray(body.items) ? (body.items as ItemIn[]).slice(0, MAX_ITEMS) : [];
  const items: { bookingId: string; rentalId: string; outcome: 'accepted' | 'exception'; kind: 'damaged' | 'lost'; detail: string }[] = [];
  for (const i of raw) {
    if (!i || typeof i !== 'object' || typeof i.booking_id !== 'string' || typeof i.rental_id !== 'string' || !UUID.test(i.booking_id) || !UUID.test(i.rental_id)) {
      return NextResponse.json({ error: 'Choose the item.' }, { status: 400 });
    }
    if (i.outcome !== 'accepted' && i.outcome !== 'exception') return NextResponse.json({ error: 'Say whether the item arrived as expected.' }, { status: 400 });
    const detail = typeof i.detail === 'string' ? i.detail.trim().slice(0, 500) : '';
    if (i.outcome === 'exception' && detail.length < 3) return NextResponse.json({ error: 'Say what is wrong or missing.', code: 'exception_needs_detail' }, { status: 400 });
    items.push({ bookingId: i.booking_id, rentalId: i.rental_id, outcome: i.outcome, kind: i.kind === 'lost' ? 'lost' : 'damaged', detail });
  }
  if (items.length === 0) return NextResponse.json({ error: 'Choose the item.' }, { status: 400 });

  // The renter's own booking only (their session, and an explicit owner check).
  const { data: booking } = await supabase.from('equipment_bookings').select('id, checkout_group_id').eq('id', bookingId).eq('user_id', user.id).maybeSingle();
  const groupId = (booking as { checkout_group_id: string | null } | null)?.checkout_group_id ?? null;
  if (!booking || !groupId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  try {
    const deps = await deliveryDeps();
    const group = await deps.bookings.getGroup(groupId);
    if (!group || group.renterId !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    const outbound = (await deps.repo.listShipments(groupId)).filter((s) => s.leg === 'outbound' && !FINAL_DELIVERY_STATES.includes(s.status));
    const results: { booking_id: string; rental_id: string; ok: boolean; duplicate?: boolean; code?: string; message?: string }[] = [];
    for (const it of items) {
      const shipment = outbound.find((s) => s.items.some((x) => x.bookingId === it.bookingId && x.rentalId === it.rentalId));
      if (!shipment) {
        results.push({ booking_id: it.bookingId, rental_id: it.rentalId, ok: false, code: 'not_found', message: 'That item is not on a delivery to you.' });
        continue;
      }
      // The core checks it is THIS booking's renter (wrong_recipient otherwise) and the item's order.
      const r = await confirmHandover(
        {
          caller: { kind: 'renter', userId: user.id },
          shipmentId: shipment.id,
          bookingId: it.bookingId,
          rentalId: it.rentalId,
          evidence: [],
          discrepancies: it.outcome === 'exception' ? [it.detail] : [],
          outcome: it.outcome,
          exceptionKind: it.kind,
        },
        deps,
      );
      results.push(r.ok ? { booking_id: it.bookingId, rental_id: it.rentalId, ok: true, duplicate: r.duplicate } : { booking_id: it.bookingId, rental_id: it.rentalId, ok: false, code: r.code, message: r.message });
    }
    // Ids and outcomes only: never the renter's text.
    logEvent({
      eventType: 'delivery_renter_confirmation',
      eventCategory: 'booking',
      userId: user.id,
      metadata: { bookingGroupId: groupId, accepted: items.filter((i) => i.outcome === 'accepted').length, exceptions: items.filter((i) => i.outcome === 'exception').length, refused: results.filter((r) => !r.ok).length },
    });
    await dispatchOutbox(10).catch(() => undefined);
    const anyOk = results.some((r) => r.ok);
    return NextResponse.json({ ok: anyOk, results }, { status: anyOk ? 200 : 409 });
  } catch (err) {
    console.error('[delivery/accept] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not record that just now. Please try again.' }, { status: 503 });
  }
}
