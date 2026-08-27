export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { getCartItems, clearCart } from '@/lib/supabase/queries/cart';
import { calculateCartPricing, calculateCartPricingPerItem } from '@/lib/cart/pricing';
import { quoteDelivery, isDeliveryQuote } from '@/lib/delivery/quote';
import { checkAvailability, availabilityMessage, type BookingHold } from '@/lib/rental/availability';
import type { CartItemWithRental } from '@/types/cart';

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
  now.setHours(0, 0, 0, 0);
  if (start < now) {
    return `Cannot book for past dates${label}.`;
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
    return NextResponse.json(
      { error: 'Identity verification is required to rent equipment.' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const {
    start_date,
    end_date,
    notes,
    fulfilment_method,
    payment_plan,
    delivery_address,
    delivery_lat,
    delivery_lng,
  } = body;

  // ── Fulfilment ────────────────────────────────────────────────────────────
  // Never trust a fee sent by the client. We take the address and recalculate
  // the delivery charge here with the same pure function the cart used, so a
  // customer can only ever be charged a number this server worked out.
  const fulfilment: 'collection' | 'delivery' =
    fulfilment_method === 'delivery' ? 'delivery' : 'collection';

  const plan: 'full' | 'deposit_only' =
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
    if (typeof delivery_address !== 'string' || delivery_address.trim().length < 10) {
      return NextResponse.json(
        { error: 'A delivery address is required.' },
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
        return NextResponse.json({ error: err }, { status: 400 });
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

  for (const item of items) {
    if (!item.rental.is_available) {
      unavailableItems.push(item.rental.title);
      continue;
    }

    const itemStart = usePerItemDates ? item.start_date! : start_date;
    const itemEnd = usePerItemDates ? item.end_date! : end_date;

    // Count UNITS, not bookings. The old check took the first overlapping row
    // as a refusal and never read smart_rentals.quantity, so a listing with
    // two cameras only ever rented one at a time.
    const { data: overlapping, error: overlapErr } = await supabase
      .from('equipment_bookings')
      .select('id, quantity, status, created_at, payfast_payment_id')
      .eq('rental_id', item.rental_id)
      .in('status', ['pending', 'confirmed', 'active'])
      .lt('start_date', itemEnd)
      .gt('end_date', itemStart);

    // Never treat an unreadable availability check as "available" -- that
    // would sell the same gear twice.
    if (overlapErr) {
      console.error('[cart/checkout] availability check failed:', overlapErr.message);
      return NextResponse.json(
        { error: 'Could not confirm availability just now. Please try again.' },
        { status: 503 },
      );
    }

    const holds: BookingHold[] = (overlapping ?? []).map((b) => {
      const row = b as {
        id: string; quantity: number | null; status: string;
        created_at: string; payfast_payment_id: string | null;
      };
      return {
        id: row.id,
        quantity: row.quantity ?? 1,
        status: row.status,
        createdAt: row.created_at,
        paymentReference: row.payfast_payment_id,
      };
    });

    const availability = checkAvailability({
      stock: (item.rental as { quantity?: number }).quantity ?? 1,
      holds,
      requested: item.quantity,
    });

    if (!availability.available) {
      unavailableItems.push(availabilityMessage(item.rental.title, availability));
    }
  }

  if (unavailableItems.length > 0) {
    return NextResponse.json(
      { error: unavailableItems.join(' ') },
      { status: 409 },
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

  // Now that we know the order size, price the delivery.
  if (fulfilment === 'delivery') {
    const quote = quoteDelivery({
      destination:
        typeof delivery_lat === 'number' && typeof delivery_lng === 'number'
          ? { lat: delivery_lat, lng: delivery_lng }
          : null,
      itemCount: pricing.itemCount,
    });

    if (!isDeliveryQuote(quote)) {
      const message =
        quote.reason === 'out_of_range'
          ? `That address is about ${quote.distanceKm}km away, beyond our ${quote.maxRadiusKm}km delivery radius. Please choose collection, or contact us for a delivery quote.`
          : 'We could not locate that address precisely enough to price delivery. Please pick it from the suggestions, or choose collection.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    deliveryFee = quote.fee;
    deliveryDistanceKm = quote.distanceKm;
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
  const checkoutGroupId = crypto.randomUUID();
  const currency = items[0]?.rental.currency ?? STUDIO.currency.code;

  const bookingInserts = items.map((item) => {
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
      // The delivery charge and outstanding balance belong to the order, not
      // to each line, so they are recorded once against the first booking in
      // the group to avoid multiplying them by the number of items.
      ...(item.rental_id === items[0]?.rental_id
        ? {
            delivery_address: fulfilment === 'delivery' ? String(delivery_address).trim() : null,
            delivery_lat: fulfilment === 'delivery' ? delivery_lat : null,
            delivery_lng: fulfilment === 'delivery' ? delivery_lng : null,
            delivery_distance_km: deliveryDistanceKm,
            delivery_fee: fulfilment === 'delivery' ? deliveryFee : null,
            balance_due: balanceDue > 0 ? balanceDue : null,
          }
        : {}),
    };
  });

  const { data: bookings, error: insertError } = await adminClient
    .from('equipment_bookings')
    .insert(bookingInserts)
    .select('id');

  if (insertError || !bookings?.length) {
    console.error('[cart/checkout] Insert error:', insertError?.message);
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
      cancelUrl: `/dashboard/cart?payment=cancelled`,
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
    await adminClient
      .from('equipment_bookings')
      .delete()
      .eq('checkout_group_id', checkoutGroupId);
    return NextResponse.json(
      { error: 'Payment service unavailable. Please try again.' },
      { status: 503 },
    );
  }

  // Create payment records. These are the reconciliation record: their sum is
  // exactly what we asked the gateway to charge, which is what the webhook
  // checks the receipt against.
  const paymentRecords = bookings.map((b) => ({
    booking_id: b.id,
    amount: Math.round((amountDueNow / bookings.length) * 100) / 100,
    currency,
    status: 'pending' as const,
  }));

  await adminClient.from('booking_payments').insert(paymentRecords);

  // Clear cart
  await clearCart(user.id);

  return NextResponse.json(
    {
      checkout_group_id: checkoutGroupId,
      booking_count: bookings.length,
      pricing,
      payment_url: paymentUrl,
    },
    { status: 201 },
  );
}
