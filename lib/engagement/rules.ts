import { STUDIO } from '@/lib/constants';
import { isInternalAccount } from '@/lib/greetings/welcome';
import { resumeStep } from '@/lib/onboarding/progress';
import {
  STAGE_KIND,
  type BlockReason,
  type HistoryRow,
  type NudgeReason,
  type PersonFacts,
  type Plan,
  type PlannedMessage,
  type Stage,
} from './types';

/**
 * The lifecycle rules. Pure: no database, no clock of their own, no email, so
 * every rule is tested directly (tests/unit/engagement-rules.test.ts).
 *
 * One email per person per run, at most STUDIO.engagement.maxEmailsPerDay a
 * day and maxEmailsPerWeek a week. Welcome first, then a nudge, then the
 * tailored note. Each step has a fixed dedupe key, so it is queued once ever.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

// ─── Dedupe keys ─────────────────────────────────────────────────────────────

export function dedupeKey(stage: Stage, userId: string, opts: { reason?: NudgeReason; nudge?: number; channel?: 'email' | 'push' } = {}): string {
  const base =
    stage === 'nudge'
      ? `${STAGE_KIND.nudge}:${opts.reason}:${opts.nudge}:${userId}`
      : `${STAGE_KIND[stage]}:${userId}`;
  return opts.channel === 'push' ? `${base}:push` : base;
}

/** The dedupe key for the push copy of a bell item (set by the 087 trigger). */
export function bellPushKey(notificationId: string): string {
  return `engage_push:notification:${notificationId}`;
}

// ─── Who may be emailed at all ───────────────────────────────────────────────

export function blockReason(p: PersonFacts): BlockReason | null {
  if (!p.email) return 'no_email';
  if (isInternalAccount(p.email)) return 'internal';
  if (p.suspended) return 'suspended';
  if (p.optedOut) return 'opted_out';
  if (!p.emailConfirmed) return 'unconfirmed';
  return null;
}

/** Statuses that count against the caps: queued, in flight, sent or retrying. */
const COUNTED = new Set(['pending', 'sending', 'sent', 'failed']);

/** Lifecycle emails that count towards the caps. Pushes never count. */
function countedEmails(history: HistoryRow[], excludeKey?: string): HistoryRow[] {
  return history.filter(
    (h) => h.channel === 'email' && h.kind.startsWith('engage_') && h.kind !== 'engage_push' && COUNTED.has(h.status) && h.dedupeKey !== excludeKey,
  );
}

export function capReason(history: HistoryRow[], now: Date, excludeKey?: string): 'daily_cap' | 'weekly_cap' | null {
  const emails = countedEmails(history, excludeKey);
  const at = (h: HistoryRow) => ms(h.sentAt) ?? ms(h.createdAt) ?? 0;
  const day = emails.filter((h) => now.getTime() - at(h) < DAY).length;
  if (day >= STUDIO.engagement.maxEmailsPerDay) return 'daily_cap';
  const week = emails.filter((h) => now.getTime() - at(h) < 7 * DAY).length;
  if (week >= STUDIO.engagement.maxEmailsPerWeek) return 'weekly_cap';
  return null;
}

// ─── Stage: welcome ──────────────────────────────────────────────────────────

export function welcomeDue(p: PersonFacts, now: Date): boolean {
  const after = STUDIO.welcomes.autoSendAfterHours;
  if (after === null || after < 0) return false;
  if (p.welcome?.status !== 'draft') return false;
  const joined = ms(p.createdAt);
  if (joined === null) return false;
  const age = now.getTime() - joined;
  return age >= after * HOUR && age <= STUDIO.welcomes.autoSendMaxAgeDays * DAY;
}

// ─── Stage: nudge ────────────────────────────────────────────────────────────

function didNothing(p: PersonFacts): boolean {
  return (
    p.cart.items === 0 &&
    p.draftListings.count === 0 &&
    p.publishedListings === 0 &&
    p.bookingsAsClient === 0 &&
    p.onboarding === null &&
    !p.onboardingCompletedAt &&
    p.verification === 'none'
  );
}

/**
 * Where this person stopped, and since when. Null: nothing to finish (or they
 * only came to look around, which we respect).
 */
export function stopPoint(p: PersonFacts, now: Date): { reason: NudgeReason; since: string } | null {
  const cartNewest = ms(p.cart.newestAt);
  if (p.cart.items > 0 && cartNewest !== null && now.getTime() - cartNewest >= STUDIO.engagement.cartAfterHours * HOUR) {
    return { reason: 'cart', since: p.cart.newestAt! };
  }

  if (p.draftListings.count > 0) {
    return { reason: 'listing_draft', since: p.draftListings.latestAt ?? p.createdAt };
  }

  const creatorStarted = p.intent === 'supply' || p.onboarding !== null;
  const onboardingDone = Boolean(p.onboardingCompletedAt || p.onboarding?.completedAt);
  if (creatorStarted && !onboardingDone) {
    const step = resumeStep({ current_step: p.onboarding?.finishedStep ?? 0 }) as 1 | 2 | 3 | 4;
    return { reason: `onboarding_step_${step}`, since: p.onboarding?.updatedAt ?? p.createdAt };
  }

  if (p.verification === 'rejected') {
    return { reason: 'id_rejected', since: p.verificationDecidedAt ?? p.createdAt };
  }

  if (p.intent && p.intent !== 'browse' && didNothing(p)) {
    return { reason: 'intent_only', since: p.createdAt };
  }

  // Did something that needs the ID check (finished creator setup, or listed
  // gear), but never started it.
  const needsId = onboardingDone || p.publishedListings > 0 || p.intent === 'rent' || p.intent === 'list';
  if (p.verification === 'none' && needsId && p.bookingsAsClient === 0) {
    return { reason: 'id_not_started', since: p.onboardingCompletedAt ?? p.createdAt };
  }
  return null;
}

