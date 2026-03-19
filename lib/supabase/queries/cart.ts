import { createClient } from '@/lib/supabase/server';
import type { CartItem, CartItemWithRental } from '@/types/cart';

const RENTAL_FIELDS = 'id, title, slug, category, brand, price_per_day, price_per_week, deposit_amount, currency, is_available, thumbnail_url';

export async function getCartItems(userId: string): Promise<CartItemWithRental[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('cart_items')
    .select(`*, rental:smart_rentals(${RENTAL_FIELDS})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  return (data ?? []) as unknown as CartItemWithRental[];
}

export async function getCartItemCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return count ?? 0;
}

export async function addToCart(
  userId: string,
  rentalId: string,
  quantity: number = 1,
): Promise<CartItem | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('cart_items')
    .upsert(
      { user_id: userId, rental_id: rentalId, quantity },
      { onConflict: 'user_id,rental_id' },
    )
    .select()
    .single();

  return data as CartItem | null;
}

export async function removeFromCart(userId: string, itemId: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('user_id', userId);

  return !error;
}

export async function updateCartQuantity(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<CartItem | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('id', itemId)
    .eq('user_id', userId)
    .select()
    .single();

  return data as CartItem | null;
}

export async function clearCart(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from('cart_items').delete().eq('user_id', userId);
}
