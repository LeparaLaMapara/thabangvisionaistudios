export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { DELIVERY_POLICY, STUDIO } from '@/lib/constants';
import { inServiceArea } from '@/lib/core/delivery/policy';
import { addressPort, contactDetails, verifyAddress } from '@/lib/delivery/address';
import { SupabaseOwnerPickup } from '@/lib/delivery/origins';
import { ownerLegs } from '@/lib/delivery/owner-view';
import { SupabaseDeliveryRepository } from '@/lib/delivery/repos';
import type { Shipment } from '@/lib/core/delivery/repository';
import type { CustodyEvent } from '@/lib/core/delivery/custody';

/**
 * Collection from the owner's address (Phase 8). The signed-in owner only,
 * for themselves:
 *
 *   GET     their pickup address (theirs alone), their community listings
 *           with the "available for pickup from my address" switch, and the
 *           delivery legs that carry their gear (their items only: no renter
 *           details, no fee, no tracking link).
 *   PUT     { address: { street, suburb, city, postalCode }, contact_name,
 *           contact_phone, instructions? } save or replace the pickup
 *           address. The SERVER verifies it (AddressPort, never the
 *           browser's coordinates) and it must be inside the service area.
 *   PATCH   { rental_id, enabled } the per-listing opt-in (default off, D-86).
 *   DELETE  remove the pickup address (gear then goes from the studio).
 *
 * Changing or removing the address, or switching a listing off, is refused
 * while a collection from (or return to) the address is under way: staff
 * change it with the owner. Logged with ids and outcomes only, never the
 * address or phone number.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signedIn(): Promise<{ id: string } | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { id: user.id };
}

const LEG_IN_PROGRESS = 'A collection from or return to your address is under way. Contact us to change it.';

export async function GET() {
  const who = await signedIn();
  if (who instanceof NextResponse) return who;
  try {
    const db = createAdminClient();
    const store = new SupabaseOwnerPickup(db);
    const [address, listings] = await Promise.all([store.current(who.id), store.listings(who.id)]);
    // Legs carrying this owner's gear (newest first, bounded).
    const { data, error } = await db.from('delivery_shipments').select('id').contains('owner_ids', [who.id]).order('created_at', { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const repo = new SupabaseDeliveryRepository(db);
    const shipments: Shipment[] = [];
    const custody: CustodyEvent[] = [];
    for (const r of (data ?? []) as { id: string }[]) {
      const s = await repo.getShipment(String(r.id));
      if (!s) continue;
      shipments.push(s);
      custody.push(...(await repo.listCustody(s.id)));
    }
    const titles = new Map(listings.map((l) => [l.rentalId, l.title]));
    return NextResponse.json(
      {
        enabled: DELIVERY_POLICY.ownerPickup.enabled,
        service_area: STUDIO.serviceArea.summary,
        address: address
          ? { formatted_address: address.formattedAddress, suburb: address.suburb, city: address.city, postal_code: address.postalCode, contact_name: address.contactName, contact_phone: address.contactPhone, instructions: address.instructions, verified_at: address.verifiedAt }
          : null,
        listings: listings.map((l) => ({ rental_id: l.rentalId, title: l.title, live: l.live, owner_pickup: l.ownerPickup })),
        legs: ownerLegs(who.id, shipments, custody, titles),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[delivery/owner-pickup] load failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not load your pickup settings just now.' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const who = await signedIn();
  if (who instanceof NextResponse) return who;
  const { suspended } = await checkNotSuspended(who.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  // One address lookup per save (the public geocoder's usage policy).
  if (!(await checkRateLimit(`owner-pickup:${who.id}`, 5, 60_000))) return NextResponse.json({ error: 'Too many changes. Please wait a minute.' }, { status: 429 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const contact = contactDetails(body);
  if (!contact.ok) return NextResponse.json({ error: contact.message, code: 'CONTACT_INVALID' }, { status: 400 });
  const verified = await verifyAddress(body.address as Record<string, unknown> | null, addressPort());
  if (!verified.ok) return NextResponse.json({ error: verified.message, code: verified.code }, { status: verified.code === 'ADDRESS_CHECK_UNAVAILABLE' || verified.code === 'ADDRESS_CHECK_OFF' ? 503 : 422 });
  if (!inServiceArea(verified.address)) {
    return NextResponse.json({ error: `We collect gear in ${STUDIO.serviceArea.summary} only. ${STUDIO.serviceArea.outsideProvinceNote}`, code: 'out_of_area' }, { status: 422 });
  }
  try {
    const r = await new SupabaseOwnerPickup(createAdminClient()).save({ ownerId: who.id, address: verified.address, verifiedBy: verified.verifiedBy, ...contact });
    if (!r.ok) return NextResponse.json({ error: LEG_IN_PROGRESS, code: r.code }, { status: 409 });
    logEvent({ eventType: 'owner_pickup_address_saved', eventCategory: 'booking', userId: who.id, metadata: { addressId: r.address.id, verifiedBy: verified.verifiedBy } });
    const a = r.address;
    return NextResponse.json({ ok: true, address: { formatted_address: a.formattedAddress, suburb: a.suburb, city: a.city, postal_code: a.postalCode, contact_name: a.contactName, contact_phone: a.contactPhone, instructions: a.instructions, verified_at: a.verifiedAt } });
  } catch (err) {
    console.error('[delivery/owner-pickup] save failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not save your pickup address just now. Please try again.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const who = await signedIn();
  if (who instanceof NextResponse) return who;
  const { suspended } = await checkNotSuspended(who.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  if (!(await checkRateLimit(`owner-pickup-listing:${who.id}`, 30, 60_000))) return NextResponse.json({ error: 'Too many changes. Please wait a minute.' }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { rental_id?: unknown; enabled?: unknown } | null;
  if (!body || typeof body.rental_id !== 'string' || !UUID.test(body.rental_id) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Choose the listing and whether it can be collected from you.' }, { status: 400 });
  }
  try {
    const r = await new SupabaseOwnerPickup(createAdminClient()).setListingPickup(who.id, body.rental_id, body.enabled);
    if (!r.ok) return r.code === 'not_found' ? NextResponse.json({ error: 'Listing not found' }, { status: 404 }) : NextResponse.json({ error: LEG_IN_PROGRESS, code: r.code }, { status: 409 });
    logEvent({ eventType: 'owner_pickup_listing', eventCategory: 'booking', userId: who.id, metadata: { rentalId: body.rental_id, enabled: body.enabled } });
    return NextResponse.json({ ok: true, rental_id: body.rental_id, owner_pickup: body.enabled });
  } catch (err) {
    console.error('[delivery/owner-pickup] opt-in failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not save that just now. Please try again.' }, { status: 503 });
  }
}

export async function DELETE() {
  const who = await signedIn();
  if (who instanceof NextResponse) return who;
  try {
    const r = await new SupabaseOwnerPickup(createAdminClient()).remove(who.id);
    if (!r.ok) return NextResponse.json({ error: LEG_IN_PROGRESS, code: r.code }, { status: 409 });
    logEvent({ eventType: 'owner_pickup_address_removed', eventCategory: 'booking', userId: who.id, metadata: {} });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[delivery/owner-pickup] remove failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not remove it just now. Please try again.' }, { status: 503 });
  }
}
