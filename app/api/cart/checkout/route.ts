export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { getCartItems, clearCart } from '@/lib/supabase/queries/cart';
import { calculateCartPricing, calculateCartPricingPerItem, splitAcrossLines } from '@/lib/cart/pricing';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { addressPort, compareHint, verifyAddress, type AddressInput } from '@/lib/delivery/address';
import { SupabaseQuoteLinks, cartLinesForDelivery, deliveryLines, priceCheckoutDelivery, publicQuote } from '@/lib/delivery/checkout';
import { deliveryDeps } from '@/lib/delivery/server';
import { inServiceArea } from '@/lib/core/delivery/policy';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import { checkAvailability, availabilityMessage } from '@/lib/rental/availability';
import { recordUnmetDemandAsync } from '@/lib/demand/record';
import { meetsLeadTime, leadTimeMessage } from '@/lib/rental/leadTime';
import { logEvent } from '@/lib/data/events';
import { reportUnpaidRequest, PAYMENTS_OFF_MESSAGE } from '@/lib/payments/offline';
import { itemValue } from '@/lib/rental/protection';
import { checkRenterEligibility } from '@/lib/rental/eligibility-server';
import { blockedUnits, effectiveHoldMinutes, loadHolds } from '@/lib/rental/availability-server';
import { checkoutGroupIdFor, releaseUnpaidReservation, reserveOrder, snapshotLines } from '@/lib/rental/reserve';
import { toCents } from '@/lib/core/pricing/money';
import { paymentReference } from '@/lib/payments/eft';
import { loadNoticeBookings, sendGearNotice } from '@/lib/rental/notices';
import { recordConsent, requiredConsents } from '@/lib/consent';
import { clientIp } from '@/lib/http/clientIp';
import { trackFunnel } from '@/lib/analytics/funnel';

