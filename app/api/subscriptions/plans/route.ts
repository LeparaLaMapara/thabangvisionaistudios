export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('price', { ascending: true });

  if (error) {
    console.error('[subscriptions/plans] Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch plans.' }, { status: 500 });
  }

  return NextResponse.json(data);
}
