import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * T05 for gear checkout: the browser never states a price. A request that
 * carries any money field is refused before anything is reserved or charged.
 */

const reserve = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'u@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { verification_status: 'verified' } }) }) }) }),
  }),
  createAdminClient: () => ({ rpc: reserve }),
}));
vi.mock('@/lib/auth', () => ({
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/consent', () => ({ recordConsent: vi.fn(async () => ({ ok: true })), requiredConsents: () => [] }));

describe('cart checkout refuses client-supplied prices (T05)', () => {
  for (const field of ['amount', 'total_price', 'deposit_amount', 'discount', 'delivery_fee', 'currency']) {
    it(`rejects a body carrying "${field}"`, async () => {
      const { POST } = await import('@/app/api/cart/checkout/route');
      const res = await POST(
        new NextRequest('http://localhost/api/cart/checkout', {
          method: 'POST',
          body: JSON.stringify({ acceptTerms: true, start_date: '2030-01-10', end_date: '2030-01-12', [field]: 1 }),
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('CLIENT_PRICE_REJECTED');
      expect(reserve).not.toHaveBeenCalled();
    });
  }
});
