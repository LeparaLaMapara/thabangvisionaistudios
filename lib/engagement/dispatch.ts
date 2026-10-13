import { createAdminClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { sendWelcome } from '@/lib/greetings/process';
import { isPushConfigured, safePushUrl, sendPush, type PushPayload } from '@/lib/push';
import { getAuthUsers, loadFacts, loadTailoredProfile } from './load';
import { stillDue } from './rules';
import { isDryRun, sendLifecycleEmail } from './send';
import { draftTailored } from './tailored';
import { nudgeContent } from './templates';
import type { MessageData, NudgeReason, PersonFacts, HistoryRow } from './types';

/**
 * Delivers due engagement messages from notification_outbox (kind
 * 'engage_*'). Rows are claimed with SKIP LOCKED by claim_engagement_outbox
 * (087), so two runs never send the same row. Every row ends sent, skipped
 * (with why) or failed (retried, dead after 3 tries).
 */

type Admin = ReturnType<typeof createAdminClient>;

interface OutboxRow {
  id: string;
  dedupe_key: string;
  kind: string;
  channel: string;
  user_id: string;
  data: MessageData | null;
  created_at: string;
}

export interface DispatchResult {
  sent: number;
  skipped: number;
  failed: number;
  pushGone: number;
}

type Outcome = { status: 'sent'; subject?: string } | { status: 'skipped' | 'failed'; why: string };

async function finish(admin: Admin, row: OutboxRow, outcome: Outcome): Promise<void> {
  if (outcome.status === 'sent') {
    await admin
      .from('notification_outbox')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        last_error: null,
        ...(outcome.subject ? { data: { ...(row.data ?? {}), subject: outcome.subject } } : {}),
      })
      .eq('id', row.id);
  } else {
    await admin.from('notification_outbox').update({ status: outcome.status, last_error: outcome.why.slice(0, 300) }).eq('id', row.id);
  }
}

/** Sends one push to every browser the person turned on. Deletes subscriptions the browser dropped. */
export async function pushToUser(admin: Admin, userId: string, payload: PushPayload): Promise<{ sent: number; gone: number; error?: string }> {
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  let sent = 0;
  let gone = 0;
  let error: string | undefined;
  for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const r = await sendPush(s, payload);
    if (r.ok) {
      sent++;
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', s.id);
    } else if (r.gone) {
      gone++;
      await admin.from('push_subscriptions').delete().eq('id', s.id);
    } else {
      error = r.message;
    }
  }
  return { sent, gone, error };
}

async function deliverBellPush(admin: Admin, row: OutboxRow, now: Date, dryRun: boolean): Promise<Outcome & { gone?: number }> {
  const ageHours = (now.getTime() - new Date(row.created_at).getTime()) / 3_600_000;
  if (ageHours > STUDIO.engagement.pushStaleHours) return { status: 'skipped', why: 'too old to push' };
  const id = row.data?.notificationId;
  if (!id) return { status: 'skipped', why: 'no notification id' };
  const { data: n } = await admin.from('notifications').select('title, body, link, is_read, user_id').eq('id', id).maybeSingle();
  if (!n || n.user_id !== row.user_id) return { status: 'skipped', why: 'notification gone' };
  if (n.is_read) return { status: 'skipped', why: 'already read' };
  if (dryRun) return { status: 'skipped', why: 'dry run' };
  const r = await pushToUser(admin, row.user_id, { title: n.title, body: n.body, url: safePushUrl(n.link), tag: `n-${id}` });
  if (r.sent > 0) return { status: 'sent', subject: n.title, gone: r.gone };
  if (r.error) return { status: 'failed', why: r.error, gone: r.gone };
  return { status: 'skipped', why: 'no push subscription', gone: r.gone };
}