/** The nudge due now for where they stopped (1 = first, 2 = last), or null. */
export function nudgeDue(p: PersonFacts, history: HistoryRow[], now: Date): { reason: NudgeReason; nudge: number } | null {
  const stop = stopPoint(p, now);
  if (!stop) return null;
  const since = ms(stop.since);
  if (since === null) return null;
  const age = now.getTime() - since;
  const [firstDay, secondDay] = STUDIO.engagement.nudgeAfterDays;
  const has = (n: number) => history.find((h) => h.dedupeKey === dedupeKey('nudge', p.userId, { reason: stop.reason, nudge: n }));

  const first = has(1);
  if (!first) {
    if (age < firstDay * DAY || age > STUDIO.engagement.nudgeLookbackDays * DAY) return null;
    return { reason: stop.reason, nudge: 1 };
  }
  if (has(2) || secondDay === undefined) return null;
  const firstAt = ms(first.sentAt) ?? ms(first.createdAt) ?? now.getTime();
  if (age >= secondDay * DAY && now.getTime() - firstAt >= (secondDay - firstDay) * DAY) {
    return { reason: stop.reason, nudge: 2 };
  }
  return null;
}

// ─── Stage: tailored ─────────────────────────────────────────────────────────

export function profileComplete(p: PersonFacts): boolean {
  return Boolean(p.onboardingCompletedAt) || p.verification === 'verified';
}

export function tailoredDue(p: PersonFacts, history: HistoryRow[]): boolean {
  if (!profileComplete(p)) return false;
  return !history.some((h) => h.dedupeKey === dedupeKey('tailored', p.userId));
}

// ─── The plan for one person ─────────────────────────────────────────────────

/** What to queue for one person this run: at most one email (plus its push copy). */
export function planFor(p: PersonFacts, history: HistoryRow[], now: Date): Plan {
  const blocked = blockReason(p);
  if (blocked) return { messages: [], held: blocked };
  const cap = capReason(history, now);
  if (cap) return { messages: [], held: cap };

  const done = (key: string) => history.some((h) => h.dedupeKey === key);
  const email = (stage: Stage, extra: Partial<PlannedMessage['data']> = {}): PlannedMessage => ({
    dedupeKey: dedupeKey(stage, p.userId, { reason: extra.reason, nudge: extra.nudge }),
    kind: STAGE_KIND[stage],
    channel: 'email',
    userId: p.userId,
    data: { stage, ...extra },
  });

  if (welcomeDue(p, now) && !done(dedupeKey('welcome', p.userId))) {
    return { messages: [email('welcome')] };
  }

  const nudge = nudgeDue(p, history, now);
  if (nudge) {
    const msg = email('nudge', nudge);
    const messages = [msg];
    if (p.hasPush) {
      messages.push({ ...msg, channel: 'push', dedupeKey: dedupeKey('nudge', p.userId, { ...nudge, channel: 'push' }) });
    }
    return { messages };
  }

  if (tailoredDue(p, history)) return { messages: [email('tailored')] };

  return { messages: [], held: 'nothing_due' };
}

/**
 * Whether a queued message should still go out at send time. Things change
 * between queueing and sending: the cart is emptied, onboarding finished,
 * or they unsubscribe.
 */
export function stillDue(msg: { dedupeKey: string; channel: string; data: { stage?: string; reason?: string; nudge?: number } }, p: PersonFacts, history: HistoryRow[], now: Date): { ok: true } | { ok: false; why: string } {
  if (msg.data.stage === 'push') return { ok: true };
  // The email opt-out covers email; a push is stopped by turning push off.
  const blocked = msg.channel === 'email' ? blockReason(p) : p.suspended ? 'suspended' : null;
  if (blocked) return { ok: false, why: blocked };
  if (msg.channel === 'email') {
    const cap = capReason(history, now, msg.dedupeKey);
    if (cap) return { ok: false, why: cap };
  }
  if (msg.data.stage === 'welcome') {
    return p.welcome?.status === 'draft' ? { ok: true } : { ok: false, why: 'welcome already handled' };
  }
  if (msg.data.stage === 'nudge') {
    const stop = stopPoint(p, now);
    return stop && stop.reason === msg.data.reason ? { ok: true } : { ok: false, why: 'no longer applies' };
  }
  if (msg.data.stage === 'tailored') {
    return profileComplete(p) ? { ok: true } : { ok: false, why: 'profile not complete' };
  }
  return { ok: false, why: 'unknown stage' };
}