function daysBetween(start: string, end: string): number {
  return Math.ceil(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function validateDateRange(
  startStr: string,
  endStr: string,
  label: string,
): string | null {
  const start = new Date(startStr);
  const end = new Date(endStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return `Invalid date format${label}.`;
  }
  if (end <= start) {
    return `end_date must be after start_date${label}.`;
  }
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (start < midnight) {
    return `Cannot book for past dates${label}.`;
  }

  // Equipment needs notice so it can be checked, charged and put aside. Enforced
  // here as well as in the picker: a browser-side minimum is a courtesy, not a
  // rule, and this endpoint takes the money.
  if (!meetsLeadTime(startStr, now)) {
    return `${leadTimeMessage(now)}${label ? ` (${label.trim()})` : ''}`;
  }
  const days = daysBetween(startStr, endStr);
  if (days > STUDIO.rental.maxBookingDays) {
    return `Maximum booking duration is ${STUDIO.rental.maxBookingDays} days${label}.`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { suspended, reason: suspensionReason } = await checkNotSuspended(user.id);
  if (suspended) {
    return NextResponse.json(
      { error: 'Account suspended', reason: suspensionReason },
      { status: 403 },
    );
  }

  if (!(await checkRateLimit(`checkout:${user.id}`, 3, 60_000))) {
    return NextResponse.json(
      { error: 'Too many checkout attempts. Please wait.' },
      { status: 429 },
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('id', user.id)
    .single();

  if (profile?.verification_status !== 'verified') {
    const pending = profile?.verification_status === 'pending';
    return NextResponse.json(
      {
        error: pending
          ? 'Your ID check is being reviewed. You can pay once it is approved.'
          : 'Identity verification is required to rent equipment.',
        code: pending ? 'ID_PENDING' : 'ID_REQUIRED',
      },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  // The browser never states a price (T05). Anything that looks like one is
  // refused outright rather than silently ignored, so tampering is visible.
  const MONEY_FIELDS = ['amount', 'total', 'total_price', 'price', 'grand_total', 'deposit', 'deposit_amount', 'discount', 'delivery_fee', 'amount_due', 'currency'];
  if (MONEY_FIELDS.some((k) => k in body)) {
    logEvent({ eventType: 'checkout_tamper_rejected', eventCategory: 'security', userId: user.id, metadata: { fields: MONEY_FIELDS.filter((k) => k in body) } });
    return NextResponse.json({ error: 'Prices are calculated by the server.', code: 'CLIENT_PRICE_REJECTED' }, { status: 400 });
  }
  const {
    start_date,
    end_date,
    notes,
    fulfilment_method,
    payment_plan,
    payment_method,
    delivery_address,
    delivery_lat,
    delivery_lng,
    delivery_quote_id,
    return_quote_id,
    delivery_approved_cents,
    acceptTerms,
  } = body as {
    start_date: string;
    end_date: string;
    notes?: string;
    fulfilment_method?: string;
    payment_plan?: string;
    payment_method?: string;
    /** Legacy (before migration 076): the typed address, verified again here. */
    delivery_address?: string | Partial<AddressInput>;
    /** A browser map position: a hint only, never used for the price. */
    delivery_lat?: number;
    delivery_lng?: number;
    /** Stored delivery quotes (POST /api/delivery/quote): the only source of a delivery price. */
    delivery_quote_id?: string;
    return_quote_id?: string;
    /** The delivery total the customer approved, in cents. Compared, never charged (D08). */
    delivery_approved_cents?: number;
    acceptTerms?: boolean;
  };

  // The Terms, Privacy Policy and rental agreement must be accepted for every
  // order. The acceptance is recorded server-side further down, once the order
  // has passed the date, availability and eligibility checks: an order that
  // is refused should not leave a consent record behind.
  if (acceptTerms !== true) {
    return NextResponse.json(
      { error: 'Please accept the Terms, Privacy Policy and rental agreement.', code: 'CONSENT_REQUIRED' },
      { status: 400 },
    );
  }

  // ── Fulfilment ────────────────────────────────────────────────────────────
  // Never trust a fee or a position sent by the client. The delivery price is
  // a stored quote worked out from a server-verified address (Phase 4), or,
  // before migration 076, the own-vehicle formula on an address this server
  // geocoded itself. The browser's coordinates are only ever a hint.
  const fulfilment: 'collection' | 'delivery' =
    fulfilment_method === 'delivery' ? 'delivery' : 'collection';

  // While online card payment is off, the customer pays the whole order by
  // EFT to the business account, or in cash when they collect. With card
  // payment on, the original plans (all now, or deposit now) apply.
  const offline = !payments.isConfigured();
  const method: 'eft' | 'cash' | 'online' = !offline
    ? 'online'
    : payment_method === 'cash' && fulfilment === 'collection'
      ? 'cash'
      : 'eft';

  const plan: 'full' | 'deposit_only' =
    !offline &&
    fulfilment === 'collection' &&
    payment_plan === 'deposit_only' &&
    STUDIO.fulfilment.collection.allowBalanceOnCollection
      ? 'deposit_only'
      : 'full';

  let deliveryFee = 0;
  let deliveryDistanceKm: number | null = null;

  if (fulfilment === 'delivery') {
    if (!STUDIO.fulfilment.delivery.enabled) {
      return NextResponse.json(
        { error: 'Delivery is not available at the moment. Please choose collection.' },
        { status: 400 },
      );
    }
    const hasQuote = typeof delivery_quote_id === 'string' && delivery_quote_id.length > 0;
    const hasAddress = (typeof delivery_address === 'string' && delivery_address.trim().length >= 10) || (typeof delivery_address === 'object' && delivery_address !== null);
    if (!hasQuote && !hasAddress) {
      return NextResponse.json(
        { error: 'Get a delivery quote for your address first.', code: 'DELIVERY_QUOTE_REQUIRED' },
        { status: 400 },
      );
    }
  }

  const items = await getCartItems(user.id);

  if (items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty.' }, { status: 400 });
  }

  // Determine mode: per-item dates vs shared dates
  const allHaveDates = items.every((i) => i.start_date && i.end_date);
  const noneHaveDates = items.every((i) => !i.start_date && !i.end_date);

  let usePerItemDates = false;

  if (allHaveDates) {
    usePerItemDates = true;
  } else if (noneHaveDates) {
    if (!start_date || !end_date) {
      return NextResponse.json(
        { error: 'start_date and end_date are required when cart items have no dates set.' },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'All cart items must have dates set, or none. Please set dates on all items.' },
      { status: 400 },
    );
  }

  // Validate dates
  if (usePerItemDates) {
    for (const item of items) {
      const err = validateDateRange(
        item.start_date!,
        item.end_date!,
        ` for ${item.rental.title}`,
      );
      if (err) {
        // The cart sends the renter to this item's Edit dates.
        return NextResponse.json({ error: err, code: 'INVALID_DATES', rental_id: item.rental_id }, { status: 400 });
      }
    }
  } else {
    const err = validateDateRange(start_date, end_date, '');
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  // Check availability for all items
  const unavailableItems: string[] = [];
  // The first item that cannot be had, so the cart can open its dates.
  let unavailableRentalId: string | null = null;

  for (const item of items) {
    if (!item.rental.is_available) {
      unavailableItems.push(item.rental.title);
      unavailableRentalId ??= item.rental_id;
      continue;
    }

    const itemStart = usePerItemDates ? item.start_date! : start_date;
    const itemEnd = usePerItemDates ? item.end_date! : end_date;

    // Count UNITS, not bookings, with the same rules as the database:
    // inclusive dates, every blocking status, open-ended blocks for gear not
    // yet back, maintenance blocks. This read is only for a friendly message;
    // reserve_rental_order re-checks under a lock (T07).
    let holds;
    let blocked = 0;
    try {
      [holds, blocked] = await Promise.all([loadHolds(item.rental_id, itemStart, itemEnd), blockedUnits(item.rental_id, itemStart, itemEnd)]);
    } catch (err) {
      console.error('[cart/checkout] availability check failed:', err instanceof Error ? err.message : 'unknown error');
      return NextResponse.json(
        { error: 'Could not confirm availability just now. Please try again.' },
        { status: 503 },
      );
    }
    if (blocked > 0) holds.push({ id: 'rental_blocks', quantity: blocked, status: 'confirmed', createdAt: new Date(0).toISOString(), paymentReference: null });

    const availability = checkAvailability({
      stock: (item.rental as { quantity?: number }).quantity ?? 1,
      holds,
      requested: item.quantity,
      holdMinutes: effectiveHoldMinutes(),
    });

    if (!availability.available) {
      unavailableItems.push(availabilityMessage(item.rental.title, availability));
      unavailableRentalId ??= item.rental_id;

      // The strongest buying signal the platform ever sees: someone got as far
      // as checkout and was refused. Not awaited — research must never add
      // latency to, or be able to fail, a checkout.
      recordUnmetDemandAsync({
        kind: 'unavailable_dates',
        query: item.rental.title,
        source: 'checkout',
        rentalId: item.rental_id,
        startDate: itemStart,
        endDate: itemEnd,
        requested: availability.requested,
        available: availability.remaining,
        userId: user.id,
      });
    }
  }

  if (unavailableItems.length > 0) {
    return NextResponse.json(
      { error: unavailableItems.join(' '), code: 'UNAVAILABLE', rental_id: unavailableRentalId },
      { status: 409 },
    );
  }

  // Trust tiers and collection rules (spec §7.9, §3.5), worked out on the
  // server from the renter's record, before anything is reserved or charged.
  const trustLines = items.map((item) => ({
    unitReplacementValueCents: toCents(itemValue(item.rental as { replacement_value?: number | null; deposit_amount?: number | null })),
    quantity: item.quantity,
    // Each line keeps its own dates: the limit is on gear held at the same time.
    startDate: usePerItemDates ? item.start_date! : start_date,
    endDate: usePerItemDates ? item.end_date! : end_date,
  }));
  let eligibility;
  try {
    eligibility = await checkRenterEligibility(createAdminClient(), user, trustLines, fulfilment === 'delivery');
  } catch (err) {
    console.error('[cart/checkout] eligibility check failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Could not check your rental limit just now. Please try again.' }, { status: 503 });
  }
  if (!eligibility.ok) {
    logEvent({ eventType: 'booking_blocked', eventCategory: 'booking', userId: user.id, metadata: { reason: eligibility.code, kind: 'gear', source: 'cart', tier: eligibility.assessment.tier.id, exposureCents: eligibility.exposureCents } });
    return NextResponse.json({ error: eligibility.message, code: eligibility.code, tier: eligibility.assessment.tier.id }, { status: 403 });
  }

  // Recorded server-side against the current document versions
  // (public.consent_records, migration 068) before anything is reserved or
  // charged. A ticked box in the browser alone is not evidence, so the order
  // stops if the record fails.
  const consent = await recordConsent(supabase, {
    userId: user.id,
    purposes: requiredConsents('checkout'),
    source: 'checkout',
    ip: clientIp(request.headers),
    userAgent: request.headers.get('user-agent'),
  });
  if (!consent.ok) {
    console.error('[checkout] consent not recorded');
    return NextResponse.json(
      { error: 'Could not record your acceptance. Please try again.' },
      { status: 503 },
    );
  }

  // Calculate pricing
  let pricing: ReturnType<typeof calculateCartPricing> | ReturnType<typeof calculateCartPricingPerItem>;

  if (usePerItemDates) {
    pricing = calculateCartPricingPerItem(items);
  } else {
    const days = daysBetween(start_date, end_date);
    pricing = calculateCartPricing(items, days);
  }

  if (pricing.grandTotal <= 0) {
    return NextResponse.json({ error: 'Invalid pricing calculation.' }, { status: 500 });
  }

  // Same idempotency key → same order id → the database refuses a second copy (T06).
  const checkoutGroupId = checkoutGroupIdFor(user.id, request.headers.get('idempotency-key'));

  // Now that we know the order size, price the delivery on the server.
  let deliveryCents = 0;
  let deliveryQuotes: CustomerDeliveryQuote[] = [];
  let deliveryPoint: { formattedAddress: string; lat: number; lng: number } | null = null;
  let quoteLinks: SupabaseQuoteLinks | null = null;
  if (fulfilment === 'delivery') {
    let phase4: boolean;
    try {
      quoteLinks = new SupabaseQuoteLinks();
      phase4 = await quoteLinks.available();
    } catch {
      return NextResponse.json({ error: 'Could not price delivery just now. Please try again.' }, { status: 503 });
    }

    if (phase4) {
      // The stored, expiring quotes (spec §4.7). The browser's approved total
      // is compared, never charged; an expired quote is re-quoted and a
      // changed total comes back for the customer's approval (D07, D08).
      const quoteIds = [delivery_quote_id, return_quote_id].filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (quoteIds.length === 0) {
        return NextResponse.json({ error: 'Get a delivery quote for your address first.', code: 'DELIVERY_QUOTE_REQUIRED' }, { status: 400 });
      }
      const approved = typeof delivery_approved_cents === 'number' && Number.isSafeInteger(delivery_approved_cents) && delivery_approved_cents >= 0 ? delivery_approved_cents : null;
      const cartLines = cartLinesForDelivery(items, { start: start_date ?? null, end: end_date ?? null });
      if (!cartLines) return NextResponse.json({ error: 'Choose dates for each item first.', code: 'INVALID_DATES' }, { status: 400 });
      try {
        const deps = await deliveryDeps();
        const priced = await priceCheckoutDelivery({ renterId: user.id, quoteIds, approvedCents: approved, lines: deliveryLines(cartLines), bookingGroupId: checkoutGroupId }, deps);
        if (!priced.ok) {
          return NextResponse.json(
            { error: priced.message, code: priced.code, delivery_total_cents: priced.amountCents ?? null, quotes: (priced.quotes ?? []).map(publicQuote) },
            { status: priced.status },
          );
        }
        const outbound = priced.quotes.find((q) => q.leg === 'outbound');
        const point = outbound ? await deps.addresses.getPoint(outbound.destinationAddressId) : null;
        if (!point || point.userId !== user.id) {
          return NextResponse.json({ error: 'That delivery quote is not valid. Please get a new quote.', code: 'DELIVERY_QUOTE_INVALID' }, { status: 400 });
        }
        deliveryCents = priced.amountCents;
        deliveryQuotes = priced.quotes;
        deliveryPoint = point;
      } catch (err) {
        console.error('[cart/checkout] delivery pricing failed:', err instanceof Error ? err.message : 'unknown error');
        return NextResponse.json({ error: 'Could not price delivery just now. Please try again.' }, { status: 503 });
      }
    } else {
      // Before migration 076: verify the typed address here (never the
      // browser's coordinates) and apply the own-vehicle formula to it.
      const input: Partial<AddressInput> | null = typeof delivery_address === 'string' ? { street: delivery_address } : (delivery_address ?? null);
      const verified = await verifyAddress(input, addressPort());
      if (!verified.ok) {
        return NextResponse.json({ error: verified.message, code: verified.code }, { status: verified.code === 'ADDRESS_CHECK_UNAVAILABLE' ? 503 : 400 });
      }
      if (!inServiceArea(verified.address)) {
        return NextResponse.json({ error: `We deliver in ${STUDIO.serviceArea.summary} only. ${STUDIO.serviceArea.outsideProvinceNote}`, code: 'out_of_area' }, { status: 400 });
      }
      const q = quoteOwnVehicleCents({ destination: verified.address, itemCount: pricing.itemCount });
      if (!('feeCents' in q)) {
        const message =
          q.reason === 'out_of_range'
            ? `That address is about ${q.distanceKm}km away, beyond our ${q.maxRadiusKm}km delivery radius. Please choose collection, or contact us for a delivery quote.`
            : 'Delivery is not available at the moment. Please choose collection.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      deliveryCents = q.feeCents;
      deliveryPoint = verified.address;
    }

    // The browser's position, if it sent one, is only compared (and logged when it disagrees).
    const hint = compareHint(deliveryPoint, { lat: delivery_lat, lng: delivery_lng });
    if (hint.provided && !hint.withinTolerance) {
      logEvent({ eventType: 'delivery_hint_mismatch', eventCategory: 'security', userId: user.id, metadata: { distanceKm: hint.distanceKm, source: 'checkout' } });
    }
    deliveryFee = deliveryCents / 100;
    // Distance from our site, recorded for staff on the legacy columns (from the verified point).
    const measured = quoteOwnVehicleCents({ destination: deliveryPoint, itemCount: pricing.itemCount });
    deliveryDistanceKm = 'distanceKm' in measured ? measured.distanceKm : null;
  }

  // What the customer pays right now.
  //   full         -> hire, less discount, plus deposits, plus any delivery
  //   deposit_only -> deposits only; the hire charge is settled at the counter
  const hireCharge = pricing.subtotal - pricing.bulkDiscountAmount;
  const balanceDue = plan === 'deposit_only' ? Math.round(hireCharge * 100) / 100 : 0;
  const amountDueNow =
    Math.round((pricing.grandTotal + deliveryFee - balanceDue) * 100) / 100;

  if (amountDueNow <= 0) {
    return NextResponse.json({ error: 'Nothing payable on this order.' }, { status: 400 });
  }

  // Create bookings with shared checkout_group_id
  const adminClient = createAdminClient();
  const currency = items[0]?.rental.currency ?? STUDIO.currency.code;
  // Who owns each item decides the owner/platform split and the payout. Read
  // it on the server (the cart projection does not carry it), and refuse to
  // snapshot an order whose ownership could not be read: guessing "studio"
  // would credit a community owner's hire to the studio.
  const ownership = new Map<string, { owner_type: string | null; owner_id: string | null }>();
  {
    const { data: owners, error: ownersError } = await createAdminClient()
      .from('smart_rentals')
      .select('id, owner_type, owner_id')
      .in('id', items.map((i) => i.rental_id));
    if (ownersError) {
      console.error('[cart/checkout] could not load item ownership:', ownersError.message);
      return NextResponse.json({ error: 'Could not start checkout just now. Please try again.' }, { status: 503 });
    }
    for (const o of (owners ?? []) as { id: string; owner_type: string | null; owner_id: string | null }[]) ownership.set(o.id, o);
  }
  const snapshots = snapshotLines(
    items.map((item) => {
      const pi = pricing.items.find((x) => x.rental_id === item.rental_id);
      const rental = { ...(item.rental as { replacement_value?: number | null; deposit_amount?: number | null }), ...ownership.get(item.rental_id) };
      return {
        rentalId: item.rental_id,
        quantity: item.quantity,
        subtotalRands: pi?.subtotal ?? 0,
        depositRands: pi?.deposit ?? 0,
        unitReplacementValueRands: itemValue(rental),
        ownerType: rental.owner_type ?? null,
        ownerId: rental.owner_id ?? null,
      };
    }),
    pricing.bulkDiscountAmount,
  );

  const bookingInserts = items.map((item, index) => {
    const pricingItem = pricing.items.find((pi) => pi.rental_id === item.rental_id);
    const itemStart = usePerItemDates ? item.start_date! : start_date;
    const itemEnd = usePerItemDates ? item.end_date! : end_date;

    return {
      user_id: user.id,
      rental_id: item.rental_id,
      start_date: itemStart,
      end_date: itemEnd,
      total_price: pricingItem?.subtotal ?? 0,
      deposit_amount: pricingItem?.deposit ?? 0,
      currency,
      status: 'pending' as const,
      quantity: item.quantity,
      notes: notes?.trim() || null,
      checkout_group_id: checkoutGroupId,
      fulfilment_method: fulfilment,
      payment_plan: plan,
      payment_method: method,
      ...snapshots[index],
      requires_manual_approval: eligibility.requiresManualApproval,
      // The delivery charge and outstanding balance belong to the order, not
      // to each line, so they are recorded once against the first booking in
      // the group to avoid multiplying them by the number of items.
      ...(item.rental_id === items[0]?.rental_id
        ? {
            // Legacy columns, kept for staff screens: the VERIFIED address and point.
            delivery_address: fulfilment === 'delivery' && deliveryPoint ? deliveryPoint.formattedAddress : null,
            delivery_lat: fulfilment === 'delivery' && deliveryPoint ? deliveryPoint.lat : null,
            delivery_lng: fulfilment === 'delivery' && deliveryPoint ? deliveryPoint.lng : null,
            delivery_distance_km: deliveryDistanceKm,
            delivery_fee: fulfilment === 'delivery' ? deliveryFee : null,
            balance_due: balanceDue > 0 ? balanceDue : null,
            amount_due: amountDueNow,
          }
        : {}),
    };
  });

  // Reserve every line and record the expected payment in one transaction.
  const reservation = await reserveOrder(
    adminClient,
    bookingInserts.map((row) => ({ ...row, id: crypto.randomUUID() })),
    payments.isConfigured()
      ? {
          reference: checkoutGroupId,
          provider: process.env.PAYMENT_PROVIDER ?? 'paystack',
          expectedAmountCents: toCents(amountDueNow),
          depositCents: toCents(pricing.totalDeposit),
          deliveryCents,
        }
      : null,
    effectiveHoldMinutes(),
  );

  let bookings: { id: string }[];
  if (reservation.ok) {
    bookings = reservation.bookingIds.map((id) => ({ id }));
    // Check the limit again now that this order is held: two checkouts placed
    // at the same moment each passed the first check on the same exposure.
    // Each now sees the other's hold; one over the limit is released (fail closed).
    let recheck;
    try {
      recheck = await checkRenterEligibility(createAdminClient(), user, trustLines, fulfilment === 'delivery', new Date(), { excludeGroupId: checkoutGroupId });
    } catch {
      recheck = null;
    }
    if (!recheck || !recheck.ok) {
      await releaseUnpaidReservation(adminClient, checkoutGroupId);
      if (!recheck) return NextResponse.json({ error: 'Could not check your rental limit just now. Please try again.' }, { status: 503 });
      return NextResponse.json({ error: recheck.message, code: recheck.code, tier: recheck.assessment.tier.id }, { status: 403 });
    }
    // Tie the delivery quotes to this order, so the verified payment can book
    // the delivery (lib/delivery/after-payment.ts). A quote another order
    // already holds is refused: the order is released and re-quoted.
    if (deliveryQuotes.length > 0 && quoteLinks) {
      let linked = true;
      try {
        for (const q of deliveryQuotes) linked = linked && (await quoteLinks.linkToGroup(q.id, checkoutGroupId));
      } catch {
        linked = false;
      }
      if (!linked) {
        await releaseUnpaidReservation(adminClient, checkoutGroupId);
        return NextResponse.json({ error: 'Your delivery quote could not be used. Please get a new quote and try again.', code: 'DELIVERY_QUOTE_INVALID' }, { status: 409 });
      }
    }
  } else if (reservation.code === 'insufficient_stock' || reservation.code === 'listing_unavailable') {
    const title = items.find((i) => i.rental_id === reservation.rentalId)?.rental.title ?? 'An item in your cart';
    return NextResponse.json({ error: `${title} was just booked by someone else for those dates.`, code: 'UNAVAILABLE', rental_id: reservation.rentalId ?? null }, { status: 409 });
  } else if (reservation.code === 'duplicate_order') {
    return NextResponse.json({ error: 'This order was already placed.', code: 'DUPLICATE_REQUEST', checkout_group_id: checkoutGroupId }, { status: 409 });
  } else if (reservation.code === 'missing_pipeline') {
    // Migration 070 not applied yet: the earlier insert path (no lock).
    const { data, error: insertError } = await adminClient
      .from('equipment_bookings')
      .insert(bookingInserts.map((row) => {
        const legacy: Record<string, unknown> = { ...row };
        for (const k of ['hire_cents', 'deposit_cents', 'owner_share_cents', 'platform_share_cents', 'unit_replacement_value_cents', 'ownership', 'owner_id', 'requires_manual_approval']) delete legacy[k];
        return legacy;
      }))
      .select('id');
    if (insertError || !data?.length) {
      console.error('[cart/checkout] Insert error:', insertError?.message);
      return NextResponse.json({ error: 'Failed to create bookings.' }, { status: 500 });
    }
    bookings = data as { id: string }[];
  } else {
    console.error('[cart/checkout] reservation failed:', 'message' in reservation ? reservation.message : reservation.code);
    return NextResponse.json({ error: 'Failed to create bookings.' }, { status: 500 });
  }

  // Create payment checkout (retry up to 2 times on failure)
  let paymentUrl: string | null = null;

  if (payments.isConfigured()) {
    const itemNames = items.map((i) => i.rental.title).slice(0, 3);
    const itemDescription = items.length > 3
      ? `${itemNames.join(', ')} +${items.length - 3} more`
      : itemNames.join(', ');

    const dateLabel = usePerItemDates
      ? `${items.length} items with individual dates`
      : `${start_date} to ${end_date}`;

    const checkoutParams = {
      paymentId: checkoutGroupId,
      amount: amountDueNow,
      itemName: `Equipment Rental (${items.length} items)`,
      itemDescription: `${itemDescription} — ${dateLabel}`,
      email: user.email ?? undefined,
      returnUrl: `/dashboard/bookings?checkout=${checkoutGroupId}&payment=success`,
      // Back to the cart, which releases this unpaid hold and puts the items
      // back (POST /api/cart/cancel), so the customer can try again.
      cancelUrl: `/dashboard/cart?payment=cancelled&order=${checkoutGroupId}`,
      metadata: {
        customStr1: 'cart_checkout',
        customStr2: user.id,
        customStr3: checkoutGroupId,
        customStr4: String(pricing.bulkDiscountPercent),
      },
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const checkout = await payments.createCheckout(checkoutParams);
        paymentUrl = checkout.paymentUrl;
        break;
      } catch (err) {
        console.error(`[cart/checkout] Payment init attempt ${attempt + 1}/3 failed:`, err);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  // If payment provider is configured but checkout failed, roll back
  if (payments.isConfigured() && !paymentUrl) {
    await releaseUnpaidReservation(adminClient, checkoutGroupId);
    return NextResponse.json(
      { error: 'Payment service unavailable. Please try again.' },
      { status: 503 },
    );
  }

  // Create payment records. These are the reconciliation record: their sum is
  // exactly what we asked the gateway to charge, which is what the webhook
  // checks the receipt against.
  // Split in integer cents with a deterministic remainder, so the lines sum to
  // exactly what the gateway charges (a per-line round() could drift by a few
  // cents and trip the webhook's amount check).
  const lineAmounts = splitAcrossLines(amountDueNow, bookings.length);
  const paymentRecords = bookings.map((b, i) => ({
    booking_id: b.id,
    amount: lineAmounts[i],
    currency,
    status: 'pending' as const,
  }));

  await adminClient.from('booking_payments').insert(paymentRecords);

  // Clear cart
  await clearCart(user.id);

  logEvent({
    eventType: 'booking_created',
    eventCategory: 'booking',
    userId: user.id,
    metadata: { kind: 'gear', source: 'cart', checkoutGroupId, items: bookings.length, amountDueNow, plan, fulfilment, paymentLink: Boolean(paymentUrl) },
  });

  // Funnel (spec §9.6): ids and counts only.
  trackFunnel('rental_reserved', { userId: user.id, meta: { groupId: checkoutGroupId, items: bookings.length, source: 'cart' } });
  if (paymentUrl) trackFunnel('payment_started', { userId: user.id, meta: { groupId: checkoutGroupId, source: 'cart' } });
  // An owner's FIRST booking: only while none of their community gear has a
  // booking that reached payment (anything past pending, never cancelled
  // unpaid). One small read per owner in this order; analytics never fails a
  // checkout, so any error just skips the event.
  const firstLineByOwner = new Map<string, string>();
  snapshots.forEach((snap, i) => {
    if (snap.ownership === 'community' && snap.owner_id && !firstLineByOwner.has(snap.owner_id)) {
      firstLineByOwner.set(snap.owner_id, items[i].rental_id);
    }
  });
  await Promise.all(
    [...firstLineByOwner].map(async ([ownerId, rentalId]) => {
      try {
        const { data: earlier, error: earlierError } = await adminClient
          .from('equipment_bookings')
          .select('id')
          .eq('owner_id', ownerId)
          .eq('ownership', 'community')
          .or('status.not.in.(pending,cancelled),payfast_payment_id.not.is.null')
          .limit(1);
        if (earlierError || (earlier ?? []).length > 0) return;
        trackFunnel('listing_first_booking', { userId: ownerId, meta: { rentalId, groupId: checkoutGroupId } });
      } catch {
        /* analytics only */
      }
    }),
  );

  const paymentsOffline = offline;
  const reference = paymentReference(checkoutGroupId);
  // The order's first line carries the amount; the pay screen opens on it.
  const ids = bookings.map((b) => b.id as string);
  const { data: firstLine } = await adminClient
    .from('equipment_bookings')
    .select('id')
    .in('id', ids)
    .not('amount_due', 'is', null)
    .maybeSingle();
  const firstId = firstLine?.id ?? ids[0];

  if (paymentsOffline) {
    reportUnpaidRequest({
      kind: 'cart',
      reference,
      userId: user.id,
      userEmail: user.email,
      amount: amountDueNow,
      summary: `${bookings.length} item(s) from the cart, paying by ${method === 'cash' ? 'cash at collection' : 'EFT'}`,
    });
    const noticeItems = await loadNoticeBookings([firstId, ...ids.filter((i) => i !== firstId)]);
    await sendGearNotice('awaiting_payment', noticeItems, { amountDue: amountDueNow, reference, method });
  }

  return NextResponse.json(
    {
      checkout_group_id: checkoutGroupId,
      booking_count: bookings.length,
      booking_id: firstId,
      pricing,
      payment_url: paymentUrl,
      ...(paymentsOffline ? { payments_offline: true, payment_method: method, reference, amount_due: amountDueNow, message: PAYMENTS_OFF_MESSAGE } : {}),
    },
    { status: 201 },
  );
}