async function deliver(
  admin: Admin,
  row: OutboxRow,
  person: PersonFacts | undefined,
  history: HistoryRow[],
  now: Date,
  dryRun: boolean,
): Promise<Outcome & { gone?: number }> {
  const data = row.data ?? ({ stage: 'push' } as MessageData);
  if (row.kind === 'engage_push') return deliverBellPush(admin, row, now, dryRun);
  if (!person) return { status: 'skipped', why: 'account gone' };

  const due = stillDue({ dedupeKey: row.dedupe_key, channel: row.channel, data }, person, history, now);
  if (!due.ok) return { status: 'skipped', why: due.why };

  if (row.channel === 'push') {
    if (data.stage !== 'nudge' || !data.reason) return { status: 'skipped', why: 'push only for nudges' };
    const c = nudgeContent({ reason: data.reason as NudgeReason, nudge: data.nudge ?? 1, firstName: person.firstName, intent: person.intent, cartItems: person.cart.items });
    if (dryRun) return { status: 'skipped', why: 'dry run' };
    const r = await pushToUser(admin, person.userId, { title: c.subject, body: c.preheader, url: c.cta?.href ?? '/dashboard', tag: `nudge-${data.reason}` });
    if (r.sent > 0) return { status: 'sent', subject: c.subject, gone: r.gone };
    return r.error ? { status: 'failed', why: r.error, gone: r.gone } : { status: 'skipped', why: 'no push subscription', gone: r.gone };
  }

  if (!person.email) return { status: 'skipped', why: 'no email' };

  if (data.stage === 'welcome') {
    const r = await sendWelcome(person.userId, null, { dryRun });
    return r.ok ? { status: 'sent', subject: r.subject } : { status: r.error?.startsWith('Not a draft') ? 'skipped' : 'failed', why: r.error ?? 'welcome failed' };
  }

  let content;
  // Every lifecycle stage is a service message (owner, 2026-10-13).
  const why = 'service' as const;
  if (data.stage === 'nudge' && data.reason) {
    content = nudgeContent({ reason: data.reason, nudge: data.nudge ?? 1, firstName: person.firstName, intent: person.intent, cartItems: person.cart.items });
  } else if (data.stage === 'tailored') {
    content = (await draftTailored(await loadTailoredProfile(admin, person))).content;
  } else {
    return { status: 'skipped', why: 'unknown stage' };
  }

  const r = await sendLifecycleEmail({ userId: person.userId, to: person.email, content, why, dryRun });
  return r.ok ? { status: 'sent', subject: r.subject } : { status: r.retryable ? 'failed' : 'skipped', why: r.message };
}

/**
 * Claims and delivers due engagement messages. `channels: ['push']` delivers
 * pushes only (the cheap kick after a page poll; it never drafts emails).
 */
export async function dispatchEngagement(opts: { limit?: number; now?: Date; channels?: ('email' | 'push')[]; dryRun?: boolean } = {}): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, skipped: 0, failed: 0, pushGone: 0 };
  const dryRun = opts.dryRun ?? isDryRun();
  // A dry run never claims: claiming would use up the rows.
  if (dryRun) return result;
  const channels = opts.channels ?? null;
  if (channels && channels.length === 1 && channels[0] === 'push' && !isPushConfigured()) return result;

  const admin = createAdminClient();
  const now = opts.now ?? new Date();
  const { data, error } = await admin.rpc('claim_engagement_outbox', {
    p_limit: opts.limit ?? STUDIO.engagement.dispatchPerRun,
    p_max_attempts: 3,
    p_channels: channels,
  });
  if (error) throw new Error(`claim_engagement_outbox failed: ${error.message}`);
  const claimed = (data ?? []) as OutboxRow[];
  if (claimed.length === 0) return result;

  const userIds = [...new Set(claimed.filter((r) => r.kind !== 'engage_push').map((r) => r.user_id))];
  const { facts, history } = userIds.length ? await loadFacts(admin, await getAuthUsers(admin, userIds)) : { facts: new Map(), history: new Map() };

  for (const row of claimed) {
    let outcome: Outcome & { gone?: number };
    try {
      outcome = await deliver(admin, row, facts.get(row.user_id), history.get(row.user_id) ?? [], now, false);
    } catch (err) {
      outcome = { status: 'failed', why: err instanceof Error ? err.message : 'deliver threw' };
    }
    await finish(admin, row, outcome);
    result.pushGone += outcome.gone ?? 0;
    if (outcome.status === 'sent') {
      result.sent++;
      // The next email for this person in the same run must see this one for the caps.
      if (row.channel === 'email') {
        history.set(row.user_id, [
          ...(history.get(row.user_id) ?? []).filter((h: HistoryRow) => h.dedupeKey !== row.dedupe_key),
          { dedupeKey: row.dedupe_key, kind: row.kind, channel: row.channel, status: 'sent', createdAt: row.created_at, sentAt: now.toISOString() },
        ]);
      }
    } else if (outcome.status === 'skipped') result.skipped++;
    else result.failed++;
  }
  return result;
}

// In-memory throttle for the push kick (per server instance).
let lastKick = 0;

/** Delivers due pushes at most once a minute per instance. Called after a page poll. */
export async function kickPushDispatch(now: number = Date.now()): Promise<void> {
  if (now - lastKick < 60_000 || !isPushConfigured() || isDryRun()) return;
  lastKick = now;
  try {
    await dispatchEngagement({ channels: ['push'], limit: 25 });
  } catch (err) {
    console.error('[engagement] push kick failed:', err instanceof Error ? err.message : err);
  }
}
