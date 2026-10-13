import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FUNNEL_CLIENT_SURFACES } from '@/lib/constants';

/**
 * POST /api/funnel: a browser may report viewing a listing or choosing dates.
 * The listing id must be a UUID and the surface one of ours; anything else is
 * refused, never stored.
 */

const trackFunnel = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: (...a: unknown[]) => trackFunnel(...a) }));

const RENTAL = '9b2f1c3e-0000-4000-8000-000000000001';

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/funnel/route');
  return POST(new NextRequest('http://localhost/api/funnel', { method: 'POST', body: JSON.stringify(body) }));
};

beforeEach(() => trackFunnel.mockClear());

describe('POST /api/funnel', () => {
  it('records a known stage with a UUID listing and a known surface', async () => {
    const res = await post({ stage: 'dates_chosen', rentalId: RENTAL, days: 3, surface: FUNNEL_CLIENT_SURFACES[0] });
    expect(res.status).toBe(204);
    expect(trackFunnel).toHaveBeenCalledWith('dates_chosen', { userId: null, meta: { rentalId: RENTAL, days: 3, surface: 'gear_page' } });
  });

  it('a missing listing id or surface is fine (counted without them)', async () => {
    expect((await post({ stage: 'rental_viewed' })).status).toBe(204);
    expect(trackFunnel).toHaveBeenCalledWith('rental_viewed', { userId: null, meta: { rentalId: null, days: null, surface: null } });
  });

  it.each([
    ['a non-UUID listing id', { rentalId: 'BK-abc123' }],
    ['an id-like string', { rentalId: 'r-1' }],
    ['a number', { rentalId: 42 }],
    ['an unknown surface', { rentalId: RENTAL, surface: 'evil_page' }],
    ['a surface that is not a string', { rentalId: RENTAL, surface: ['gear_page'] }],
  ])('refuses %s', async (_label, extra) => {
    const res = await post({ stage: 'rental_viewed', ...extra });
    expect(res.status).toBe(400);
    expect(trackFunnel).not.toHaveBeenCalled();
  });

  it('still refuses server-only stages', async () => {
    expect((await post({ stage: 'payment_confirmed', rentalId: RENTAL })).status).toBe(400);
    expect(trackFunnel).not.toHaveBeenCalled();
  });
});
