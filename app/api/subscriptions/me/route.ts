export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, subscription_plans(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json(null);
    }
    console.error('[subscriptions/me] Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch subscription.' }, { status: 500 });
  }

  return NextResponse.json(data);
}
