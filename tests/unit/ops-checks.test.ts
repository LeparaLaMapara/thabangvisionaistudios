import { describe, it, expect } from 'vitest';
import {
  detectPaidButStuck,
  detectIneffectiveCronArms,
  detectVocabularyDrift,
  detectMismatchRate,
  detectUnnotifiedTransitions,
  detectStaleWritePaths,
  detectMissingRelations,
  type PaidBookingRow,
} from '@/lib/ops/checks';
import { fingerprint } from '@/lib/ops/types';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/**
 * Roughly half of these are NEGATIVE cases: healthy-but-unusual states that
 * must produce no finding. They are the point. A positives-only suite passes
 * happily on a checker that fires constantly, and a checker that never says
 * "nothing to do here" is worse than no checker at all.
 */

describe('detectPaidButStuck', () => {
  const paid = (over: Partial<PaidBookingRow>): PaidBookingRow => ({
    id: 'b1', status: 'pending', paidAt: minsAgo(60), kind: 'equipment', ...over,
  });

  it('fires when an equipment booking is paid but never confirmed', () => {
    const f = detectPaidButStuck([paid({})], NOW);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('critical');
    expect(f[0].entityType).toBe('equipment_booking');
  });

  it('stays quiet inside the grace window', () => {
    expect(detectPaidButStuck([paid({ paidAt: minsAgo(5) })], NOW)).toHaveLength(0);
  });

  it('stays quiet once the equipment booking has advanced', () => {
    for (const status of ['confirmed', 'active', 'completed', 'cancelled', 'disputed']) {
      expect(detectPaidButStuck([paid({ status })], NOW), status).toHaveLength(0);
    }
  });

  it('does not conflate the two booking vocabularies', () => {
    // 'paid' is a terminal-enough state for a service booking but is NOT a
    // valid advanced state for equipment. Conflating them would fire on every
    // healthy service booking in the system.
    expect(detectPaidButStuck([paid({ kind: 'service', status: 'paid' })], NOW)).toHaveLength(0);
    expect(detectPaidButStuck([paid({ kind: 'equipment', status: 'paid' })], NOW)).toHaveLength(1);
  });

  it('ignores an unparseable timestamp rather than firing on it', () => {
    expect(detectPaidButStuck([paid({ paidAt: 'not-a-date' })], NOW)).toHaveLength(0);
  });

  it('is quiet on an empty system', () => {
    expect(detectPaidButStuck([], NOW)).toHaveLength(0);
  });
});

describe('detectIneffectiveCronArms', () => {
  it('fires per arm, not per row', () => {
    const f = detectIneffectiveCronArms([{ arm: 'expire_stale_crew_requests', violations: 400 }]);
    expect(f).toHaveLength(1);
    expect(f[0].observedValue).toBe(400);
    expect(f[0].entityId).toBe('expire_stale_crew_requests');
  });

  it('stays quiet when every arm did its job', () => {
    expect(detectIneffectiveCronArms([
      { arm: 'cancel_unpaid_bookings', violations: 0 },
      { arm: 'auto_approve_delivered', violations: 0 },
    ])).toHaveLength(0);
  });
});

describe('detectVocabularyDrift', () => {
  it('fires once, listing every rejected value', () => {
    const f = detectVocabularyDrift({
      checkId: 'notification-vocabulary',
      entityType: 'notification_type',
      emitted: ['gig_request', 'rental_overdue', 'cart_reminder'],
      allowed: ['gig_request'],
    });
    expect(f).toHaveLength(1);
    expect(f[0].detail?.rejected).toEqual(['cart_reminder', 'rental_overdue']);
  });

  it('stays quiet when the database allows more than the code emits', () => {
    expect(detectVocabularyDrift({
      checkId: 'notification-vocabulary',
      entityType: 'notification_type',
      emitted: ['gig_request'],
      allowed: ['gig_request', 'gig_expired', 'cart_reminder'],
    })).toHaveLength(0);
  });
});

