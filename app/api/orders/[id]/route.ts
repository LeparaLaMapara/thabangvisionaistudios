export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { OrderStatus } from '@/types/order';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/orders/[id]
 * Returns a single order if the authenticated user is buyer or seller.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, listings(title, thumbnail_url)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    console.error('[GET /api/orders/[id]]', error.message);
    return NextResponse.json({ error: 'Failed to fetch order.' }, { status: 500 });
  }

  // Ownership check: only buyer or seller can view
  if (data.buyer_id !== user.id && data.seller_id !== user.id) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  const listing = data.listings as { title: string; thumbnail_url: string | null } | null;
  return NextResponse.json({
    ...data,
    listings: undefined,
    listing_title: listing?.title ?? null,
    listing_thumbnail: listing?.thumbnail_url ?? null,
  });
}

/**
 * PUT /api/orders/[id]
 * Update order status. Buyers can cancel pending orders.
 * Sellers can mark as shipped/delivered/completed.
 * System (PayFast ITN) handles paid/refunded transitions.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteContext,
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { status, notes } = body as { status?: string; notes?: string };

  if (!status) {
    return NextResponse.json({ error: 'Status is required.' }, { status: 400 });
  }

  // Fetch order to check ownership and current state
  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('buyer_id, seller_id, status')
    .eq('id', id)
    .single();

  if (fetchError || !order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;

  if (!isBuyer && !isSeller) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  // Allowed transitions by role
  const buyerAllowed: OrderStatus[] = ['cancelled'];
  const sellerAllowed: OrderStatus[] = ['shipped', 'delivered', 'completed'];

  if (isBuyer && !buyerAllowed.includes(status as OrderStatus)) {
    return NextResponse.json(
      { error: 'You can only cancel orders.' },
      { status: 403 },
    );
  }

  if (isSeller && !isBuyer && !sellerAllowed.includes(status as OrderStatus)) {
    return NextResponse.json(
      { error: 'Invalid status transition.' },
      { status: 403 },
    );
  }

  // Buyers can only cancel pending orders
  if (isBuyer && status === 'cancelled' && order.status !== 'pending') {
    return NextResponse.json(
      { error: 'Only pending orders can be cancelled.' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (notes !== undefined) update.notes = notes?.trim() || null;

  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[PUT /api/orders/[id]]', updateError.message);
    return NextResponse.json({ error: 'Failed to update order.' }, { status: 500 });
  }

  return NextResponse.json(updated);
}
