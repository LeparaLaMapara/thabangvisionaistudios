export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { DELIVERY_OPS } from '@/lib/constants';
import { confirmCollection, confirmOwnerReturn } from '@/lib/core/delivery/use-cases';
import { deliveryDeps } from '@/lib/delivery/server';
import { photoEvidence } from '@/lib/delivery/ops';
import { dispatchOutbox } from '@/lib/rental/notify';

/**
 * The owner's side of a handover at THEIR door (Phase 8, D-87). Signed-in
 * owner only, for their own items on a leg from or to their own pickup
 * address; the delivery core enforces all of it (the item's owner, the leg's
 * origin, the custody order), this route only reads the request.
 *
 *   { shipment_id, booking_id, rental_id, action: 'handed_over', photos: [url] }
 *       outbound: the owner handed the item to our driver (photo required).
 *       Our driver records the collection on their side (staff console).
 *   { shipment_id, booking_id, rental_id, action: 'received', photos, condition }
 *       return: it is back with the owner, in this condition (receipt and
 *       inspection, which releases the hold on their payout for that line).
 *   { shipment_id, booking_id, rental_id, action: 'problem', photos, problem_kind: 'damaged' | 'lost', description }
 *       return: something is wrong or missing: an incident for our team
 *       (nobody is accused) that holds the payout for that line.
 *
 * Photos must be links to our own storage (uploaded through the app).
 * Logged with ids and outcomes only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { suspended } = await checkNotSuspended(user.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  if (!(await checkRateLimit(`owner-handover:${user.id}`, DELIVERY_OPS.acceptRateLimit.max, DELIVERY_OPS.acceptRateLimit.windowMs))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !UUID.test(String(b.shipment_id ?? '')) || !UUID.test(String(b.booking_id ?? '')) || !UUID.test(String(b.rental_id ?? ''))) {
    return NextResponse.json({ error: 'Choose the item.' }, { status: 400 });
  }
  const action = b.action;
  if (action !== 'handed_over' && action !== 'received' && action !== 'problem') return NextResponse.json({ error: 'Say what happened.' }, { status: 400 });
  const photos = photoEvidence(b.photos);
  if (!photos.ok) return NextResponse.json({ error: photos.message, code: 'evidence_required' }, { status: 400 });

  const caller = { kind: 'owner' as const, userId: user.id };
  const base = { caller, shipmentId: String(b.shipment_id), bookingId: String(b.booking_id), rentalId: String(b.rental_id), evidence: photos.evidence };
  try {
    const deps = await deliveryDeps();
    // The leg must carry this owner's own item (the core checks it again, per item).
    const s = await deps.repo.getShipment(base.shipmentId);
    if (!s || !s.items.some((i) => i.ownerId === user.id && i.bookingId === base.bookingId && i.rentalId === base.rentalId)) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }
    const r =
      action === 'handed_over'
        ? s.leg === 'outbound' && s.originOwnerId === user.id
          ? await confirmCollection(base, deps)
          : ({ ok: false, code: 'not_allowed', message: 'This item is not collected from your address.' } as const)
        : await confirmOwnerReturn(
            {
              ...base,
              outcome: action === 'problem' ? 'problem' : 'received',
              condition: text(b.condition, 500) || null,
              problem: action === 'problem' ? { kind: b.problem_kind === 'lost' ? 'lost' : 'damaged', description: text(b.description, 500) } : null,
            },
            deps,
          );
    logEvent({
      eventType: 'delivery_owner_handover',
      eventCategory: 'booking',
      userId: user.id,
      metadata: { shipmentId: base.shipmentId, bookingId: base.bookingId, action, outcome: r.ok ? (r.duplicate ? 'duplicate' : 'recorded') : r.code },
    });
    if (!r.ok) {
      const status = r.code === 'not_found' ? 404 : r.code === 'not_allowed' || r.code === 'not_owner' || r.code === 'actor_not_allowed' ? 403 : r.code === 'evidence_required' || r.code === 'exception_needs_detail' ? 400 : 409;
      return NextResponse.json({ error: r.message, code: r.code }, { status });
    }
    await dispatchOutbox(10).catch(() => undefined);
    return NextResponse.json({ ok: true, duplicate: r.duplicate, incident: r.incidentId ? true : false });
  } catch (err) {
    console.error('[delivery/owner-handover] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not record that just now. Please try again.' }, { status: 503 });
  }
}