describe('detectMismatchRate', () => {
  it('stays quiet on a single mismatch, which is a customer story', () => {
    expect(detectMismatchRate({ mismatched: 1, touched: 40 })).toHaveLength(0);
  });

  it('fires on a burst, which is a deploy', () => {
    expect(detectMismatchRate({ mismatched: 3, touched: 40 })).toHaveLength(1);
  });

  it('fires on a high proportion even below the count floor', () => {
    expect(detectMismatchRate({ mismatched: 2, touched: 4 })).toHaveLength(1);
  });

  it('does not divide by zero on a quiet hour', () => {
    expect(detectMismatchRate({ mismatched: 0, touched: 0 })).toHaveLength(0);
  });
});

describe('detectUnnotifiedTransitions', () => {
  it('fires when a status changed and nobody was told', () => {
    expect(detectUnnotifiedTransitions(
      [{ entityId: 'e1', userId: 'u1', status: 'overdue', changedAt: hoursAgo(2), notified: false }],
      NOW,
    )).toHaveLength(1);
  });

  it('stays quiet when the notification landed', () => {
    expect(detectUnnotifiedTransitions(
      [{ entityId: 'e1', userId: 'u1', status: 'overdue', changedAt: hoursAgo(2), notified: true }],
      NOW,
    )).toHaveLength(0);
  });

  it('allows time for the notification to be written', () => {
    expect(detectUnnotifiedTransitions(
      [{ entityId: 'e1', userId: 'u1', status: 'overdue', changedAt: minsAgo(2), notified: false }],
      NOW,
    )).toHaveLength(0);
  });
});

describe('detectStaleWritePaths', () => {
  it('fires on a table that has never been written to', () => {
    const f = detectStaleWritePaths([{ table: 'newsletter_subscribers', lastWrite: null, maxAgeHours: 720 }], NOW);
    expect(f).toHaveLength(1);
    expect(f[0].title).toContain('never');
  });

  it('fires when writes went quiet', () => {
    expect(detectStaleWritePaths(
      [{ table: 'newsletter_subscribers', lastWrite: hoursAgo(800), maxAgeHours: 720 }], NOW,
    )).toHaveLength(1);
  });

  it('stays quiet on a recently written table', () => {
    expect(detectStaleWritePaths(
      [{ table: 'bookings', lastWrite: hoursAgo(1), maxAgeHours: 720 }], NOW,
    )).toHaveLength(0);
  });
});

describe('detectMissingRelations', () => {
  it('fires for each relation the code needs but the database lacks', () => {
    const f = detectMissingRelations({
      required: ['bookings', 'newsletter_subscribers', 'press_articles'],
      present: ['bookings'],
    });
    expect(f.map((x) => x.entityId).sort()).toEqual(['newsletter_subscribers', 'press_articles']);
  });

  it('stays quiet when every relation exists', () => {
    expect(detectMissingRelations({ required: ['bookings'], present: ['bookings', 'extra'] })).toHaveLength(0);
  });
});

describe('fingerprint', () => {
  it('is stable across repeated sightings of the same problem', () => {
    const a = fingerprint({ checkId: 'paid-but-stuck', entityType: 'booking', entityId: 'b1' });
    const b = fingerprint({ checkId: 'paid-but-stuck', entityType: 'booking', entityId: 'b1' });
    expect(a).toBe(b);
  });

  it('separates different entities under the same check', () => {
    expect(fingerprint({ checkId: 'c', entityType: 'booking', entityId: 'b1' }))
      .not.toBe(fingerprint({ checkId: 'c', entityType: 'booking', entityId: 'b2' }));
  });

  it('carries no timestamp, so re-sightings dedupe instead of accumulating', () => {
    expect(fingerprint({ checkId: 'c', entityType: 'booking', entityId: 'b1' }))
      .toBe('c:booking:b1');
  });
});
