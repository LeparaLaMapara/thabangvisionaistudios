import { describe, it, expect } from 'vitest';
import { detectStuckServiceRefunds, STUCK_REFUND_AFTER_MINUTES } from '@/lib/ops/service-refunds';

describe('a service refund claimed with no recorded outcome is reported', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it('reports a claim older than the window, not one still in flight', () => {
    const f = detectStuckServiceRefunds([
      { id: 'old', reference: 'BK-1', updatedAt: ago(STUCK_REFUND_AFTER_MINUTES + 1), amount: 1000, note: null },
      { id: 'fresh', reference: 'BK-2', updatedAt: ago(2), amount: 500, note: null },
    ], now);
    expect(f.map((x) => x.entityId)).toEqual(['old']);
    expect(f[0]).toMatchObject({ checkId: 'service-refund-stuck', severity: 'critical', entityType: 'booking' });
  });

  it('marks a pre-073 unknown outcome stored as pending', () => {
    const [f] = detectStuckServiceRefunds([{ id: 'u', reference: 'BK-3', updatedAt: ago(60), amount: 200, note: 'OUTCOME UNKNOWN, check the payment provider before refunding by hand: timeout' }], now);
    expect(f.detail).toMatchObject({ unknownOutcome: true });
  });

  it('a row with no timestamp is reported rather than ignored', () => {
    expect(detectStuckServiceRefunds([{ id: 'x', reference: null, updatedAt: null, amount: null, note: null }], now)).toHaveLength(1);
  });
});
