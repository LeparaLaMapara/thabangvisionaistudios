import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPayFastConfigured, buildPaymentData, getPayFastUrl } from '@/lib/payfast';

const PLATFORM_FEE_PERCENT = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: listingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch the listing
  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (listingError || !listing) {
    return NextResponse.json(
      { error: 'Listing not found.' },
      { status: 404 },
    );
  }

  // Prevent buying your own listing
  if (listing.user_id === user.id) {
    return NextResponse.json(
      { error: 'You cannot order your own listing.' },
      { status: 400 },
    );
  }

  const body = await request.json();
  const notes = body.notes?.trim() || null;

  const total = listing.price;
  const platformFee = Math.round(total * PLATFORM_FEE_PERCENT) / 100;
  const sellerPayout = total - platformFee;
  const currency = listing.currency ?? 'ZAR';

  // Create order record first (status: pending)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: user.id,
      seller_id: listing.user_id,
      listing_id: listingId,
      status: 'pending',
      total,
      platform_fee: platformFee,
      seller_payout: sellerPayout,
      currency,
      notes,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  // Build PayFast payment URL if configured
  let paymentUrl: string | null = null;

  if (isPayFastConfigured() && total > 0) {
    try {
      const paymentData = buildPaymentData({
        amount: total,
        itemName: listing.title.slice(0, 100),
        itemDescription: `Marketplace order for ${listing.title}`.slice(0, 255),
        email: user.email ?? undefined,
        paymentId: order.id,
        returnUrl: `/dashboard/orders?payment=success`,
        cancelUrl: `/marketplace/${listingId}?payment=cancelled`,
        customStr1: 'marketplace_order',
        customStr2: listing.user_id, // seller_id for payout tracking
        customStr3: listingId,
      });

      const params = new URLSearchParams(paymentData as Record<string, string>);
      paymentUrl = `${getPayFastUrl()}?${params.toString()}`;
    } catch (err) {
      console.error('[marketplace/order] PayFast error:', err);
    }
  }

  return NextResponse.json(
    { ...order, payment_url: paymentUrl },
    { status: 201 },
  );
}
