import type { createAdminClient } from '@/lib/supabase/server';
import { sendPush, type PushPayload } from '@/lib/push';
import { MAX_SUBSCRIPTIONS_PER_USER } from '@/lib/push/subscriptions';

type Admin = ReturnType<typeof createAdminClient>;

/** A browser that fails this many pushes in a row is removed. */
export const PUSH_MAX_FAILURES = 3;

/**
 * Sends one push to every browser the person turned on, all at once (each
 * send has its own short timeout), so one person's slow browsers cannot hold
 * up the queue. Deletes subscriptions the browser dropped, and ones that keep
 * failing.
 */
export async function pushToUser(admin: Admin, userId: string, payload: PushPayload): Promise<{ sent: number; gone: number; error?: string }> {
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_SUBSCRIPTIONS_PER_USER);
  const list = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number | null }[];
  const results = await Promise.all(list.map((s) => sendPush(s, payload)));
  let sent = 0;
  let gone = 0;
  let error: string | undefined;
  await Promise.all(
    list.map(async (s, i) => {
      const r = results[i];
      if (r.ok) {
        sent++;
        await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', s.id);
        return;
      }
      const failures = (s.failure_count ?? 0) + 1;
      if (r.gone || failures >= PUSH_MAX_FAILURES) {
        gone++;
        await admin.from('push_subscriptions').delete().eq('id', s.id);
        return;
      }
      error = r.message;
      await admin.from('push_subscriptions').update({ failure_count: failures }).eq('id', s.id);
    }),
  );
  return { sent, gone, error };
}
