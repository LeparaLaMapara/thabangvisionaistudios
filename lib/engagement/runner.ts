import { createAdminClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { dispatchEngagement, type DispatchResult } from './dispatch';
import { getAuthUsers, listAuthUsers, loadFacts, loadTailoredProfile } from './load';
import { planFor } from './rules';
import { isDryRun, renderLifecycle } from './send';
import { draftTailored } from './tailored';
import { contentFromText, nudgeContent, type EmailContent } from './templates';
import type { PlannedMessage, Stage } from './types';

/**
 * The daily lifecycle run: finds who is at which stage, queues one message
 * per person per step through notification_outbox (fixed dedupe keys, so a
 * step is never queued twice), then delivers what is due.
 *
 * Called once a day from /api/cron/daily-maintenance, and for one person
 * right after signup or email confirmation (welcome only).
 *
 * ENGAGEMENT_DRY_RUN=true: nothing is queued or sent; the result says what
 * would be, with one rendered example per stage.
 */

export interface RunResult {
  people: number;
  queued: number;
  planned: Record<string, number>;
  held: Record<string, number>;
  dispatched?: DispatchResult;
  dryRun: boolean;
  /** Dry run only: one example per stage, rendered (no address). */
  samples?: { stage: string; reason?: string; subject: string; text: string; draftedBy?: string }[];
}

function bump(tally: Record<string, number>, key: string): void {
  tally[key] = (tally[key] ?? 0) + 1;
}

function labelOf(m: PlannedMessage): string {
  return m.data.stage === 'nudge' ? `nudge:${m.data.reason}:${m.data.nudge}${m.channel === 'push' ? ':push' : ''}` : `${m.data.stage}${m.channel === 'push' ? ':push' : ''}`;
}

export async function runLifecycle(opts: { now?: Date; dryRun?: boolean; userIds?: string[]; stages?: Stage[] } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? isDryRun();
  const admin = createAdminClient();

  const users = opts.userIds ? await getAuthUsers(admin, opts.userIds) : await listAuthUsers(admin);
  const { facts, history } = await loadFacts(admin, users);

  const planned: Record<string, number> = {};
  const held: Record<string, number> = {};
  const queue: PlannedMessage[] = [];
  let tailoredLeft = STUDIO.engagement.tailoredPerRun;

  for (const person of facts.values()) {
    const plan = planFor(person, history.get(person.userId) ?? [], now);
    const messages = plan.messages.filter((m) => !opts.stages || opts.stages.includes(m.data.stage));
    if (messages.length === 0) {
      bump(held, plan.held ?? 'other_stage');
      continue;
    }
    if (messages[0].data.stage === 'tailored') {
      // The AI writes these: a fixed number per run, the rest wait a day.
      if (tailoredLeft <= 0) {
        bump(held, 'tailored_next_run');
        continue;
      }
      tailoredLeft--;
    }
    for (const m of messages) {
      bump(planned, labelOf(m));
      queue.push(m);
    }
  }

  if (dryRun) {
    return { people: facts.size, queued: 0, planned, held, dryRun, samples: await previewSamples(admin, queue, facts) };
  }

  let queued = 0;
  for (let i = 0; i < queue.length; i += 200) {
    const notices = queue.slice(i, i + 200).map((m) => ({ dedupeKey: m.dedupeKey, kind: m.kind, channel: m.channel, userId: m.userId, data: m.data }));
    const { data, error } = await admin.rpc('outbox_enqueue', { p_notices: notices });
    if (error) throw new Error(`outbox_enqueue failed: ${error.message}`);
    queued += Number(data ?? 0);
  }

  const dispatched = await dispatchEngagement({ now, dryRun: false });
  return { people: facts.size, queued, planned, held, dispatched, dryRun };
}

/** One rendered example per stage, for the dry run. The AI really writes the tailored one. */
async function previewSamples(
  admin: ReturnType<typeof createAdminClient>,
  queue: PlannedMessage[],
  facts: Awaited<ReturnType<typeof loadFacts>>['facts'],
): Promise<NonNullable<RunResult['samples']>> {
  const out: NonNullable<RunResult['samples']> = [];
  const seen = new Set<string>();
  for (const m of queue) {
    if (m.channel !== 'email') continue;
    const key = m.data.stage === 'nudge' ? `nudge:${m.data.reason}` : m.data.stage;
    if (seen.has(key)) continue;
    seen.add(key);
    const person = facts.get(m.userId)!;
    let content: EmailContent | null = null;
    let draftedBy: string | undefined;
    if (m.data.stage === 'welcome') {
      const { data } = await admin.from('welcome_messages').select('subject, body').eq('user_id', m.userId).maybeSingle();
      if (data) content = contentFromText(data.subject, data.body);
    } else if (m.data.stage === 'nudge' && m.data.reason) {
      content = nudgeContent({ reason: m.data.reason, nudge: m.data.nudge ?? 1, firstName: person.firstName, intent: person.intent, cartItems: person.cart.items });
    } else if (m.data.stage === 'tailored') {
      const d = await draftTailored(await loadTailoredProfile(admin, person));
      content = d.content;
      draftedBy = d.draftedBy;
    }
    if (!content) continue;
    const r = renderLifecycle(m.userId, content, m.data.stage === 'tailored' ? 'marketing' : 'service');
    out.push({ stage: m.data.stage, reason: m.data.reason, subject: r.subject, text: r.text, draftedBy });
  }
  return out;
}

/**
 * Right after signup or email confirmation: queue and send this person's
 * welcome now, if it is due. Never throws.
 */
export async function sendWelcomeSoon(userId: string): Promise<void> {
  if (STUDIO.welcomes.autoSendAfterHours !== 0) return;
  try {
    await runLifecycle({ userIds: [userId], stages: ['welcome'] });
  } catch (err) {
    console.error('[engagement] immediate welcome failed:', err instanceof Error ? err.message : err);
  }
}
