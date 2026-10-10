/**
 * Phase 5 (customer experience), a client booking a creator:
 *  - client-actions: after delivery the client sees every action the server
 *    allows (approve, ask for changes, report a problem), and only those;
 *  - timeline: the current step says what we are waiting for, not that it happened;
 *  - the booking form quotes the rate the server charges.
 */
import { describe, expect, it } from 'vitest';
import { clientServiceActions } from '@/lib/bookings/client-actions';
import { shootTimeline } from '@/lib/bookings/timeline';
import { STUDIO } from '@/lib/constants';
import { getHourlyRate } from '@/lib/bookings/rates';
import { getHourlyRate as getHourlyRateFromQueries } from '@/lib/supabase/queries/service-bookings';

const NOW = new Date('2026-10-10T10:00:00Z');

describe('clientServiceActions', () => {
  it('after delivery the client can approve, ask for changes or report a problem; not cancel', () => {
    const a = clientServiceActions({ status: 'delivered', delivered_at: '2026-10-09T00:00:00Z', delivery_url: 'https://x', revisions_used: 0, revisions_included: 1 }, NOW);
    expect(a).toMatchObject({ approve: true, changesLeft: 1, report: true, cancel: false });
  });

  it('no changes once the revision rounds are used', () => {
    expect(clientServiceActions({ status: 'delivered', delivered_at: 'x', revisions_used: 1, revisions_included: 1 }, NOW).changesLeft).toBe(0);
  });

  it('before the shoot: cancel, no approve; a paid-only booking cannot be reported yet', () => {
    const a = clientServiceActions({ status: 'paid' }, NOW);
    expect(a).toMatchObject({ approve: false, changesLeft: 0, cancel: true, report: false });
    expect(clientServiceActions({ status: 'accepted' }, NOW).report).toBe(true);
  });

  it('a revision request puts it back to accepted: no cancel after a delivery', () => {
    expect(clientServiceActions({ status: 'accepted', delivery_url: 'https://x', revisions_used: 1 }, NOW).cancel).toBe(false);
  });

  it('after approval: report only until the payout is due; rate once', () => {
    const open = clientServiceActions({ status: 'completed', completed_at: '2026-10-09T12:00:00Z', dispute_window_ends_at: '2026-10-12T12:00:00Z' }, NOW);
    expect(open).toMatchObject({ report: true, rate: true, approve: false });
    const closed = clientServiceActions({ status: 'completed', completed_at: '2026-10-01T00:00:00Z', dispute_window_ends_at: '2026-10-04T00:00:00Z', client_rating: 5 }, NOW);
    expect(closed).toMatchObject({ report: false, rate: false });
  });
});

describe('shoot timeline: the current step says what we are waiting for', () => {
  const paid = { status: 'paid', created_at: '2026-10-01T08:00:00Z', payment_status: 'paid' };
  it('a paid booking waits for the creator; it does not claim they accepted', () => {
    const client = shootTimeline(paid, 'client').find((s) => s.state === 'current')!;
    expect(client.key).toBe('confirmed');
    expect(client.next).toMatch(/Waiting for your creator/);
    expect(client.next).not.toMatch(/has accepted/);
    const creator = shootTimeline(paid, 'creator').find((s) => s.state === 'current')!;
    expect(creator.next).toMatch(/Accept or decline/);
    expect(creator.next).not.toMatch(/You accepted/);
  });

  it('the approval step uses the configured number of days', () => {
    const delivered = { ...paid, status: 'delivered', accepted_at: 'x', delivered_at: 'y' };
    const step = shootTimeline(delivered, 'client').find((s) => s.state === 'current')!;
    expect(step.key).toBe('approved');
    expect(step.next).toContain(`${STUDIO.booking.autoApproveDeliveryAfterDays} days`);
    expect(step.next).toMatch(/ask for changes or report a problem/);
  });
});

describe('the booking form quotes the rate the server charges', () => {
  it('one function, re-exported for the server', () => {
    expect(getHourlyRateFromQueries).toBe(getHourlyRate);
    expect(getHourlyRate('Music Video')).toBeGreaterThan(getHourlyRate('Portrait Photography'));
  });
});
