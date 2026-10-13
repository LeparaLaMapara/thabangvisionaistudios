export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkNotSuspended, checkRateLimit } from '@/lib/auth';
import { DELIVERY_CHECKOUT } from '@/lib/constants';
import { getCartItems } from '@/lib/supabase/queries/cart';
import { logEvent } from '@/lib/data/events';
import { evaluateDeliveryEligibility } from '@/lib/core/delivery/policy';
import { publicOriginArea } from '@/lib/core/delivery/origin';
import { deliveryDeps } from '@/lib/delivery/server';
import { addressPort, compareHint, contactDetails, verifyAddress } from '@/lib/delivery/address';
import { SupabaseDeliveryAddressWriter } from '@/lib/delivery/address-store';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import {
  SupabaseQuoteLinks,
  cartLinesForDelivery,
  deliveryLines,
  isWindowId,
  legDate,
  publicQuote,
  quoteCartDelivery,
  windowFor,
  type LegRequest,
} from '@/lib/delivery/checkout';

/**
 * A delivery quote for the signed-in renter's cart (spec §4.7, §4.17).
 *
 * The renter types an address; the SERVER verifies it (AddressPort) and
 * prices the delivery from the verified point. Coordinates from the browser
 * are at most a hint: compared, logged when they disagree, never used. The
 * quote is stored with an expiry (delivery_quotes) and the checkout charges
 * the stored quote, nothing the browser says.
 *
 * Body: { address: { street, suburb, city, postalCode }, contact_name,
 *         contact_phone, instructions?, window, return_window?, hint? }
 */
