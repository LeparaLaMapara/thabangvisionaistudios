import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { creatorBookingProblem } from '@/lib/bookings/creator';

// POST /api/service-bookings now checks the named creator the way the
// Ubunye path does (lib/agent/offers.ts): verified, available, not suspended.

describe('creatorBookingProblem', () => {
  const ok = { verification_status: 'verified', available_for_hire: true, is_suspended: false };

  it('allows a verified, available creator who is not suspended', () => {
    expect(creatorBookingProblem(ok)).toBeNull();
  });

  it('refuses an unknown, unverified, unavailable or suspended creator', () => {
    expect(creatorBookingProblem(null)).toBe('not_found');
    expect(creatorBookingProblem({ ...ok, verification_status: 'pending' })).toBe('not_verified');
    expect(creatorBookingProblem({ ...ok, available_for_hire: false })).toBe('not_available');
    expect(creatorBookingProblem({ ...ok, is_suspended: true })).toBe('suspended');
  });

  it('a suspension whose end date has passed does not count', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    expect(creatorBookingProblem({ ...ok, is_suspended: true, suspension_expires_at: '2026-10-01T00:00:00Z' }, now)).toBeNull();
    expect(creatorBookingProblem({ ...ok, is_suspended: true, suspension_expires_at: '2026-11-01T00:00:00Z' }, now)).toBe('suspended');
  });
});

// ── The route ────────────────────────────────────────────────────────────────

const state: { creator: Record<string, unknown> | null; creatorError: boolean; inserts: string[] } = {
  creator: null,
  creatorError: false,
  inserts: [],
};

function chain(table: string): Record<string, unknown> {
  let op = 'select';
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    update: () => { op = 'update'; return q; },
    insert: () => { op = 'insert'; state.inserts.push(table); return q; },
    maybeSingle: () => q,
    single: () => q,
    then: (ok: (v: unknown) => unknown) => {
      if (table === 'profiles') {
        return Promise.resolve(state.creatorError ? { data: null, error: { message: 'down' } } : { data: state.creator, error: null }).then(ok);
      }
      if (table === 'bookings' && op === 'insert') return Promise.resolve({ data: { id: 'b1', reference: 'BK-1' }, error: null }).then(ok);
      return Promise.resolve({ data: null, error: null }).then(ok);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'client-1', email: 'c@example.invalid' } } }) },
    from: (t: string) => chain(t),
  }),
  createAdminClient: () => ({ from: (t: string) => chain(t) }),
}));
vi.mock('@/lib/auth', () => ({
  checkRateLimit: async () => true,
  checkNotSuspended: async () => ({ suspended: false }),
}));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => false, createCheckout: async () => ({}) } }));
vi.mock('@/lib/payments/offline', () => ({ reportUnpaidRequest: () => undefined, PAYMENTS_OFF_MESSAGE: 'offline' }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));

const { POST } = await import('@/app/api/service-bookings/route');

const CREATOR = '11111111-2222-3333-4444-555555555555';

function book(over: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/service-bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        creator_id: CREATOR,
        booking_type: 'production',
        project_category: 'Photography',
        project_description: 'Portraits for a family of four in a park.',
        duration_hours: 2,
        location: 'Soweto',
        preferred_dates: '2026-11-01',
        ...over,
      }),
    }),
  );
}

beforeEach(() => {
  state.creator = null;
  state.creatorError = false;
  state.inserts = [];
});

describe('POST /api/service-bookings: the named creator must be bookable', () => {
  it('refuses an unverified creator before anything is written', async () => {
    state.creator = { verification_status: 'pending', available_for_hire: true, is_suspended: false };
    const res = await book();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('creator_not_bookable');
    expect(state.inserts).toEqual([]);
  });

  it('refuses a suspended or unavailable creator', async () => {
    state.creator = { verification_status: 'verified', available_for_hire: true, is_suspended: true };
    expect((await book()).status).toBe(409);
    state.creator = { verification_status: 'verified', available_for_hire: false, is_suspended: false };
    expect((await book()).status).toBe(409);
    expect(state.inserts).toEqual([]);
  });

  it('fails closed when the creator cannot be read', async () => {
    state.creatorError = true;
    const res = await book();
    expect(res.status).toBe(503);
    expect(state.inserts).toEqual([]);
  });

  it('books a verified, available creator', async () => {
    state.creator = { verification_status: 'verified', available_for_hire: true, is_suspended: false };
    const res = await book();
    expect(res.status).toBe(200);
    expect(state.inserts).toEqual(['bookings']);
  });

  it('does not check anyone when no creator is named (our team assigns one)', async () => {
    const res = await book({ creator_id: null });
    expect(res.status).toBe(200);
    expect(state.inserts).toEqual(['bookings']);
  });
});
