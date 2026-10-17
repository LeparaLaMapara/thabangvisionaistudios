import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { isDuplicateRequestError, overlappingRequest, requestDays } from '@/lib/roles/request-guards';

/**
 * People request guards: a double submit returns the request already sent,
 * "today" is South African today, and staff cannot accept a person who is
 * already booked on one of the days.
 */

const h = vi.hoisted(() => ({
  open: null as string | null,
  openAfterRace: null as string | null,
  insertError: null as null | { code: string },
  created: [] as unknown[],
  notified: [] as string[],
  clash: null as null | { reference: string; days: string[] },
  moved: [] as string[],
}));

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock('@/lib/roles/flag', () => ({ rolesOffResponse: async () => null }));
vi.mock('@/lib/auth', () => ({
  checkRateLimit: async () => true,
  requireAdmin: async () => ({ user: { id: 'staff-1' } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'client-1' } } }) } }),
  createAdminClient: () => ({}),
}));
vi.mock('@/lib/supabase/queries/roles', () => ({
  getPublicRoleProfile: async () => ({
    personRole: { id: 'pr-1', price_cents: 180000, pricing_unit: 'day', per_km_cents: null, area: 'Johannesburg' },
    role: { pricing_unit: 'day', suggested_price_cents: { typical: 150000, low: 100000, high: 300000 } },
  }),
  getMyPersonRoles: async () => [],
  createBookingRequest: async (i: unknown) => {
    if (h.insertError) {
      h.open = h.openAfterRace;
      throw Object.assign(new Error('duplicate key value violates unique constraint "role_booking_requests_one_open"'), h.insertError);
    }
    h.created.push(i);
    return 'new-request';
  },
}));
vi.mock('@/lib/supabase/queries/role-requests', () => ({
  findOpenRequest: async () => h.open,
  findBookedOverlap: async () => h.clash,
  moveRequest: async (id: string, from: string, to: string) => {
    h.moved.push(`${id}:${from}->${to}`);
    return true;
  },
  listRequestsForAdmin: async () => [],
  requestGroupCounts: async () => ({}),
  ADMIN_REQUEST_GROUPS: { waiting: ['requested'] },
}));
vi.mock('@/lib/roles/request-notify-server', () => ({
  notifyNewRequest: async (id: string) => {
    h.notified.push(id);
  },
  notifyRequestDecision: async () => undefined,
}));

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/roles/requests', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const ask = (date: string) => ({ person_role_id: 'pr-1', dates: [date], arrival: '08:00', hours: 8, area: 'Johannesburg', note: 'Graduation' });

describe('pure guards', () => {
  it('requestDays reads the day list or the one date', () => {
    expect(requestDays({ requested_date: '2026-10-20', requested_dates: null })).toEqual(['2026-10-20']);
    expect(requestDays({ requested_date: '2026-10-20', requested_dates: ['2026-10-20', '2026-10-21'] })).toEqual(['2026-10-20', '2026-10-21']);
  });
  it('overlappingRequest finds a shared day and ignores the request itself', () => {
    const target = { id: 't', requested_date: '2026-10-20', requested_dates: ['2026-10-20', '2026-10-21'] };
    expect(overlappingRequest(target, [{ id: 'a', requested_date: '2026-10-22', requested_dates: null }])).toBeNull();
    expect(overlappingRequest(target, [target])).toBeNull();
    expect(overlappingRequest(target, [{ id: 'b', requested_date: '2026-10-19', requested_dates: ['2026-10-19', '2026-10-21'] }])).toEqual({ id: 'b', days: ['2026-10-21'] });
  });
  it('a unique violation is a duplicate; other errors are not', () => {
    expect(isDuplicateRequestError({ code: '23505' })).toBe(true);
    expect(isDuplicateRequestError(new Error('boom'))).toBe(false);
  });
});

describe('POST /api/roles/requests', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
    h.open = null;
    h.openAfterRace = null;
    h.insertError = null;
    h.created.length = 0;
    h.notified.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('a first request is created and the team is told once', async () => {
    const { POST } = await import('@/app/api/roles/requests/route');
    const res = await POST(post(ask('2026-10-18')));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'new-request' });
    expect(h.created).toHaveLength(1);
    expect(h.notified).toEqual(['new-request']);
  });

  it('a double submit returns the open request, creates nothing and tells nobody again', async () => {
    h.open = 'already-sent';
    const { POST } = await import('@/app/api/roles/requests/route');
    const res = await POST(post(ask('2026-10-18')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'already-sent', existing: true });
    expect(h.created).toHaveLength(0);
    expect(h.notified).toEqual([]);
  });

  it('two submits racing: the index refuses the second, which gets the first back', async () => {
    h.insertError = { code: '23505' };
    h.openAfterRace = 'won-the-race';
    const { POST } = await import('@/app/api/roles/requests/route');
    const res = await POST(post(ask('2026-10-18')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'won-the-race', existing: true });
    expect(h.notified).toEqual([]);
  });

  it('"today" is South African today: at 00:30 on Sunday in Johannesburg, Saturday has passed', async () => {
    vi.setSystemTime(new Date('2026-10-17T22:30:00Z')); // still Saturday in UTC
    const { POST } = await import('@/app/api/roles/requests/route');
    const res = await POST(post(ask('2026-10-17')));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/from today on/);
    const ok = await POST(post(ask('2026-10-18')));
    expect(ok.status).toBe(201);
  });
});

describe('PATCH /api/admin/roles/requests accept', () => {
  const patch = (body: unknown) =>
    new NextRequest('http://localhost/api/admin/roles/requests', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const ID = '00000000-0000-4000-8000-0000000000aa';

  beforeEach(() => {
    h.clash = null;
    h.moved.length = 0;
  });

  it('refuses to accept when the person is already booked on one of the days', async () => {
    h.clash = { reference: 'PR-1234', days: ['2026-10-18'] };
    const { PATCH } = await import('@/app/api/admin/roles/requests/route');
    const res = await PATCH(patch({ id: ID, action: 'accept' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('This person is already booked on Sunday 18 October 2026 (request PR-1234). Decline this request, or ask them first and decline the other.');
    expect(h.moved).toEqual([]);
  });

  it('accepts when there is no clash', async () => {
    const { PATCH } = await import('@/app/api/admin/roles/requests/route');
    const res = await PATCH(patch({ id: ID, action: 'accept' }));
    expect(res.status).toBe(200);
    expect(h.moved).toEqual([`${ID}:requested->accepted`]);
  });

  it('a decline is never blocked by a clash', async () => {
    h.clash = { reference: 'PR-1234', days: ['2026-10-18'] };
    const { PATCH } = await import('@/app/api/admin/roles/requests/route');
    const res = await PATCH(patch({ id: ID, action: 'decline' }));
    expect(res.status).toBe(200);
  });
});
