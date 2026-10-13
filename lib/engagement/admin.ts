import type { createAdminClient } from '@/lib/supabase/server';
import { ONBOARDING_STEP_NAMES } from './templates';
import type { MessageData } from './types';

/** The admin log of lifecycle emails and pushes (/admin/engagement). */

type Admin = ReturnType<typeof createAdminClient>;

export interface EngagementLogRow {
  id: string;
  person: string;
  what: string;
  channel: string;
  status: string;
  subject: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
}

export interface EngagementSummary {
  /** Last 7 days, by status. */
  week: Record<string, number>;
  sentToday: number;
  waiting: number;
  failed: number;
}

const REASON_WORDS: Record<string, string> = {
  cart: 'left gear in the cart',
  listing_draft: 'gear listing not sent',
  id_rejected: 'ID check needs another try',
  id_not_started: 'ID check not started',
  intent_only: 'joined, did nothing yet',
};

/** One plain line: what the message was about. */
export function describeMessage(kind: string, data: MessageData | null): string {
  if (kind === 'engage_welcome') return 'Welcome';
  if (kind === 'engage_tailored') return 'Tailored next steps (AI)';
  if (kind === 'engage_push') return 'Push of a notification';
  if (kind === 'engage_nudge') {
    const r = data?.reason ?? '';
    const which = data?.nudge === 2 ? 'second reminder' : 'first reminder';
    if (r.startsWith('onboarding_step_')) {
      const step = Number(r.slice(-1)) as 1 | 2 | 3 | 4;
      return `Finish signup: creator setup step ${step} (${ONBOARDING_STEP_NAMES[step]?.name ?? '?'}), ${which}`;
    }
    return `Finish signup: ${REASON_WORDS[r] ?? r}, ${which}`;
  }
  return kind;
}

export function summarise(rows: { status: string; created_at: string; sent_at: string | null }[], now: Date): EngagementSummary {
  const week: Record<string, number> = {};
  let sentToday = 0;
  let waiting = 0;
  let failed = 0;
  for (const r of rows) {
    if (now.getTime() - new Date(r.created_at).getTime() <= 7 * 86_400_000) week[r.status] = (week[r.status] ?? 0) + 1;
    if (r.status === 'sent' && r.sent_at && now.getTime() - new Date(r.sent_at).getTime() <= 86_400_000) sentToday++;
    if (r.status === 'pending' || r.status === 'sending') waiting++;
    if (r.status === 'failed' || r.status === 'dead') failed++;
  }
  return { week, sentToday, waiting, failed };
}

/** The latest rows (newest first) plus a summary. Null when 087 is not on this database. */
export async function loadEngagementLog(admin: Admin, limit = 200, now: Date = new Date()): Promise<{ rows: EngagementLogRow[]; summary: EngagementSummary } | null> {
  const { data, error } = await admin
    .from('notification_outbox')
    .select('id, kind, channel, user_id, data, status, attempts, last_error, created_at, sent_at')
    .like('kind', 'engage_%')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[engagement] log unavailable:', error.message);
    return null;
  }
  const raw = (data ?? []) as {
    id: string; kind: string; channel: string; user_id: string; data: MessageData | null; status: string;
    attempts: number; last_error: string | null; created_at: string; sent_at: string | null;
  }[];

  const ids = [...new Set(raw.map((r) => r.user_id))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: people } = await admin.from('profiles').select('id, first_name, display_name').in('id', ids.slice(i, i + 150));
    for (const p of (people ?? []) as { id: string; first_name: string | null; display_name: string | null }[]) {
      names.set(p.id, p.first_name || p.display_name || 'Someone');
    }
  }

  return {
    rows: raw.map((r) => ({
      id: r.id,
      person: names.get(r.user_id) ?? 'Someone',
      what: describeMessage(r.kind, r.data),
      channel: r.channel,
      status: r.status,
      subject: r.data?.subject ?? null,
      error: r.last_error,
      attempts: r.attempts,
      createdAt: r.created_at,
      sentAt: r.sent_at,
    })),
    summary: summarise(raw, now),
  };
}
