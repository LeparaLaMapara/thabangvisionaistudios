export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';

export async function POST() {
  // Subscriptions are switched off (STUDIO.subscriptions.enabled). While off,
  // nothing may create or change one: these routes used to accept a plan and a
  // price from the browser and write the subscription with the user's session.
  if (!STUDIO.subscriptions.enabled) {
    return NextResponse.json({ error: 'Subscriptions are not available.' }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find active subscription
  const { data: sub, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (fetchError || !sub) {
    return NextResponse.json(
      { error: 'No active subscription found.' },
      { status: 404 },
    );
  }

  // Cancel in Supabase — subscription remains active until current_period_end
  const { data: updated, error: updateError } = await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)
    .select()
    .single();

  if (updateError) {
    console.error('[subscriptions/cancel] update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to cancel the subscription.' }, { status: 500 });
  }

  return NextResponse.json(updated);
}
