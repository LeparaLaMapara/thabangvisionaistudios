export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { pushPublicKey } from '@/lib/push';
import { MAX_SUBSCRIPTIONS_PER_USER, mayMoveSubscription, parseEndpoint, parseSubscription } from '@/lib/push/subscriptions';

/**
 * Web push for the signed-in person.
 *   GET    { publicKey } to subscribe with (null when push is not set up)
 *   POST   { endpoint, keys: { p256dh, auth } } saves this browser
 *   DELETE { endpoint } removes this browser
 */

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(): Promise<NextResponse> {
  const { user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ publicKey: pushPublicKey() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await checkRateLimit(`push-subscribe:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!pushPublicKey()) return NextResponse.json({ error: 'Notifications are not set up yet' }, { status: 503 });

  const sub = parseSubscription(await request.json().catch(() => null));
  if (!sub) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });

  try {
    // Service role: one browser has one endpoint, and when a different person
    // signs in on it the row moves to them (RLS would refuse the overwrite).
    // It moves only when the browser sends the same keys: knowing someone's
    // endpoint URL alone must not take their notifications.
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from('push_subscriptions')
      .select('user_id, p256dh, auth')
      .eq('endpoint', sub.endpoint)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing && !mayMoveSubscription(existing, { userId: user.id, p256dh: sub.p256dh, auth: sub.auth })) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    const { error } = await admin
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
          failure_count: 0,
        },
        { onConflict: 'endpoint' },
      );
    if (error) throw new Error(error.message);
    // At most MAX_SUBSCRIPTIONS_PER_USER browsers; the oldest go first.
    // (The 088 trigger does the same in the database.)
    const { data: extra } = await admin
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(MAX_SUBSCRIPTIONS_PER_USER, MAX_SUBSCRIPTIONS_PER_USER + 50);
    if (extra && extra.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', extra.map((r: { id: string }) => r.id));
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[push/subscription] save failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not turn on notifications' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const endpoint = parseEndpoint(await request.json().catch(() => null));
  if (!endpoint) return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
  // As the person: RLS lets them remove only their own.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not turn off notifications' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
