import { STUDIO } from '@/lib/constants';
import type { CartItemWithRental, CartPricingItem, CartPricingSummary } from '@/types/cart';

/**
 * Calculate the rental price for a single item over a number of days.
 * Uses weekly rate when >= 7 days, plus daily rate for remainder.
 */
function calculateItemPrice(
  pricePerDay: number,
  pricePerWeek: number | null,
  days: number,
): number {
  if (pricePerWeek && days >= 7) {
    const fullWeeks = Math.floor(days / 7);
    const extraDays = days % 7;
    return fullWeeks * pricePerWeek + extraDays * pricePerDay;
  }
  return days * pricePerDay;
}

/**
 * Determine the bulk discount percentage based on total item count.
 */
function getBulkDiscountPercent(totalItems: number): number {
  const tiers = STUDIO.rental.bulkDiscount;
  for (const tier of tiers) {
    if (totalItems >= tier.minItems && totalItems <= tier.maxItems) {
      return tier.discountPercent;
    }
  }
  return 0;
}

/**
 * Pure function to calculate full cart pricing.
 * All cart items share the same date range (Option A).
 */
export function calculateCartPricing(
  items: CartItemWithRental[],
  days: number,
): CartPricingSummary {
  if (items.length === 0 || days <= 0) {
    return {
      items: [],
      itemCount: 0,
      dayCount: days,
      subtotal: 0,
      bulkDiscountPercent: 0,
      bulkDiscountAmount: 0,
      totalDeposit: 0,
      grandTotal: 0,
    };
  }

  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  const pricingItems: CartPricingItem[] = items.map((item) => {
    const unitPrice = calculateItemPrice(
      item.rental.price_per_day,
      item.rental.price_per_week,
      days,
    );
    const subtotal = unitPrice * item.quantity;
    const deposit = (item.rental.deposit_amount ?? 0) * item.quantity;

    return {
      rental_id: item.rental_id,
      title: item.rental.title,
      quantity: item.quantity,
      days,
      unitPrice,
      subtotal,
      deposit,
    };
  });

  const subtotal = pricingItems.reduce((sum, pi) => sum + pi.subtotal, 0);
  const totalDeposit = pricingItems.reduce((sum, pi) => sum + pi.deposit, 0);
  const bulkDiscountPercent = getBulkDiscountPercent(totalItemCount);
  const bulkDiscountAmount = Math.round(subtotal * (bulkDiscountPercent / 100) * 100) / 100;
  const grandTotal = subtotal - bulkDiscountAmount + totalDeposit;

  return {
    items: pricingItems,
    itemCount: totalItemCount,
    dayCount: days,
    subtotal,
    bulkDiscountPercent,
    bulkDiscountAmount,
    totalDeposit,
    grandTotal,
  };
}
