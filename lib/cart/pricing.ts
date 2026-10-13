import { STUDIO } from '@/lib/constants';
import { allocateCents, bpsOf, fromCents, percentToBps, toCents } from '@/lib/core/pricing/money';
import { vatOnInclusive, vatRateAt } from '@/lib/core/pricing/tax';
import { depositFor, hireCents } from '@/lib/core/pricing/rental';
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
  if (Number.isSafeInteger(days) && days > 0) {
    // Whole cents through the pricing core, so R99.99 × 3 is R299.97 exactly.
    return fromCents(hireCents(toCents(pricePerDay), pricePerWeek ? toCents(pricePerWeek) : null, days));
  }
  if (pricePerWeek && days >= 7) {
    const fullWeeks = Math.floor(days / 7);
    const extraDays = days % 7;
    return fullWeeks * pricePerWeek + extraDays * pricePerDay;
  }
  return days * pricePerDay;
}

/**
 * VAT contained in a VAT-inclusive amount, in rands.
 *
 * Equipment hire prices in `smart_rentals` are customer prices. VAT is never
 * added to them: while the company is not VAT-registered the rate is 0 and
 * this returns 0; after a dated registration (STUDIO.legal.tax) prices are
 * treated as VAT-inclusive, so VAT is disclosed from the same total.
 * Deposits are excluded by the caller: a refundable security deposit is not
 * consideration for a supply and carries no VAT.
 */
export function calculateIncludedVat(taxableBase: number, at: Date = new Date()): number {
  return fromCents(vatOnInclusive(toCents(taxableBase), vatRateAt(at)));
}

/** The VAT rate (percent) that applies to a sale now: 0 while not registered. */
export function currentVatRate(at: Date = new Date()): number {
  return vatRateAt(at);
}

/**
 * Split a rand total across checkout lines so the parts add up to the total
 * exactly (to the cent). `countOrWeights` is the number of lines for an even
 * split, or one weight per line in rands (e.g. each line's amount) for a
 * proportional split. Replaces round(total / n), which drifts by a cent.
 */
export function splitAcrossLines(totalRands: number, countOrWeights: number | readonly number[]): number[] {
  const weights = typeof countOrWeights === 'number'
    ? Array.from({ length: countOrWeights }, () => 1)
    : countOrWeights.map((w) => toCents(w));
  if (weights.length === 0) return [];
  const usable = weights.some((w) => w > 0) ? weights : weights.map(() => 1);
  return allocateCents(toCents(totalRands), usable).map(fromCents);
}

/**
 * Refundable deposit for one unit, in rands.
 *
 * Founder decision 2026-10-08: the deposit is 25% of the item's replacement
 * value (RENTAL_POLICY.depositRateBps). Listings that do not yet record a
 * replacement value keep their stored fixed deposit, so nothing is charged
 * that the owner has not set; those listings should get a replacement value.
 */
export function depositPerUnit(rental: { deposit_amount?: number | null; replacement_value?: number | null }): number {
  const replacement = Number(rental.replacement_value ?? 0);
  if (replacement > 0) return fromCents(depositFor(toCents(replacement)));
  return Math.max(0, Number(rental.deposit_amount ?? 0));
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
 * Cart totals worked in whole cents, returned in rands (the DB columns and
 * the checkout route use rands). grandTotal = subtotal - discount + deposits;
 * VAT is never added on top.
 */
function cartTotals(pricingItems: CartPricingItem[], totalItemCount: number): {
  subtotal: number;
  totalDeposit: number;
  bulkDiscountPercent: number;
  bulkDiscountAmount: number;
  vatAmount: number;
  grandTotal: number;
} {
  const subtotalCents = pricingItems.reduce((sum, pi) => sum + toCents(pi.subtotal), 0);
  const depositCents = pricingItems.reduce((sum, pi) => sum + toCents(pi.deposit), 0);
  const bulkDiscountPercent = getBulkDiscountPercent(totalItemCount);
  const discountCents = bpsOf(subtotalCents, percentToBps(bulkDiscountPercent));
  const hireCents = subtotalCents - discountCents;
  return {
    subtotal: fromCents(subtotalCents),
    totalDeposit: fromCents(depositCents),
    bulkDiscountPercent,
    bulkDiscountAmount: fromCents(discountCents),
    vatAmount: fromCents(vatOnInclusive(hireCents, vatRateAt())),
    grandTotal: fromCents(hireCents + depositCents),
  };
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
      vatRate: currentVatRate(),
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
    const deposit = depositPerUnit(item.rental) * item.quantity;

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

  const { subtotal, totalDeposit, bulkDiscountPercent, bulkDiscountAmount, vatAmount, grandTotal } =
    cartTotals(pricingItems, totalItemCount);

  return {
    items: pricingItems,
    itemCount: totalItemCount,
    dayCount: days,
    subtotal,
    bulkDiscountPercent,
    bulkDiscountAmount,
    totalDeposit,
    vatRate: currentVatRate(),
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
      vatRate: currentVatRate(),
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
    const deposit = depositPerUnit(item.rental) * item.quantity;

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

  const { subtotal, totalDeposit, bulkDiscountPercent, bulkDiscountAmount, vatAmount, grandTotal } =
    cartTotals(pricingItems, totalItemCount);

  return {
    items: pricingItems,
    itemCount: totalItemCount,
    subtotal,
    bulkDiscountPercent,
    bulkDiscountAmount,
    totalDeposit,
    vatRate: currentVatRate(),
    vatAmount,
    grandTotal,
  };
}
