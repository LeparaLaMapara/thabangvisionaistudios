import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/rentals/eligibility: what the signed-in renter still needs before
 * paying. Signed out it answers 401 with a code (the gear page shows the
 * policy summary instead); signed in it returns the checklist with codes and
 * links. Advisory only: the checkout re-checks everything.
 */

const RENTAL = '11111111-2222-4333-8444-555555555555';
let user: { id: string; email_confirmed_at: string } | null = null;

const readiness = vi.fn();
const lineFor = vi.fn();
const cartLines = vi.fn((items: unknown[]) => items.map(() => ({ unitReplacementValueCents: 1, quantity: 1 })));
const smsConfigured = vi.fn(() => false);

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  createAdminClient: () => ({}),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/sms', () => ({ sms: { isConfigured: () => smsConfigured() } }));
vi.mock('@/lib/supabase/queries/cart', () => ({ getCartItems: async () => [{ id: 'c1' }, { id: 'c2' }] }));
vi.mock('@/lib/rental/eligibility-server', () => ({
  rentalReadiness: (...a: unknown[]) => readiness(...a),
  trustLineForRental: (...a: unknown[]) => lineFor(...a),
  trustLinesFromCart: (items: unknown[]) => cartLines(items),
}));

const get = async (qs: string) => {
  const { GET } = await import('@/app/api/rentals/eligibility/route');
  return GET(new NextRequest(`http://localhost/api/rentals/eligibility${qs}`));
};

const SAMPLE = {
  ok: false,
  code: 'ID_REQUIRED',
  tier: 'none',
  limitCents: 0,
  checklist: [],
  missing: [
    { code: 'verify_phone', label: 'Confirm your phone number', href: '/contact', status: 'unavailable' },
    { code: 'verify_id', label: 'One-time ID check', href: '/dashboard/verification', status: 'missing' },
  ],
  collectionRequired: true,
  collectionReasons: ['first_hire'],
  requiresManualApproval: false,
  phoneChecksAvailable: false,
};

describe('GET /api/rentals/eligibility', () => {
  beforeEach(() => {
    user = { id: 'renter-1', email_confirmed_at: '2026-01-01T00:00:00Z' };
    readiness.mockReset().mockResolvedValue(SAMPLE);
    lineFor.mockReset().mockResolvedValue({ unitReplacementValueCents: 500_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22' });
  });

  it('signed out: 401 with a code, and nothing is read', async () => {
    user = null;
    const res = await get(`?rental_id=${RENTAL}`);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SIGN_IN_REQUIRED');
    expect(readiness).not.toHaveBeenCalled();
  });

  it('one listing: values it on the server and returns codes, links and collection reasons', async () => {
    const res = await get(`?rental_id=${RENTAL}&quantity=2&start=2026-10-20&end=2026-10-22`);
    expect(res.status).toBe(200);
    expect(lineFor).toHaveBeenCalledWith(expect.anything(), RENTAL, 2, '2026-10-20', '2026-10-22');
    const [, who, lines, delivery, phoneOk] = readiness.mock.calls[0];
    expect(who).toMatchObject({ id: 'renter-1' });
    expect(lines).toHaveLength(1);
    expect(delivery).toBe(false);
    expect(phoneOk).toBe(false); // SMS not configured is passed through
    const body = await res.json();
    expect(body.missing.map((m: { code: string }) => m.code)).toEqual(['verify_phone', 'verify_id']);
    expect(body.missing[1].href).toBe('/dashboard/verification');
    expect(body.collectionReasons).toEqual(['first_hire']);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('without a listing it checks the cart, and passes the delivery choice', async () => {
    const res = await get('?delivery=1');
    expect(res.status).toBe(200);
    expect(cartLines).toHaveBeenCalled();
    expect(readiness.mock.calls[0][2]).toHaveLength(2);
    expect(readiness.mock.calls[0][3]).toBe(true);
  });

  it('rejects malformed input', async () => {
    expect((await get('?rental_id=not-a-uuid')).status).toBe(400);
    expect((await get(`?rental_id=${RENTAL}&start=2026-10-20`)).status).toBe(400);
    expect((await get(`?rental_id=${RENTAL}&start=20-10-2026&end=2026-10-22`)).status).toBe(400);
  });

  it('404 for an unknown listing, 503 when the record cannot be read', async () => {
    lineFor.mockResolvedValueOnce(null);
    expect((await get(`?rental_id=${RENTAL}`)).status).toBe(404);
    readiness.mockRejectedValueOnce(new Error('db down'));
    expect((await get(`?rental_id=${RENTAL}`)).status).toBe(503);
  });
});
