export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { checkRateLimit, checkNotSuspended } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { getCartItems, clearCart } from '@/lib/supabase/queries/cart';
import { calculateCartPricing, calculateCartPricingPerItem } from '@/lib/cart/pricing';
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

  if (!checkRateLimit(`checkout:${user.id}`, 3, 60_000)) {
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
  const { start_date, end_date, notes } = body;

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

    const { data: conflicts } = await supabase
      .from('equipment_bookings')
      .select('id')
      .eq('rental_id', item.rental_id)
      .in('status', ['pending', 'confirmed', 'active'])
      .lt('start_date', itemEnd)
      .gt('end_date', itemStart)
      .limit(1);

    if (conflicts && conflicts.length > 0) {
      unavailableItems.push(item.rental.title);
    }
  }

  if (unavailableItems.length > 0) {
    return NextResponse.json(
      { error: `Unavailable for selected dates: ${unavailableItems.join(', ')}` },
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
      notes: notes?.trim() || null,
      checkout_group_id: checkoutGroupId,
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
      amount: pricing.grandTotal,
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

  // Create payment records
  const paymentRecords = bookings.map((b) => ({
    booking_id: b.id,
    amount: pricing.grandTotal / bookings.length,
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
