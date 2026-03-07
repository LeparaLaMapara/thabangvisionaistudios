import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role'); // 'buyer' or 'seller'

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (role === 'seller') {
    query = query.eq('seller_id', user.id);
  } else {
    // Default to buyer view
    query = query.eq('buyer_id', user.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
