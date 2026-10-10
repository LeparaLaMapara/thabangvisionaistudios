/**
 * Phase 5: a gear owner sees the hires of their gear and when each payout is
 * due, without anything about the renter. GET /api/listings/earnings only
 * reads bookings of gear the caller owns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerHireViews, payoutWords } from '@/lib/rental/owner-earnings';
import { RENTAL_POLICY } from '@/lib/constants';

const hire = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, rental_title: 'Owner Lens', start_date: '2026-10-01', end_date: '2026-10-03', status, owner_share_cents: 24000, completed_at: null, ...extra,
});

describe('ownerHireViews', () => {
  it('lists real hires newest first; unpaid holds and cancellations are not hires', () => {
    const v = ownerHireViews([hire('a', 'completed'), hire('b', 'pending'), hire('c', 'cancelled'), hire('d', 'confirmed', { start_date: '2026-11-01' })], []);
    expect(v.map((h) => h.id)).toEqual(['d', 'a']);
    expect(v[0].stage).toBe('Booked');
  });

  it('a completed hire with no payout row yet says when it is scheduled, from constants', () => {
    const [v] = ownerHireViews([hire('a', 'completed')], []);
    expect(v.payout?.text).toContain(`${RENTAL_POLICY.ownerPayoutDelayHours} hours`);
    expect(v.payout?.text).toMatch(/final check by our team/);
  });

  it('uses the payout row for the amount and its state', () => {
    const [v] = ownerHireViews([hire('a', 'completed')], [{ booking_id: 'a', state: 'success', owner_amount_cents: 24000, scheduled_at: null, completed_at: '2026-10-06T10:00:00Z' }]);
    expect(v.shareCents).toBe(24000);
    expect(v.payout).toMatchObject({ tone: 'done' });
    expect(v.payout?.text).toMatch(/^Paid on/);
    expect(v.payout?.text).toMatch(/depends on your bank/);
  });

  it('every payout state has words; trouble goes to a person and never says "paid"', () => {
    for (const state of ['scheduled', 'held', 'approved', 'claimed', 'pending', 'otp', 'received', 'success', 'failed', 'reversed', 'blocked', 'rejected', 'abandoned', 'needs_attention']) {
      const w = payoutWords({ booking_id: 'x', state, owner_amount_cents: 1, scheduled_at: '2026-10-08T10:00:00Z', completed_at: null });
      expect(w.text.length, state).toBeGreaterThan(10);
      if (state !== 'success') expect(w.text, state).not.toMatch(/^Paid/);
    }
    expect(payoutWords({ booking_id: 'x', state: 'failed', owner_amount_cents: 1, scheduled_at: null, completed_at: null }).tone).toBe('attention');
  });

  it('carries nothing about the renter', () => {
    const [v] = ownerHireViews([{ ...hire('a', 'active'), user_id: 'renter-1', renter_email: 'r@example.invalid' } as never], []);
    expect(JSON.stringify(v)).not.toMatch(/renter-1|example\.invalid/);
  });
});

const state = vi.hoisted(() => ({ calls: [] as { table: string; filters: [string, string, unknown][] }[], user: 'owner-1' as string | null }));
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => (state.user ? { user: { id: state.user }, error: null } : { user: null, error: new Response(null, { status: 401 }) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call = { table, filters: [] as [string, string, unknown][] };
      state.calls.push(call);
      const data: Record<string, unknown[]> = {
        smart_rentals: [{ id: 'gear-1', title: 'Owner Lens' }],
        equipment_bookings: [{ id: 'bk-1', rental_id: 'gear-1', start_date: '2026-10-01', end_date: '2026-10-03', status: 'active', owner_share_cents: 24000, completed_at: null, user_id: 'renter-1' }],
        owner_payouts: [],
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return q; },
        in: (k: string, v: unknown) => { call.filters.push(['in', k, v]); return q; },
        order: () => q,
        limit: () => q,
        then: (resolve: (r: unknown) => void) => resolve({ data: data[table] ?? [], error: null }),
      };
      return q;
    },
  }),
}));

describe('GET /api/listings/earnings', () => {
  beforeEach(() => { state.calls = []; state.user = 'owner-1'; });

  it('reads only the caller\'s gear and payouts, and returns no renter fields', async () => {
    const { GET } = await import('@/app/api/listings/earnings/route');
    const res = await GET();
    const body = await res.json();
    expect(state.calls.find((c) => c.table === 'smart_rentals')?.filters).toContainEqual(['eq', 'owner_id', 'owner-1']);
    expect(state.calls.find((c) => c.table === 'equipment_bookings')?.filters).toContainEqual(['in', 'rental_id', ['gear-1']]);
    expect(state.calls.find((c) => c.table === 'owner_payouts')?.filters).toContainEqual(['eq', 'owner_id', 'owner-1']);
    expect(body.hires).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('renter-1');
  });

  it('refuses a signed-out caller', async () => {
    state.user = null;
    const { GET } = await import('@/app/api/listings/earnings/route');
    expect((await GET()).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
});
