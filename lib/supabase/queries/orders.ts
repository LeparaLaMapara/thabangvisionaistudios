import { createClient } from '@/lib/supabase/server';
import type { Order, OrderStatus, CreateOrderInput } from '@/types/marketplace';

export type { Order, OrderStatus };

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns orders where the user is the buyer, ordered by created_at DESC.
 */
export async function getOrdersByBuyer(userId: string): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getOrdersByBuyer]', error.message);
    return [];
  }

  return (data as Order[]) ?? [];
}

/**
 * Returns orders where the user is the seller, ordered by created_at DESC.
 */
export async function getOrdersBySeller(userId: string): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('seller_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getOrdersBySeller]', error.message);
    return [];
  }

  return (data as Order[]) ?? [];
}

/**
 * Returns a single order by id, or null if not found.
 */
export async function getOrderById(id: string): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getOrderById]', error.message);
    }
    return null;
  }

  return data as Order;
}

/**
 * Returns all orders for a listing (used for admin / seller views).
 */
export async function getOrdersByListing(listingId: string): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getOrdersByListing]', error.message);
    return [];
  }

  return (data as Order[]) ?? [];
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Creates a new order with status 'pending'.
 */
export async function createOrder(input: CreateOrderInput): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .insert({ ...input, status: 'pending' as OrderStatus })
    .select()
    .single();

  if (error) {
    console.error('[createOrder]', error.message);
    return null;
  }

  return data as Order;
}

/**
 * Updates an order's status and optionally sets the PayFast payment ID.
 */
export async function updateOrderStatus(
  orderId: string,
  updates: {
    status: OrderStatus;
    payfast_payment_id?: string;
  },
): Promise<Order | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    console.error('[updateOrderStatus]', error.message);
    return null;
  }

  return data as Order;
}
