import { describe, it, expect } from 'vitest';
import {
  answerByAt,
  answerWindowPassed,
  canCheckIn,
  hoursLeftToAnswer,
  needsAnswerReminder,
} from '@/lib/bookings/answer-by';
import {
  answerReminderEmail,
  formatRand,
  newPaidJobEmail,
  newPaidJobNoticeBody,
} from '@/lib/bookings/creator-job-emails';
import { pastGigReason, splitCreatorGigs } from '@/lib/bookings/creator-gigs';
import { shootTimeline } from '@/lib/bookings/timeline';
import { STUDIO } from '@/lib/constants';

const H = 60 * 60 * 1000;

describe('answer-by deadline', () => {
  const paidAt = '2026-10-10T10:00:00.000Z';

  it('is the answer window after PAYMENT, not after the booking was made', () => {
    const b = { created_at: '2026-10-08T10:00:00.000Z', paid_at: paidAt };
    expect(answerByAt(b).toISOString()).toBe(new Date(Date.parse(paidAt) + STUDIO.booking.creatorAnswerHours * H).toISOString());
  });

  it('falls back to created_at for a row without paid_at', () => {
    const b = { created_at: paidAt, paid_at: null };
    expect(answerByAt(b).getTime()).toBe(Date.parse(paidAt) + STUDIO.booking.creatorAnswerHours * H);
  });

  it('a booking made days ago but paid an hour ago is not taken away', () => {
    const now = new Date(Date.parse(paidAt) + 1 * H);
    expect(answerWindowPassed({ created_at: '2026-10-07T10:00:00.000Z', paid_at: paidAt }, now)).toBe(false);
    expect(hoursLeftToAnswer({ created_at: paidAt, paid_at: paidAt }, now)).toBe(STUDIO.booking.creatorAnswerHours - 1);
  });

  it('reminds on exactly the last daily run before the deadline', () => {
    const b = { created_at: paidAt, paid_at: paidAt };
    const runs = [0, 1, 2, 3].map((d) => new Date(Date.parse(paidAt) + 5 * H + d * 24 * H));
    expect(runs.map((r) => needsAnswerReminder(b, r))).toEqual([false, true, false, false]);
    expect(answerWindowPassed(b, runs[2])).toBe(true);
  });
});

describe('"I\'m here" waits for the shoot day', () => {
  it('not before the booked day (SAST), yes on it, yes with no date', () => {
    expect(canCheckIn('2026-10-18', new Date('2026-10-17T21:59:00Z'))).toBe(false);
    expect(canCheckIn('2026-10-18', new Date('2026-10-17T22:00:00Z'))).toBe(true);
    expect(canCheckIn(null, new Date())).toBe(true);
  });
});

describe('new job alert and emails quote the creator earnings', () => {
  const job = {
    reference: 'BK-1', project_category: 'Portrait Photography', creator_amount: 2550, duration_hours: 3,
    shoot_date: '2026-10-18', location: 'Soweto', created_at: '2026-10-10T08:00:00Z', paid_at: '2026-10-10T10:00:00Z',
  };

  it('in-app alert: earnings and the answer-by time, never the client total', () => {
    const body = newPaidJobNoticeBody(job);
    expect(body).toContain(formatRand(2550));
    expect(body).not.toContain('3450');
    expect(body).toMatch(/Accept or decline by/);
  });

  it('email: earnings, shoot date, deadline and a link', () => {
    const mail = newPaidJobEmail(job, 'https://example.test');
    expect(mail.subject).toContain(formatRand(2550));
    expect(mail.text).toContain('You earn: R2');
    expect(mail.text).toMatch(/Shoot date: Sunday,? 18 October 2026/);
    expect(mail.text).toMatch(/accept or decline by/i);
    expect(mail.text).toContain('https://example.test/dashboard/gigs');
    expect(`${mail.subject}${mail.text}`).not.toMatch(/[\u2014\u2013]/);
  });

  it('reminder email: the deadline and a link', () => {
    const mail = answerReminderEmail(job, 'https://example.test');
    expect(mail.subject).toMatch(/^Reminder: answer your paid job by/);
    expect(mail.text).toContain('https://example.test/dashboard/gigs');
  });

  it('formatRand rounds whole rands', () => {
    expect(formatRand(2550.4)).toBe(`R${(2550).toLocaleString('en-ZA')}`);
    expect(formatRand(null)).toBe('R0');
  });
});

describe('gig groups: nothing vanishes', () => {
  it('cancelled and declined jobs go to Past', () => {
    const g = splitCreatorGigs([
      { status: 'paid' }, { status: 'accepted' }, { status: 'completed' }, { status: 'cancelled' }, { status: 'declined' },
    ]);
    expect(g.actionable).toHaveLength(1);
    expect(g.active).toHaveLength(1);
    expect(g.completed).toHaveLength(1);
    expect(g.past.map((x) => x.status)).toEqual(['cancelled', 'declined']);
  });

  it('says why a past job ended, including a pre-073 decline stored as a cancellation', () => {
    expect(pastGigReason({ status: 'declined', decline_reason: 'Away that weekend' })).toBe('You declined it: Away that weekend. The client was refunded.');
    expect(pastGigReason({ status: 'cancelled', cancellation_reason: 'Declined by creator: Sick' })).toBe('You declined it: Sick. The client was refunded.');
    expect(pastGigReason({ status: 'cancelled', cancellation_reason: 'Client cancelled' })).toBe('Cancelled: Client cancelled');
  });
});

describe('timeline: "All done" only once the payout is sent', () => {
  const approved = {
    status: 'completed', created_at: '2026-10-01T08:00:00Z', payment_status: 'paid', paid_at: 'a', accepted_at: 'b',
    arrived_at: 'c', delivered_at: 'd', completed_at: 'e', payout_status: 'pending', client_rating: 5,
  };
  it('a reviewed job with the payout pending keeps "Creator paid" as the current step', () => {
    const steps = shootTimeline(approved, 'creator');
    expect(steps.find((s) => s.key === 'payout')?.state).toBe('current');
    expect(steps.find((s) => s.key === 'review')?.state).toBe('done');
  });
  it('done once paid', () => {
    const steps = shootTimeline({ ...approved, payout_status: 'paid' }, 'creator');
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });
  it('a declined job stops', () => {
    const steps = shootTimeline({ status: 'declined', created_at: '2026-10-01T08:00:00Z', payment_status: 'paid' }, 'creator');
    expect(steps.find((s) => s.key === 'confirmed')?.state).toBe('stopped');
  });
});
