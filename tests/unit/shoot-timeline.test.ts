import { describe, it, expect } from 'vitest';
import { shootTimeline } from '@/lib/bookings/timeline';

const base = { status: 'pending', created_at: '2026-10-01T08:00:00Z' };
const states = (b: Parameters<typeof shootTimeline>[0]) =>
  Object.fromEntries(shootTimeline(b, 'client').map((s) => [s.key, s.state]));

describe('shoot timeline', () => {
  it('a new booking waits for payment', () => {
    const s = states(base);
    expect(s.booked).toBe('done');
    expect(s.paid).toBe('current');
    expect(s.approved).toBe('upcoming');
  });

  it('after the creator checks in, delivery is next', () => {
    const s = states({ ...base, status: 'accepted', payment_status: 'paid', accepted_at: 'x', arrived_at: 'y' });
    expect(s.arrived).toBe('done');
    expect(s.delivered).toBe('current');
  });

  it('never claims an arrival that was not recorded', () => {
    const s = states({ ...base, status: 'delivered', payment_status: 'paid', accepted_at: 'x', delivered_at: 'z' });
    expect(s.arrived).toBe('skipped');
    expect(s.delivered).toBe('done');
    expect(s.approved).toBe('current');
  });

  it('a cancelled booking stops', () => {
    const s = states({ ...base, status: 'cancelled', payment_status: 'paid' });
    expect(s.confirmed).toBe('stopped');
  });

  it('tells each side what the step means for them', () => {
    const client = shootTimeline(base, 'client').find((s) => s.key === 'arrived')!;
    const creator = shootTimeline(base, 'creator').find((s) => s.key === 'arrived')!;
    expect(client.detail).toMatch(/checked in/);
    expect(creator.detail).toMatch(/I.m here/);
  });
});
