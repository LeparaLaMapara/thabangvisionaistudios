export const dynamic = 'force-dynamic';

import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { kickPushDispatch } from '@/lib/engagement/dispatch';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[notifications] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to load notifications.' }, { status: 500 });
  }

  // Crons run once a day, so queued pushes (bell items for people with push
  // on) go out from here: at most once a minute per server, after the reply.
  after(() => kickPushDispatch());

  return NextResponse.json(data ?? []);
}