const MONEY_FIELDS = ['amount', 'fee', 'price', 'delivery_fee', 'customer_fee_cents', 'total', 'distance_km', 'distanceKm'];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { suspended } = await checkNotSuspended(user.id);
  if (suspended) return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
  if (!(await checkRateLimit(`delivery-quote:${user.id}`, 6, 60_000))) {
    return NextResponse.json({ error: 'Too many quotes. Please wait a minute.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (MONEY_FIELDS.some((k) => k in body)) {
    logEvent({ eventType: 'delivery_quote_tamper_rejected', eventCategory: 'security', userId: user.id, metadata: { fields: MONEY_FIELDS.filter((k) => k in body) } });
    return NextResponse.json({ error: 'Prices are calculated by the server.', code: 'CLIENT_PRICE_REJECTED' }, { status: 400 });
  }
  if (!isWindowId(body.window)) return NextResponse.json({ error: 'Choose a delivery window.', code: 'WINDOW_REQUIRED' }, { status: 400 });
  const wantReturn = body.return_window !== undefined && body.return_window !== null && body.return_window !== '';
  if (wantReturn && !isWindowId(body.return_window)) return NextResponse.json({ error: 'Choose a return pickup window.', code: 'WINDOW_REQUIRED' }, { status: 400 });
  const contact = contactDetails(body);
  if (!contact.ok) return NextResponse.json({ error: contact.message, code: 'CONTACT_INVALID' }, { status: 400 });

  const items = await getCartItems(user.id);
  if (items.length === 0) return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  const cart = cartLinesForDelivery(items);
  if (!cart) return NextResponse.json({ error: 'Choose dates for each item first.', code: 'DATES_REQUIRED' }, { status: 400 });
  const lines = deliveryLines(cart);

  // Verify the address on the server. Never the browser's coordinates.
  const verified = await verifyAddress(body.address as Record<string, unknown> | null, addressPort());
  if (!verified.ok) {
    if (verified.code === 'ADDRESS_CHECK_OFF') return NextResponse.json({ ok: false, collection_only: true, code: verified.code, message: verified.message });
    return NextResponse.json({ error: verified.message, code: verified.code }, { status: verified.code === 'ADDRESS_CHECK_UNAVAILABLE' ? 503 : 422 });
  }
  const hint = compareHint(verified.address, body.hint);
  if (hint.provided && !hint.withinTolerance) {
    // A spoofed or stale map position. Logged for review, and ignored.
    logEvent({ eventType: 'delivery_hint_mismatch', eventCategory: 'security', userId: user.id, metadata: { distanceKm: hint.distanceKm } });
  }

  const outDay = legDate(cart, 'outbound');
  const backDay = legDate(cart, 'return');
  const legs: LegRequest[] = [];
  const outWindow = outDay ? windowFor(outDay, body.window) : null;
  if (!outWindow) return NextResponse.json({ error: 'Choose a delivery window.', code: 'WINDOW_REQUIRED' }, { status: 400 });
  legs.push({ leg: 'outbound', window: outWindow });
  if (wantReturn) {
    const backWindow = backDay ? windowFor(backDay, body.return_window) : null;
    if (!backWindow) return NextResponse.json({ error: 'Choose a return pickup window.', code: 'WINDOW_REQUIRED' }, { status: 400 });
    legs.push({ leg: 'return', window: backWindow });
  }

  const address = { summary: [verified.address.suburb, verified.address.city].filter(Boolean).join(', '), formatted: verified.address.formattedAddress };

  try {
    const deps = await deliveryDeps();
    const links = new SupabaseQuoteLinks();

    if (!(await links.available())) {
      // Migration 076 not applied yet: the own-vehicle price from the VERIFIED
      // point, same rules, no stored quote. The checkout verifies the address
      // again and prices it the same way.
      const { facts, holdings } = await deps.trust.getTrustInputs(user.id);
      const elig = evaluateDeliveryEligibility({ facts, currentExposureCents: 0, holdings, lines, destination: { province: verified.address.province ?? null }, courierFlagEnabled: false, ownFleetEnabled: deps.flags.ownFleetEnabled, now: deps.clock.now() });
      if (!elig.ok) return NextResponse.json({ ok: false, collection_only: true, code: elig.code, message: elig.message, address });
      const q = quoteOwnVehicleCents({ destination: verified.address, itemCount: cart.reduce((n, l) => n + l.quantity, 0) });
      if (!('feeCents' in q)) {
        return NextResponse.json({ ok: false, collection_only: true, code: q.reason, message: 'That address is outside the area we deliver to. You can collect in person, or contact us for a quote.', address });
      }
      return NextResponse.json({
        ok: true,
        legacy: true,
        quotes: [{ id: null, leg: 'outbound', provider_kind: 'own_fleet', customer_fee_cents: q.feeCents, expires_at: null, window_start: outWindow.start, window_end: outWindow.end, window_label: null }],
        delivery_total_cents: q.feeCents,
        address,
      });
    }

    const writer = new SupabaseDeliveryAddressWriter(createAdminClient());
    const [renterAddressId, siteAddressId] = await Promise.all([
      writer.saveRenterAddress({ userId: user.id, address: verified.address, verifiedBy: verified.verifiedBy, contactName: contact.contactName, contactPhone: contact.contactPhone, instructions: contact.instructions }),
      writer.platformSiteId(),
    ]);
    const r = await quoteCartDelivery({ caller: { kind: 'renter', userId: user.id }, renterId: user.id, renterAddressId, siteAddressId, lines, legs }, deps);
    if (!r.ok) return NextResponse.json({ ok: false, collection_only: true, code: r.code, message: r.message, address });
    // Phase 8: gear collected from an owner shows where from at suburb level only (never the street, D-88).
    const quotes = await Promise.all(
      r.quotes.map(async (q) => ({
        ...publicQuote(q),
        origin_area: q.originOwnerId ? publicOriginArea(await deps.addresses.getPoint(q.leg === 'outbound' ? q.originAddressId : q.destinationAddressId)) : null,
      })),
    );
    return NextResponse.json(
      { ok: true, quotes, delivery_total_cents: quotes.reduce((s, q) => s + q.customer_fee_cents, 0), address, attribution: DELIVERY_CHECKOUT.address.attribution },
      { status: 201 },
    );
  } catch (err) {
    console.error('[delivery/quote] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'We could not quote delivery just now. Please try again, or collect in person.' }, { status: 503 });
  }
}
