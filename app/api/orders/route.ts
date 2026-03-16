export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { auth } from '@/lib/auth';

/**
 * GET /api/orders
 * Returns all orders where the authenticated user is either buyer or seller.
 * Joins listing title + thumbnail for display.
 */
export async function GET() {
  const user = await auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select('*, listings(title, thumbnail_url)')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/orders]', error.message);
    return NextResponse.json({ error: 'Failed to load orders.' }, { status: 500 });
  }

  // Flatten the joined listing fields
  const orders = (data ?? []).map((row: Record<string, unknown>) => {
    const listing = row.listings as { title: string; thumbnail_url: string | null } | null;
    return {
      ...row,
      listings: undefined,
      listing_title: listing?.title ?? null,
      listing_thumbnail: listing?.thumbnail_url ?? null,
    };
  });

  return NextResponse.json(orders);
}
