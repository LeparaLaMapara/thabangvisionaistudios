import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO } from '@/lib/constants';

/**
 * POST /api/cart and PATCH /api/cart:
 *  - a full cart refuses NEW items only: re-posting an item already in the
 *    cart (the gear page's "Edit dates") updates it;
 *  - one per-item quantity cap (STUDIO.rental.maxQuantityPerItem) everywhere.
 */

let count = 0;
let cartRentalIds: string[] = [];
const addToCart = vi.fn(async (_u: string, rentalId: string, qty: number) => ({ id: 'ci', rental_id: rentalId, quantity: qty }));
const updateCartQuantity = vi.fn(async (_u: string, itemId: string, qty: number) => ({ id: itemId, quantity: qty }));

const rentalQuery = {
  select: () => rentalQuery,
  eq: () => rentalQuery,
  is: () => rentalQuery,
  single: async () => ({ data: { id: 'r-1', is_available: true } }),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'renter-1' } } }) },
    from: () => rentalQuery,
  }),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/supabase/queries/cart', () => ({
  getCartItems: async () => cartRentalIds.map((id, i) => ({ id: `ci-${i}`, rental_id: id })),
  getCartItemCount: async () => count,
  addToCart: (...a: unknown[]) => addToCart(...(a as [string, string, number])),
  removeFromCart: vi.fn(),
  updateCartQuantity: (...a: unknown[]) => updateCartQuantity(...(a as [string, string, number])),
  updateCartItemDates: vi.fn(),
  clearCart: vi.fn(),
}));

const call = async (method: 'POST' | 'PATCH', body: unknown) => {
  const mod = await import('@/app/api/cart/route');
  return mod[method](new NextRequest('http://localhost/api/cart', { method, body: JSON.stringify(body) }));
};

beforeEach(() => {
  count = 0;
  cartRentalIds = [];
  addToCart.mockClear();
  updateCartQuantity.mockClear();
});

describe('POST /api/cart when the cart is full', () => {
  it('refuses a new item', async () => {
    count = STUDIO.rental.maxCartItems;
    cartRentalIds = Array.from({ length: count }, (_, i) => `other-${i}`);
    const res = await call('POST', { rental_id: 'r-1', quantity: 1, start_date: '2030-01-10', end_date: '2030-01-12' });
    expect(res.status).toBe(400);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it('accepts new dates for an item already in it', async () => {
    count = STUDIO.rental.maxCartItems;
    cartRentalIds = ['r-1', ...Array.from({ length: count - 1 }, (_, i) => `other-${i}`)];
    const res = await call('POST', { rental_id: 'r-1', quantity: 2, start_date: '2030-01-10', end_date: '2030-01-12' });
    expect(res.status).toBe(201);
    expect(addToCart).toHaveBeenCalledWith('renter-1', 'r-1', 2, '2030-01-10', '2030-01-12');
  });
});

describe('one per-item quantity cap', () => {
  it('is a constant', () => {
    expect(Number.isInteger(STUDIO.rental.maxQuantityPerItem)).toBe(true);
    expect(STUDIO.rental.maxQuantityPerItem).toBeGreaterThanOrEqual(1);
  });

  it('POST and PATCH clamp to it', async () => {
    await call('POST', { rental_id: 'r-1', quantity: 999 });
    expect(addToCart.mock.calls[0][2]).toBe(STUDIO.rental.maxQuantityPerItem);
    await call('PATCH', { item_id: 'ci-0', quantity: 999 });
    expect(updateCartQuantity.mock.calls[0][2]).toBe(STUDIO.rental.maxQuantityPerItem);
  });

  it('no literal 5 cap is left in the widget, the cart page, /api/cart or the eligibility route', () => {
    const files = [
      'components/booking/BookingWidget.tsx',
      'app/(platform)/dashboard/cart/page.tsx',
      'app/api/cart/route.ts',
      'app/api/rentals/eligibility/route.ts',
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(/Math\.min\(\s*5\s*,|<=\s*5\b|MAX_QTY\s*=\s*5\b/);
      expect(src, f).toMatch(/maxQuantityPerItem/);
    }
  });
});
