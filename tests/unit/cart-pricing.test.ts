import { describe, it, expect } from 'vitest';
import { calculateCartPricing } from '@/lib/cart/pricing';
import { STUDIO } from '@/lib/constants';
import type { CartItemWithRental } from '@/types/cart';

function makeItem(overrides: Partial<CartItemWithRental['rental']> & { quantity?: number }): CartItemWithRental {
  const { quantity = 1, ...rentalOverrides } = overrides;
  return {
    id: crypto.randomUUID(),
    user_id: 'user-1',
    rental_id: rentalOverrides.id ?? crypto.randomUUID(),
    quantity,
    start_date: null,
    end_date: null,
    created_at: new Date().toISOString(),
    rental: {
      id: crypto.randomUUID(),
      title: 'Test Item',
      slug: 'test-item',
      category: 'cameras',
      brand: null,
      price_per_day: 500,
      price_per_week: 2500,
      deposit_amount: 1000,
      currency: 'ZAR',
      is_available: true,
      thumbnail_url: null,
      quantity: 1,
      ...rentalOverrides,
    },
  };
}

describe('calculateCartPricing', () => {
  it('returns zeros for empty cart', () => {
    const result = calculateCartPricing([], 5);
    expect(result.itemCount).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('returns zeros for zero days', () => {
    const result = calculateCartPricing([makeItem({})], 0);
    expect(result.grandTotal).toBe(0);
  });

  it('calculates daily rate for < 7 days', () => {
    const result = calculateCartPricing([makeItem({ price_per_day: 500 })], 3);
    expect(result.subtotal).toBe(1500); // 3 * 500
    expect(result.totalDeposit).toBe(1000);
    expect(result.grandTotal).toBe(2500); // 1500 + 1000
  });

  it('uses weekly rate for >= 7 days', () => {
    const result = calculateCartPricing(
      [makeItem({ price_per_day: 500, price_per_week: 2500 })],
      10,
    );
    // 1 week (2500) + 3 extra days (3 * 500) = 4000
    expect(result.subtotal).toBe(4000);
  });

  it('falls back to daily rate when no weekly rate', () => {
    const result = calculateCartPricing(
      [makeItem({ price_per_day: 500, price_per_week: null })],
      10,
    );
    expect(result.subtotal).toBe(5000); // 10 * 500
  });

  it('multiplies by quantity', () => {
    const result = calculateCartPricing(
      [makeItem({ price_per_day: 500, deposit_amount: 1000, quantity: 3 })],
      2,
    );
    expect(result.subtotal).toBe(3000); // 500 * 2 * 3
    expect(result.totalDeposit).toBe(3000); // 1000 * 3
    expect(result.itemCount).toBe(3);
  });

  it('applies no discount for 1–2 items', () => {
    const result = calculateCartPricing([makeItem({ price_per_day: 500 })], 2);
    expect(result.bulkDiscountPercent).toBe(0);
    expect(result.bulkDiscountAmount).toBe(0);
  });

  it('applies 10% discount for 3–4 items', () => {
    const items = [
      makeItem({ price_per_day: 500, deposit_amount: 0, quantity: 3 }),
    ];
    const result = calculateCartPricing(items, 1);
    expect(result.itemCount).toBe(3);
    expect(result.bulkDiscountPercent).toBe(10);
    expect(result.subtotal).toBe(1500);
    expect(result.bulkDiscountAmount).toBe(150);
    expect(result.grandTotal).toBe(1350);
  });

  it('applies 15% discount for 5–6 items', () => {
    const items = [
      makeItem({ price_per_day: 100, deposit_amount: 0, quantity: 5 }),
    ];
    const result = calculateCartPricing(items, 1);
    expect(result.bulkDiscountPercent).toBe(15);
    expect(result.bulkDiscountAmount).toBe(75); // 500 * 0.15
  });

  it('applies 20% discount for 7+ items', () => {
    const items = [
      makeItem({ price_per_day: 100, deposit_amount: 0, quantity: 4 }),
      makeItem({ price_per_day: 200, deposit_amount: 0, quantity: 4 }),
    ];
    const result = calculateCartPricing(items, 1);
    expect(result.itemCount).toBe(8);
    expect(result.bulkDiscountPercent).toBe(20);
    // subtotal = 400 + 800 = 1200
    expect(result.subtotal).toBe(1200);
    expect(result.bulkDiscountAmount).toBe(240);
    expect(result.grandTotal).toBe(960);
  });

  it('reports a 0% VAT rate while the company is not VAT-registered', () => {
    expect(STUDIO.legal.vatRegistered).toBe(false);
    const result = calculateCartPricing([makeItem({ price_per_day: 500 })], 1);
    expect(result.vatRate).toBe(0);
  });

  it('returns zero VAT for an empty cart', () => {
    expect(calculateCartPricing([], 5).vatAmount).toBe(0);
  });

  it('includes no VAT in the discounted hire charge while not VAT-registered', () => {
    const items = [
      makeItem({ price_per_day: 500, deposit_amount: 1000, quantity: 3 }),
    ];
    const result = calculateCartPricing(items, 1);
    // subtotal 1500, less 10% bulk discount = 1350. Not VAT-registered, so no
    // VAT is added or "included" (it used to disclose R176.09 at 15%).
    expect(result.bulkDiscountAmount).toBe(150);
    expect(result.totalDeposit).toBe(3000);
    expect(result.vatAmount).toBe(0);
  });

  it('never adds VAT to the grand total', () => {
    const items = [
      makeItem({ price_per_day: 500, deposit_amount: 1000, quantity: 3 }),
    ];
    const result = calculateCartPricing(items, 1);
    expect(result.grandTotal).toBe(
      result.subtotal - result.bulkDiscountAmount + result.totalDeposit,
    );
    expect(result.grandTotal).toBe(4350); // 1500 - 150 + 3000
  });

  it('handles multiple items with mixed rates', () => {
    const items = [
      makeItem({ price_per_day: 500, price_per_week: 2500, deposit_amount: 1000, quantity: 1 }),
      makeItem({ price_per_day: 300, price_per_week: null, deposit_amount: 500, quantity: 2 }),
    ];
    const result = calculateCartPricing(items, 10);
    // Item 1: 1w (2500) + 3d (1500) = 4000 * 1 = 4000
    // Item 2: 10d * 300 = 3000 * 2 = 6000
    expect(result.subtotal).toBe(10000);
    expect(result.totalDeposit).toBe(2000); // 1000 + 500*2
    expect(result.itemCount).toBe(3);
    expect(result.bulkDiscountPercent).toBe(10); // 3 items
  });

  it('keeps cent-level totals exact with fractional rates and a discount', () => {
    const items = [
      makeItem({ price_per_day: 99.99, price_per_week: null, deposit_amount: 0.01, quantity: 3 }),
    ];
    const result = calculateCartPricing(items, 3);
    expect(result.subtotal).toBe(899.91); // 99.99 × 3 days × 3
    expect(result.bulkDiscountAmount).toBe(89.99); // 10% of 899.91 = 89.991
    expect(result.grandTotal).toBe(809.95); // 899.91 - 89.99 + 0.03
  });
});
