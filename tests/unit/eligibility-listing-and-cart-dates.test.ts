import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/rentals/eligibility:
 *  - a listing that is not published (draft, in review, archived) reads
 *    exactly like a missing one: nothing about it is revealed;
 *  - for the cart, undated lines take the dates asked about, as the
 *    checkout gives them the dates it is sent, so the answer matches what the
 *    checkout would decide.
 */

const PUBLISHED = '11111111-2222-4333-8444-555555555555';
const DRAFT = '22222222-2222-4333-8444-555555555555';
const DELETED = '33333333-2222-4333-8444-555555555555';
const MISSING = '44444444-2222-4333-8444-555555555555';

type Row = { id: string; is_published: boolean; deleted_at: string | null; replacement_value: number; deposit_amount: number | null };
const ROWS: Row[] = [
  { id: PUBLISHED, is_published: true, deleted_at: null, replacement_value: 1500, deposit_amount: null },
  { id: DRAFT, is_published: false, deleted_at: null, replacement_value: 1500, deposit_amount: null },
  { id: DELETED, is_published: true, deleted_at: '2026-01-01T00:00:00Z', replacement_value: 1500, deposit_amount: null },
];

/** smart_rentals with the filters PostgREST would apply. */
function fakeDb() {
  return {
    from: () => {
      const filters: [string, unknown][] = [];
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        is: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        maybeSingle: async () => ({
          data: ROWS.find((r) => filters.every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)) ?? null,
          error: null,
        }),
      };
      return b;
    },
  };
}

let user: { id: string; email_confirmed_at: string } | null = { id: 'renter-1', email_confirmed_at: '2026-01-01T00:00:00Z' };
let cart: { quantity: number; start_date: string | null; end_date: string | null; rental: { replacement_value: number } }[] = [];
const readiness = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  createAdminClient: () => fakeDb(),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/sms', () => ({ sms: { isConfigured: () => false } }));
vi.mock('@/lib/supabase/queries/cart', () => ({ getCartItems: async () => cart }));
vi.mock('@/lib/rental/eligibility-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/eligibility-server')>()),
  rentalReadiness: (...a: unknown[]) => readiness(...a),
}));

import { trustLineForRental, trustLinesFromCart } from '@/lib/rental/eligibility-server';

const get = async (qs: string) => {
  const { GET } = await import('@/app/api/rentals/eligibility/route');
  return GET(new NextRequest(`http://localhost/api/rentals/eligibility${qs}`));
};

beforeEach(() => {
  user = { id: 'renter-1', email_confirmed_at: '2026-01-01T00:00:00Z' };
  cart = [];
  readiness.mockReset().mockResolvedValue({ ok: true });
});

describe('trustLineForRental: only published listings', () => {
  it('a published listing is valued', async () => {
    const db = fakeDb() as unknown as Parameters<typeof trustLineForRental>[0];
    expect(await trustLineForRental(db, PUBLISHED, 1)).toMatchObject({ unitReplacementValueCents: 150_000, quantity: 1 });
  });

  it('unpublished, deleted and missing listings all read as not found', async () => {
    const db = fakeDb() as unknown as Parameters<typeof trustLineForRental>[0];
    expect(await trustLineForRental(db, DRAFT, 1)).toBeNull();
    expect(await trustLineForRental(db, DELETED, 1)).toBeNull();
    expect(await trustLineForRental(db, MISSING, 1)).toBeNull();
  });

  it('the route answers an unpublished listing exactly like a missing one', async () => {
    const draft = await get(`?rental_id=${DRAFT}`);
    const missing = await get(`?rental_id=${MISSING}`);
    expect(draft.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await draft.json()).toEqual(await missing.json());
    expect(readiness).not.toHaveBeenCalled();
  });
});

describe('cart readiness uses the dates asked about for undated lines', () => {
  it('trustLinesFromCart: undated lines take the fallback; dated lines keep their own', () => {
    const lines = trustLinesFromCart(
      [
        { quantity: 1, start_date: '2026-11-01', end_date: '2026-11-03', rental: { replacement_value: 1000 } },
        { quantity: 2, start_date: null, end_date: null, rental: { replacement_value: 500 } },
      ],
      { startDate: '2026-12-01', endDate: '2026-12-05' },
    );
    expect(lines[0]).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-03' });
    expect(lines[1]).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-05', quantity: 2 });
  });

  it('the route passes ?start&end to undated cart lines, as checkout does', async () => {
    cart = [{ quantity: 1, start_date: null, end_date: null, rental: { replacement_value: 2000 } }];
    const res = await get('?start=2026-12-01&end=2026-12-05');
    expect(res.status).toBe(200);
    const lines = readiness.mock.calls[0][2];
    expect(lines).toEqual([{ unitReplacementValueCents: 200_000, quantity: 1, startDate: '2026-12-01', endDate: '2026-12-05' }]);
  });

  it('without dates in the query, undated lines stay undated', async () => {
    cart = [{ quantity: 1, start_date: null, end_date: null, rental: { replacement_value: 2000 } }];
    await get('');
    expect(readiness.mock.calls[0][2]).toEqual([{ unitReplacementValueCents: 200_000, quantity: 1 }]);
  });
});
