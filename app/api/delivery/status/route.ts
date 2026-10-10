export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { getDeliveryStatus } from '@/lib/core/delivery/use-cases';
import { deliveryDeps } from '@/lib/delivery/server';
import { customerLegs, returnPickupOption } from '@/lib/delivery/customer-view';
import { SupabaseQuoteLinks } from '@/lib/delivery/checkout';
import { publicOriginArea } from '@/lib/core/delivery/origin';

/**
 * Delivery status for one of the signed-in renter's bookings (spec §4.17):
 * each leg's verified state, the window, and a tracking link only when the
 * provider gave one. No addresses. Read-only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await checkRateLimit(`delivery-status:${user.id}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }
  const bookingId = request.nextUrl.searchParams.get('booking_id') ?? '';
  if (!UUID.test(bookingId)) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // The renter's own booking only (RLS and an explicit owner check).
  const { data: booking } = await supabase.from('equipment_bookings').select('id, user_id, checkout_group_id, fulfilment_method').eq('id', bookingId).eq('user_id', user.id).maybeSingle();
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const groupId = (booking as { checkout_group_id: string | null }).checkout_group_id;
  if (!groupId) return NextResponse.json({ legs: [], open_incidents: 0, return_pickup: null });

  try {
    const deps = await deliveryDeps();
    const status = await getDeliveryStatus({ caller: { kind: 'renter', userId: user.id }, bookingGroupId: groupId }, deps);
    if (!status.ok) return NextResponse.json({ error: 'Booking not found' }, { status: status.code === 'not_allowed' ? 403 : 404 });
    const [shipments, group] = await Promise.all([deps.repo.listShipments(groupId), deps.bookings.getGroup(groupId)]);
    const pending = group ? await new SupabaseQuoteLinks().pendingReturnRequest(user.id, group.lines.map((l) => l.bookingId)) : null;
    const option = returnPickupOption(shipments, (group?.lines ?? []).map((l) => l.status), pending);
    // Item names for the confirm buttons (the renter's own booking lines, read with their session).
    const rentalIds = [...new Set(status.legs.flatMap((l) => l.items.map((i) => i.rentalId)))];
    const { data: rentals } = rentalIds.length ? await supabase.from('smart_rentals').select('id, title').in('id', rentalIds) : { data: [] };
    const titles = new Map(((rentals ?? []) as { id: string; title: string | null }[]).map((r) => [r.id, r.title ?? '']));
    // Phase 8: a leg from (or back to) an owner's address names the owner's suburb, never the street (D-88).
    const areas = new Map<string, string | null>();
    for (const s of shipments) {
      if (!s.originOwnerId) continue;
      areas.set(s.id, publicOriginArea(await deps.addresses.getPoint(s.leg === 'outbound' ? s.originAddressId : s.destinationAddressId)));
    }
    return NextResponse.json({
      legs: customerLegs(status.legs, shipments, titles, areas),
      open_incidents: status.openIncidents,
      return_pickup: status.legs.length === 0 ? null : option,
      return_pickup_requested: pending ? { fee_cents: pending.customerFeeCents } : null,
    });
  } catch (err) {
    console.error('[delivery/status] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Delivery details are not available just now.' }, { status: 503 });
  }
}
