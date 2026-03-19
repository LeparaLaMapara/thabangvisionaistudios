export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { checkRateLimit } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { getCartItems, clearCart } from '@/lib/supabase/queries/cart';
import { calculateCartPricing } from '@/lib/cart/pricing';

/**
 * POST /api/cart/checkout
 * Validates dates, checks availability for all items, calculates pricing,
 * creates multiple equipment_bookings with shared checkout_group_id,
 * creates single payment checkout, and clears the cart.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkRateLimit(`checkout:${user.id}`, 3, 60_000)) {
    return NextResponse.json(
      { error: 'Too many checkout attempts. Please wait.' },
      { status: 429 },
    );
  }

  const body = await request.json();
  const { start_date, end_date, notes } = body;

  // --- Validate dates ---
  if (!start_date || !end_date) {
    return NextResponse.json(
      { error: 'start_date and end_date are required.' },
      { status: 400 },
    );
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: 'Invalid date format.' }, { status: 400 });
  }

  if (end <= start) {
    return NextResponse.json(
      { error: 'end_date must be after start_date.' },
      { status: 400 },
    );
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (start < now) {
    return NextResponse.json({ error: 'Cannot book for past dates.' }, { status: 400 });
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (days > STUDIO.rental.maxBookingDays) {
    return NextResponse.json(
      { error: `Maximum booking duration is ${STUDIO.rental.maxBookingDays} days.` },
      { status: 400 },
    );
  }

  // --- Fetch cart items ---
  const items = await getCartItems(user.id);

  if (items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty.' }, { status: 400 });
  }

  // --- Check availability for all items ---
  const unavailableItems: string[] = [];

  for (const item of items) {
    if (!item.rental.is_available) {
      unavailableItems.push(item.rental.title);
      continue;
    }

    // Check for date conflicts
    const { data: conflicts } = await supabase
      .from('equipment_bookings')
      .select('id')
      .eq('rental_id', item.rental_id)
      .in('status', ['pending', 'confirmed', 'active'])
      .lt('start_date', end_date)
      .gt('end_date', start_date)
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

  // --- Calculate pricing ---
  const pricing = calculateCartPricing(items, days);

  if (pricing.grandTotal <= 0) {
    return NextResponse.json({ error: 'Invalid pricing calculation.' }, { status: 500 });
  }

  // --- Create bookings with shared checkout_group_id ---
  const adminClient = createAdminClient();
  const checkoutGroupId = crypto.randomUUID();
  const currency = items[0]?.rental.currency ?? STUDIO.currency.code;

  const bookingInserts = items.map((item) => {
    const pricingItem = pricing.items.find((pi) => pi.rental_id === item.rental_id);
    return {
      user_id: user.id,
      rental_id: item.rental_id,
      start_date,
      end_date,
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

  // --- Create payment checkout ---
  let paymentUrl: string | null = null;

  if (payments.isConfigured()) {
    try {
      // Use the checkout_group_id as the payment reference
      const itemNames = items.map((i) => i.rental.title).slice(0, 3);
      const itemDescription = items.length > 3
        ? `${itemNames.join(', ')} +${items.length - 3} more`
        : itemNames.join(', ');

      const checkout = await payments.createCheckout({
        paymentId: checkoutGroupId,
        amount: pricing.grandTotal,
        itemName: `Equipment Rental (${items.length} items)`,
        itemDescription: `${itemDescription} — ${start_date} to ${end_date}`,
        email: user.email ?? undefined,
        returnUrl: `/dashboard/bookings?checkout=${checkoutGroupId}&payment=success`,
        cancelUrl: `/dashboard/cart?payment=cancelled`,
        metadata: {
          customStr1: 'cart_checkout',
          customStr2: user.id,
          customStr3: checkoutGroupId,
          customStr4: String(pricing.bulkDiscountPercent),
        },
      });
      paymentUrl = checkout.paymentUrl;
    } catch (err) {
      console.error('[cart/checkout] Payment error:', err);
    }
  }

  // --- Create payment records ---
  const paymentRecords = bookings.map((b) => ({
    booking_id: b.id,
    amount: pricing.grandTotal / bookings.length,
    currency,
    status: 'pending' as const,
  }));

  await adminClient.from('booking_payments').insert(paymentRecords);

  // --- Clear cart ---
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
