export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import {
  getCartItems,
  getCartItemCount,
  addToCart,
  removeFromCart,
  updateCartQuantity,
  updateCartItemDates,
  clearCart,
} from '@/lib/supabase/queries/cart';

/** GET /api/cart — list cart items with rental details */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [items, count] = await Promise.all([
    getCartItems(user.id),
    getCartItemCount(user.id),
  ]);

  return NextResponse.json({ items, count });
}

/** POST /api/cart — add or update item in cart */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await checkRateLimit(`cart:${user.id}`, 20, 60_000))) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.' },
      { status: 429 },
    );
  }

  const body = await request.json();
  const { rental_id, quantity, start_date, end_date } = body;

  if (!rental_id || typeof rental_id !== 'string') {
    return NextResponse.json({ error: 'rental_id is required.' }, { status: 400 });
  }

  const qty = typeof quantity === 'number' ? Math.max(1, Math.min(5, Math.floor(quantity))) : 1;

  if ((start_date && !end_date) || (!start_date && end_date)) {
    return NextResponse.json(
      { error: 'Both start_date and end_date must be provided together.' },
      { status: 400 },
    );
  }

  // Check cart size limit
  const currentCount = await getCartItemCount(user.id);
  if (currentCount >= STUDIO.rental.maxCartItems) {
    return NextResponse.json(
      { error: `Cart is full. Maximum ${STUDIO.rental.maxCartItems} items allowed.` },
      { status: 400 },
    );
  }

  // Verify rental exists and is available
  const { data: rental } = await supabase
    .from('smart_rentals')
    .select('id, is_available')
    .eq('id', rental_id)
    .eq('is_available', true)
    .is('deleted_at', null)
    .single();

  if (!rental) {
    return NextResponse.json({ error: 'Rental not found or unavailable.' }, { status: 404 });
  }

  const item = await addToCart(user.id, rental_id, qty, start_date, end_date);

  if (!item) {
    return NextResponse.json({ error: 'Failed to add item to cart.' }, { status: 500 });
  }

  const count = await getCartItemCount(user.id);

  return NextResponse.json({ item, count }, { status: 201 });
}

/** PATCH /api/cart — update item quantity */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { item_id, quantity, start_date, end_date } = body;

  if (!item_id) {
    return NextResponse.json({ error: 'item_id is required.' }, { status: 400 });
  }

  let item = null;

  if (typeof quantity === 'number') {
    const qty = Math.max(1, Math.min(5, Math.floor(quantity)));
    item = await updateCartQuantity(user.id, item_id, qty);
  }

  if (start_date !== undefined || end_date !== undefined) {
    const sd = start_date ?? null;
    const ed = end_date ?? null;
    if ((sd && !ed) || (!sd && ed)) {
      return NextResponse.json(
        { error: 'Both start_date and end_date must be provided together, or both null.' },
        { status: 400 },
      );
    }
    item = await updateCartItemDates(user.id, item_id, sd, ed);
  }

  if (!item) {
    return NextResponse.json({ error: 'Cart item not found.' }, { status: 404 });
  }

  return NextResponse.json({ item });
}

/** DELETE /api/cart — remove item or clear cart */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('item_id');

  if (itemId) {
    const success = await removeFromCart(user.id, itemId);
    if (!success) {
      return NextResponse.json({ error: 'Failed to remove item.' }, { status: 500 });
    }
  } else {
    await clearCart(user.id);
  }

  const count = await getCartItemCount(user.id);
  return NextResponse.json({ count });
}
