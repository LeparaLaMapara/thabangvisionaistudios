import { STUDIO } from '@/lib/constants';
import type { CartItemWithRental, CartPricingItem, CartPricingSummary, CartPerItemPricingSummary } from '@/types/cart';

/**
 * Calculate the rental price for a single item over a number of days.
 * Uses weekly rate when >= 7 days, plus daily rate for remainder.
 */
export function calculateItemPrice(
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
 * VAT contained in a VAT-inclusive amount.
 *
 * Equipment hire prices in `smart_rentals` are stored VAT-inclusive, so VAT is
 * disclosed rather than added: the customer pays the same total either way.
 * Deposits are excluded by the caller — a refundable security deposit is not
 * consideration for a supply and carries no VAT.
 */
export function calculateIncludedVat(taxableBase: number): number {
  const rate = STUDIO.booking.vatRate;
  return Math.round(taxableBase * (rate / (100 + rate)) * 100) / 100;
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
      vatRate: STUDIO.booking.vatRate,
      vatAmount: 0,
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
  const vatAmount = calculateIncludedVat(subtotal - bulkDiscountAmount);
  const grandTotal = subtotal - bulkDiscountAmount + totalDeposit;

  return {
    items: pricingItems,
    itemCount: totalItemCount,
    dayCount: days,
    subtotal,
    bulkDiscountPercent,
    bulkDiscountAmount,
    totalDeposit,
    vatRate: STUDIO.booking.vatRate,
    vatAmount,
    grandTotal,
  };
}

export function calculateCartPricingPerItem(
  items: CartItemWithRental[],
): CartPerItemPricingSummary {
  if (items.length === 0) {
    return {
      items: [],
      itemCount: 0,
      subtotal: 0,
      bulkDiscountPercent: 0,
      bulkDiscountAmount: 0,
      totalDeposit: 0,
      vatRate: STUDIO.booking.vatRate,
      vatAmount: 0,
      grandTotal: 0,
    };
  }

  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  const pricingItems: CartPricingItem[] = items.map((item) => {
    const start = item.start_date ? new Date(item.start_date) : null;
    const end = item.end_date ? new Date(item.end_date) : null;
    const days =
      start && end
        ? Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

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
  const vatAmount = calculateIncludedVat(subtotal - bulkDiscountAmount);
  const grandTotal = subtotal - bulkDiscountAmount + totalDeposit;

  return {
    items: pricingItems,
    itemCount: totalItemCount,
    subtotal,
    bulkDiscountPercent,
    bulkDiscountAmount,
    totalDeposit,
    vatRate: STUDIO.booking.vatRate,
    vatAmount,
    grandTotal,
  };
}
