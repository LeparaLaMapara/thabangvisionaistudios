import { describe, it, expect } from 'vitest';
import { STUDIO } from '@/lib/constants';
import {
  bellPushKey,
  blockReason,
  capReason,
  dedupeKey,
  nudgeDue,
  planFor,
  profileComplete,
  stillDue,
  stopPoint,
  tailoredDue,
  welcomeDue,
} from '@/lib/engagement/rules';
import type { HistoryRow, PersonFacts } from '@/lib/engagement/types';

const NOW = new Date('2026-10-13T08:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const UID = '11111111-1111-4111-8111-111111111111';

function person(over: Partial<PersonFacts> = {}): PersonFacts {
  return {
    userId: UID,
    email: 'lerato.m@gmail.com',
    emailConfirmed: true,
    createdAt: ago(2),
    firstName: 'Lerato',
    intent: null,
    suspended: false,
    optedOut: false,
    marketingOptIn: false,
    verification: 'none',
    verificationDecidedAt: null,
    onboarding: null,
    onboardingCompletedAt: null,
    cart: { items: 0, newestAt: null },
    draftListings: { count: 0, latestAt: null },
    publishedListings: 0,
    bookingsAsClient: 0,
    welcome: null,
    hasPush: false,
    ...over,
  };
}

function sent(key: string, daysAgo: number, over: Partial<HistoryRow> = {}): HistoryRow {
  const at = ago(daysAgo);
  return { dedupeKey: key, kind: key.split(':')[0], channel: 'email', status: 'sent', createdAt: at, sentAt: at, ...over };
}

describe('dedupe keys', () => {
  it('one fixed key per person per step', () => {
    expect(dedupeKey('welcome', UID)).toBe(`engage_welcome:${UID}`);
    expect(dedupeKey('tailored', UID)).toBe(`engage_tailored:${UID}`);
    expect(dedupeKey('nudge', UID, { reason: 'cart', nudge: 1 })).toBe(`engage_nudge:cart:1:${UID}`);
    expect(dedupeKey('nudge', UID, { reason: 'cart', nudge: 2, channel: 'push' })).toBe(`engage_nudge:cart:2:${UID}:push`);
    expect(bellPushKey('abc')).toBe('engage_push:notification:abc');
  });
  it('the key of a nudge differs by reason and by which nudge', () => {
    const keys = new Set([
      dedupeKey('nudge', UID, { reason: 'cart', nudge: 1 }),
      dedupeKey('nudge', UID, { reason: 'cart', nudge: 2 }),
      dedupeKey('nudge', UID, { reason: 'onboarding_step_2', nudge: 1 }),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe('who is never emailed', () => {
  it('suspended, opted out, unconfirmed, internal or test accounts, no address', () => {
    expect(blockReason(person({ suspended: true }))).toBe('suspended');
    expect(blockReason(person({ optedOut: true }))).toBe('opted_out');
    expect(blockReason(person({ emailConfirmed: false }))).toBe('unconfirmed');
    expect(blockReason(person({ email: 'hello@thabangvision.com' }))).toBe('internal');
    expect(blockReason(person({ email: 'test123@gmail.com' }))).toBe('internal');
    expect(blockReason(person({ email: null }))).toBe('no_email');
    expect(blockReason(person())).toBeNull();
  });
  it('a blocked person gets an empty plan with the reason', () => {
    const plan = planFor(person({ optedOut: true, welcome: { status: 'draft' } }), [], NOW);
    expect(plan.messages).toEqual([]);
    expect(plan.held).toBe('opted_out');
  });
});

describe('caps: at most 1 a day and 3 a week', () => {
  it('one sent in the last 24 hours blocks another', () => {
    expect(capReason([sent('engage_welcome:x', 0.5)], NOW)).toBe('daily_cap');
    expect(capReason([sent('engage_welcome:x', 1.5)], NOW)).toBeNull();
  });
  it('three in the week block a fourth', () => {
    const h = [sent('engage_welcome:x', 6), sent('engage_nudge:cart:1:x', 4), sent('engage_nudge:cart:2:x', 2)];
    expect(STUDIO.engagement.maxEmailsPerWeek).toBe(3);
    expect(capReason(h, NOW)).toBe('weekly_cap');
    expect(capReason(h.slice(1), NOW)).toBeNull();
  });
  it('pushes, skipped rows and other kinds do not count', () => {
    const h = [
      sent('engage_nudge:cart:1:x:push', 0.1, { channel: 'push' }),
      sent('engage_push:notification:1', 0.1, { channel: 'push', kind: 'engage_push' }),
      sent('engage_tailored:x', 0.1, { status: 'skipped' }),
      sent('booking_confirmed:x', 0.1, { kind: 'booking_confirmed' }),
    ];
    expect(capReason(h, NOW)).toBeNull();
  });
  it('the row being sent is not counted against itself', () => {
    const own = sent('engage_welcome:x', 0, { status: 'sending', sentAt: null });
    expect(capReason([own], NOW, 'engage_welcome:x')).toBeNull();
    expect(capReason([own], NOW)).toBe('daily_cap');
  });
});

describe('stage: welcome', () => {
  it('sends a waiting draft to someone who joined recently', () => {
    expect(STUDIO.welcomes.autoSendAfterHours).toBe(0);
    expect(welcomeDue(person({ welcome: { status: 'draft' } }), NOW)).toBe(true);
  });
  it('never a welcome weeks late, never twice, never a discarded one', () => {
    expect(welcomeDue(person({ welcome: { status: 'draft' }, createdAt: ago(STUDIO.welcomes.autoSendMaxAgeDays + 1) }), NOW)).toBe(false);
    expect(welcomeDue(person({ welcome: { status: 'sent' } }), NOW)).toBe(false);
    expect(welcomeDue(person({ welcome: { status: 'discarded' } }), NOW)).toBe(false);
    const plan = planFor(person({ welcome: { status: 'draft' } }), [sent(dedupeKey('welcome', UID), 3, { status: 'skipped' })], NOW);
    expect(plan.messages.find((m) => m.data.stage === 'welcome')).toBeUndefined();
  });
  it('welcome comes before anything else', () => {
    const plan = planFor(person({ welcome: { status: 'draft' }, cart: { items: 2, newestAt: ago(1.5) } }), [], NOW);
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({ kind: 'engage_welcome', channel: 'email', dedupeKey: `engage_welcome:${UID}` });
  });
});

describe('stage: where they stopped', () => {
  it('a cart left for a day', () => {
    expect(stopPoint(person({ cart: { items: 1, newestAt: ago(1.2) } }), NOW)?.reason).toBe('cart');
    expect(stopPoint(person({ cart: { items: 1, newestAt: ago(0.5) } }), NOW)).toBeNull();
  });
  it('a gear listing never sent', () => {
    expect(stopPoint(person({ draftListings: { count: 1, latestAt: ago(2) } }), NOW)?.reason).toBe('listing_draft');
  });
  it('creator setup: names the next step after the last one finished', () => {
    const at = (finished: number) =>
      stopPoint(person({ intent: 'supply', onboarding: { finishedStep: finished, updatedAt: ago(2), completedAt: null } }), NOW)?.reason;
    expect(at(0)).toBe('onboarding_step_1');
    expect(at(1)).toBe('onboarding_step_2');
    expect(at(2)).toBe('onboarding_step_3');
    expect(at(3)).toBe('onboarding_step_4');
    expect(stopPoint(person({ intent: 'supply' }), NOW)?.reason).toBe('onboarding_step_1');
  });
  it('ID check rejected, or never started after setting up', () => {
    expect(stopPoint(person({ verification: 'rejected', verificationDecidedAt: ago(1) }), NOW)?.reason).toBe('id_rejected');
    expect(stopPoint(person({ onboardingCompletedAt: ago(2) }), NOW)?.reason).toBe('id_not_started');
    expect(stopPoint(person({ verification: 'pending', onboardingCompletedAt: ago(2) }), NOW)).toBeNull();
  });
  it('chose what they came for, did nothing', () => {
    expect(stopPoint(person({ intent: 'rent' }), NOW)?.reason).toBe('intent_only');
    expect(stopPoint(person({ intent: 'hire' }), NOW)?.reason).toBe('intent_only');
  });
  it('just looking, or no answer: no nudge', () => {
    expect(stopPoint(person({ intent: 'browse' }), NOW)).toBeNull();
    expect(stopPoint(person({ intent: null }), NOW)).toBeNull();
  });
});

describe('nudges: day 1 and day 3, then stop', () => {
  const rent = (over: Partial<PersonFacts> = {}) => person({ intent: 'rent', ...over });
  const k1 = dedupeKey('nudge', UID, { reason: 'intent_only', nudge: 1 });
  const k2 = dedupeKey('nudge', UID, { reason: 'intent_only', nudge: 2 });

  it('nothing before a day has passed', () => {
    expect(nudgeDue(rent({ createdAt: ago(0.5) }), [], NOW)).toBeNull();
  });
  it('first nudge after a day', () => {
    expect(nudgeDue(rent({ createdAt: ago(1.1) }), [], NOW)).toEqual({ reason: 'intent_only', nudge: 1 });
  });
  it('second nudge on day 3, at least two days after the first', () => {
    expect(nudgeDue(rent({ createdAt: ago(3.1) }), [sent(k1, 2.05)], NOW)).toEqual({ reason: 'intent_only', nudge: 2 });
    expect(nudgeDue(rent({ createdAt: ago(3.1) }), [sent(k1, 1)], NOW)).toBeNull();
  });
  it('then stop', () => {
    expect(nudgeDue(rent({ createdAt: ago(9) }), [sent(k1, 8), sent(k2, 6)], NOW)).toBeNull();
  });
  it('no first nudge for someone who stopped long ago', () => {
    expect(nudgeDue(rent({ createdAt: ago(STUDIO.engagement.nudgeLookbackDays + 1) }), [], NOW)).toBeNull();
  });
  it('a nudge carries a push copy only for people with push on', () => {
    const withPush = planFor(rent({ createdAt: ago(1.5), hasPush: true }), [], NOW);
    expect(withPush.messages.map((m) => m.channel)).toEqual(['email', 'push']);
    expect(withPush.messages[1].dedupeKey).toBe(`${k1}:push`);
    expect(planFor(rent({ createdAt: ago(1.5) }), [], NOW).messages.map((m) => m.channel)).toEqual(['email']);
  });
});

describe('stage: tailored (marketing)', () => {
  const complete = (over: Partial<PersonFacts> = {}) => person({ onboardingCompletedAt: ago(5), verification: 'verified', ...over });
  it('needs a complete profile AND marketing consent', () => {
    expect(profileComplete(complete())).toBe(true);
    expect(tailoredDue(complete({ marketingOptIn: false }), [])).toBe(false);
    expect(tailoredDue(complete({ marketingOptIn: true }), [])).toBe(true);
    expect(tailoredDue(person({ marketingOptIn: true }), [])).toBe(false);
  });
  it('once ever', () => {
    expect(tailoredDue(complete({ marketingOptIn: true }), [sent(dedupeKey('tailored', UID), 30)])).toBe(false);
  });
  it('planned when nothing else is due', () => {
    const plan = planFor(complete({ marketingOptIn: true }), [], NOW);
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({ kind: 'engage_tailored', data: { stage: 'tailored' } });
  });
  it('nothing due: held with a reason', () => {
    expect(planFor(complete(), [], NOW)).toEqual({ messages: [], held: 'nothing_due' });
  });
});

describe('re-check at send time', () => {
  const msg = (stage: string, extra: Record<string, unknown> = {}, channel = 'email') => ({
    dedupeKey: `k-${stage}`,
    channel,
    data: { stage, ...extra },
  });
  it('a nudge whose reason no longer holds is not sent', () => {
    const p = person({ cart: { items: 0, newestAt: null } });
    expect(stillDue(msg('nudge', { reason: 'cart' }), p, [], NOW)).toEqual({ ok: false, why: 'no longer applies' });
    expect(stillDue(msg('nudge', { reason: 'cart' }), person({ cart: { items: 1, newestAt: ago(2) } }), [], NOW)).toEqual({ ok: true });
  });
  it('marketing consent withdrawn after queueing: not sent', () => {
    const p = person({ onboardingCompletedAt: ago(3), marketingOptIn: false });
    expect(stillDue(msg('tailored'), p, [], NOW)).toEqual({ ok: false, why: 'no marketing consent' });
  });
  it('opted out after queueing: no email, push still allowed', () => {
    const p = person({ optedOut: true, cart: { items: 1, newestAt: ago(2) } });
    expect(stillDue(msg('nudge', { reason: 'cart' }), p, [], NOW)).toEqual({ ok: false, why: 'opted_out' });
    expect(stillDue(msg('nudge', { reason: 'cart' }, 'push'), p, [], NOW)).toEqual({ ok: true });
  });
  it('a welcome the owner already sent by hand is not sent again', () => {
    expect(stillDue(msg('welcome'), person({ welcome: { status: 'sent' } }), [], NOW)).toEqual({ ok: false, why: 'welcome already handled' });
  });
  it('caps are checked again, without counting the row itself', () => {
    const p = person({ welcome: { status: 'draft' } });
    expect(stillDue(msg('welcome'), p, [sent('k-welcome', 0, { status: 'sending' })], NOW)).toEqual({ ok: true });
    expect(stillDue(msg('welcome'), p, [sent('engage_nudge:cart:1:x', 0.2)], NOW)).toEqual({ ok: false, why: 'daily_cap' });
  });
});
