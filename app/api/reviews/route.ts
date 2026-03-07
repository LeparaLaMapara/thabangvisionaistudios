import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json(
      { error: 'user_id query param is required.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { order_id, rating, comment } = body;

  if (!order_id || !rating) {
    return NextResponse.json(
      { error: 'order_id and rating are required.' },
      { status: 400 },
    );
  }

  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return NextResponse.json(
      { error: 'Rating must be an integer between 1 and 5.' },
      { status: 400 },
    );
  }

  // Verify order exists and is completed
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, buyer_id, seller_id, status')
    .eq('id', order_id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }

  if (order.status !== 'completed') {
    return NextResponse.json(
      { error: 'Reviews can only be left on completed orders.' },
      { status: 400 },
    );
  }

  // Verify the reviewer is buyer or seller of this order
  if (order.buyer_id !== user.id && order.seller_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Determine reviewee (the other party)
  const revieweeId =
    order.buyer_id === user.id ? order.seller_id : order.buyer_id;

  // Prevent duplicate reviews
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('order_id', order_id)
    .eq('reviewer_id', user.id)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: 'You have already reviewed this order.' },
      { status: 409 },
    );
  }

  const { data: review, error: insertError } = await supabase
    .from('reviews')
    .insert({
      order_id,
      reviewer_id: user.id,
      reviewee_id: revieweeId,
      rating,
      comment: comment?.trim() || null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(review, { status: 201 });
}
