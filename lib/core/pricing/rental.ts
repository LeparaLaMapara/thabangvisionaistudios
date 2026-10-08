import { RENTAL_POLICY } from '@/lib/constants';
import { allocateCents, assertCents, bpsOf, sumCents } from './money';

/**
 * Gear-hire quotes in integer cents. Pure: no Supabase, Next.js or provider
 * imports; the only input besides the arguments is RENTAL_POLICY.
 *
 * - Hire: whole weeks at the weekly rate (when there is one and the hire is
 *   7 days or more) plus the remaining days at the daily rate.
 * - Discount: basis points of the hire.
 * - Deposit: RENTAL_POLICY.depositRateBps of the replacement value. Refundable
 *   and never revenue, so it is outside the owner/platform split.
 * - Split: hire after discount, owner/platform by RENTAL_POLICY shares, via
 *   largest-remainder so owner + platform == hire after discount exactly.
 */

export interface RentalPolicyMoney {
  depositRateBps: number;
  ownerShareBps: number;
  platformShareBps: number;
}

export interface RentalQuoteInput {
  dailyRateCents: number;
  weeklyRateCents?: number | null;
  days: number;
  replacementValueCents: number;
  quantity?: number;
  discountBps?: number;
}

export interface RentalQuote {
  /** Hire before discount. */
  hireCents: number;
  discountCents: number;
  depositCents: number;
  /** Hire after discount + deposit: what the customer pays now. */
  totalCents: number;
  ownerShareCents: number;
  platformShareCents: number;
}

function policyOrDefault(policy?: RentalPolicyMoney): RentalPolicyMoney {
  const p = policy ?? RENTAL_POLICY;
  if (p.ownerShareBps + p.platformShareBps !== 10000) {
    throw new RangeError('Owner and platform shares must add up to 10 000 bps');
  }
  return p;
}

/** Hire for one unit over `days`, weekly rate for whole weeks when given. */
export function hireCents(dailyRateCents: number, weeklyRateCents: number | null | undefined, days: number): number {
  assertCents(dailyRateCents, 'dailyRateCents');
  if (!Number.isSafeInteger(days) || days <= 0) throw new RangeError(`days must be a positive whole number (got ${days})`);
  if (weeklyRateCents != null && weeklyRateCents > 0 && days >= 7) {
    assertCents(weeklyRateCents, 'weeklyRateCents');
    const weeks = Math.floor(days / 7);
    return weeks * weeklyRateCents + (days % 7) * dailyRateCents;
  }
  return days * dailyRateCents;
}

/** Split hire-after-discount between owner and platform; parts sum exactly. */
export function splitHire(netHireCents: number, policy?: RentalPolicyMoney): { ownerShareCents: number; platformShareCents: number } {
  const p = policyOrDefault(policy);
  const [ownerShareCents, platformShareCents] = allocateCents(netHireCents, [p.ownerShareBps, p.platformShareBps]);
  return { ownerShareCents, platformShareCents };
}

export function depositFor(replacementValueCents: number, policy?: RentalPolicyMoney): number {
  assertCents(replacementValueCents, 'replacementValueCents');
  if (replacementValueCents < 0) throw new RangeError('replacementValueCents must not be negative');
  return bpsOf(replacementValueCents, policyOrDefault(policy).depositRateBps);
}

export function quoteRental(input: RentalQuoteInput, policy?: RentalPolicyMoney): RentalQuote {
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError(`quantity must be a positive whole number (got ${quantity})`);
  const discountBps = input.discountBps ?? 0;
  if (!Number.isSafeInteger(discountBps) || discountBps < 0 || discountBps > 10000) {
    throw new RangeError(`discountBps must be 0–10 000 (got ${discountBps})`);
  }

  const hire = hireCents(input.dailyRateCents, input.weeklyRateCents, input.days) * quantity;
  const discountCents = bpsOf(hire, discountBps);
  const depositCents = depositFor(input.replacementValueCents, policy) * quantity;
  const net = hire - discountCents;
  const { ownerShareCents, platformShareCents } = splitHire(net, policy);

  return {
    hireCents: hire,
    discountCents,
    depositCents,
    totalCents: net + depositCents,
    ownerShareCents,
    platformShareCents,
  };
}

export interface RentalBasketQuote extends RentalQuote {
  lines: RentalQuote[];
}

/**
 * Several items under one basket-level discount. The discount is worked out
 * on the basket hire, then allocated across lines in proportion to each
 * line's hire, so line discounts add up to the basket discount exactly.
 * Each line is split owner/platform separately (lines can have different
 * owners); the basket totals are the exact sums of the lines.
 */
export function quoteRentalBasket(
  items: readonly Omit<RentalQuoteInput, 'discountBps'>[],
  discountBps = 0,
  policy?: RentalPolicyMoney,
): RentalBasketQuote {
  if (items.length === 0) {
    return { lines: [], hireCents: 0, discountCents: 0, depositCents: 0, totalCents: 0, ownerShareCents: 0, platformShareCents: 0 };
  }
  const base = items.map((item) => quoteRental({ ...item, discountBps: 0 }, policy));
  const basketHire = sumCents(base.map((l) => l.hireCents));
  const basketDiscount = bpsOf(basketHire, discountBps);
  const lineDiscounts = basketHire > 0
    ? allocateCents(basketDiscount, base.map((l) => l.hireCents))
    : base.map(() => 0);

  const lines: RentalQuote[] = base.map((l, i) => {
    const discountCents = lineDiscounts[i];
    const net = l.hireCents - discountCents;
    const split = splitHire(net, policy);
    return {
      hireCents: l.hireCents,
      discountCents,
      depositCents: l.depositCents,
      totalCents: net + l.depositCents,
      ...split,
    };
  });

  return {
    lines,
    hireCents: basketHire,
    discountCents: basketDiscount,
    depositCents: sumCents(lines.map((l) => l.depositCents)),
    totalCents: sumCents(lines.map((l) => l.totalCents)),
    ownerShareCents: sumCents(lines.map((l) => l.ownerShareCents)),
    platformShareCents: sumCents(lines.map((l) => l.platformShareCents)),
  };
}
