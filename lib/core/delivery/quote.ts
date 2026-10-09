/**
 * Customer delivery quotes (spec Phase 4 §4.7). Pure, integer cents.
 *
 * What the provider charges us and what the customer pays are stored apart:
 *   customer fee = provider cost + approved platform fee (own fleet: no fee,
 *   the own-vehicle formula already is the customer price).
 * Each leg (outbound, return) has its own quote. A quote expires; an expired
 * quote is never charged silently: a new quote is taken and, if the total
 * changed, the customer approves it again (D07). The browser never sends a
 * price: the server reads the stored quote (D08). Delivery money is never
 * part of the owner's hire share.
 */

import { DELIVERY_POLICY } from '@/lib/constants';
import { assertCents } from '@/lib/core/pricing/money';
import { splitHire } from '@/lib/core/pricing/rental';
import type { DeliveryWindow, ProviderQuote } from './port';
import type { ShipmentLeg } from './state';

export type QuoteStatus = 'active' | 'paid' | 'consumed' | 'expired' | 'superseded';

export interface CustomerDeliveryQuote {
  id: string;
  renterId: string;
  bookingGroupId: string | null;
  leg: ShipmentLeg;
  providerId: string;
  providerKind: 'courier' | 'own_fleet';
  providerQuoteRef: string | null;
  /** What the provider quoted us (quote_amount_cents). */
  quoteAmountCents: number;
  /** What we expect to pay the provider: equal to the quote at this point. */
  providerCostCents: number;
  platformFeeCents: number;
  /** What the customer pays for this leg. */
  customerFeeCents: number;
  /** Total replacement value of the items on the leg (never shown to drivers). */
  replacementValueCents: number;
  /** Equipment booking lines and listings on the leg. */
  bookingIds: string[];
  rentalIds: string[];
  /** Verified addresses (delivery_addresses ids), never raw text from the browser. */
  originAddressId: string;
  destinationAddressId: string;
  window: DeliveryWindow;
  expiresAt: string;
  status: QuoteStatus;
  /** Payment reference that captured this fee, once paid. */
  paidReference: string | null;
  createdAt: string;
}

export interface QuotePricing {
  quoteAmountCents: number;
  providerCostCents: number;
  platformFeeCents: number;
  customerFeeCents: number;
  expiresAt: string;
}

/** Price one leg from a provider quote. */
export function priceDeliveryQuote(p: {
  providerQuote: ProviderQuote;
  providerKind: 'courier' | 'own_fleet';
  now: Date;
  platformFeeCents?: number;
  ttlMinutes?: number;
}): QuotePricing {
  const cost = p.providerQuote.providerCostCents;
  assertCents(cost, 'providerCostCents');
  if (cost < 0) throw new RangeError('provider cost cannot be negative');
  const fee = p.providerKind === 'own_fleet' ? 0 : (p.platformFeeCents ?? DELIVERY_POLICY.platformFeeCents);
  assertCents(fee, 'platformFeeCents');
  if (fee < 0) throw new RangeError('platform fee cannot be negative');
  const ttl = p.ttlMinutes ?? DELIVERY_POLICY.quoteTtlMinutes;
  const ours = p.now.getTime() + ttl * 60_000;
  const theirs = new Date(p.providerQuote.expiresAt).getTime();
  // The customer price can never outlive the provider's price.
  const expires = Number.isNaN(theirs) ? ours : Math.min(ours, theirs);
  return {
    quoteAmountCents: cost,
    providerCostCents: cost,
    platformFeeCents: fee,
    customerFeeCents: cost + fee,
    expiresAt: new Date(expires).toISOString(),
  };
}

export function quoteIsLive(q: Pick<CustomerDeliveryQuote, 'expiresAt'>, now: Date): boolean {
  return new Date(q.expiresAt).getTime() > now.getTime();
}

export type ChargeCheck =
  | { ok: true; amountCents: number }
  | { ok: false; code: 'quote_not_found' | 'quote_not_active' | 'quote_expired' | 'wrong_renter' | 'price_mismatch'; message: string };

/**
 * Whether these stored quotes may be charged now, and for how much. The
 * amount always comes from the stored quotes. `browserAmountCents`, when a
 * client sends one, is only compared: a different number is refused, never
 * used (D08). An expired quote is refused (D07): take a new quote and ask the
 * customer to approve the new total.
 */
export function checkQuotesForCharge(p: {
  quotes: readonly (CustomerDeliveryQuote | null)[];
  renterId: string;
  now: Date;
  browserAmountCents?: number | null;
}): ChargeCheck {
  let total = 0;
  for (const q of p.quotes) {
    if (!q) return { ok: false, code: 'quote_not_found', message: 'That delivery quote does not exist. Please get a new quote.' };
    if (q.renterId !== p.renterId) return { ok: false, code: 'wrong_renter', message: 'That delivery quote belongs to someone else.' };
    if (q.status !== 'active') return { ok: false, code: 'quote_not_active', message: 'That delivery quote has already been used or replaced.' };
    if (!quoteIsLive(q, p.now)) return { ok: false, code: 'quote_expired', message: 'Your delivery quote has expired. Please get a new quote and confirm the price.' };
    total += q.customerFeeCents;
  }
  if (p.browserAmountCents !== undefined && p.browserAmountCents !== null && p.browserAmountCents !== total) {
    return { ok: false, code: 'price_mismatch', message: 'The delivery price changed. Please review the new total.' };
  }
  return { ok: true, amountCents: total };
}

/** After a requote: the customer must approve again when the price moved (either way). */
export function requoteNeedsApproval(approvedCents: number, fresh: Pick<CustomerDeliveryQuote, 'customerFeeCents'>): boolean {
  return approvedCents !== fresh.customerFeeCents;
}

/**
 * The order's money with delivery kept apart from the hire: the owner's share
 * is worked out on the hire alone (spec §4.7).
 */
export function orderMoneyWithDelivery(p: {
  netHireCents: number;
  ownership: 'studio' | 'community';
  deliveryQuotes: readonly Pick<CustomerDeliveryQuote, 'customerFeeCents' | 'providerCostCents' | 'platformFeeCents'>[];
}): { ownerShareCents: number; platformShareCents: number; deliveryCustomerCents: number; deliveryProviderCostCents: number; deliveryPlatformFeeCents: number } {
  const split = p.ownership === 'community' ? splitHire(p.netHireCents) : { ownerShareCents: 0, platformShareCents: p.netHireCents };
  let c = 0;
  let pc = 0;
  let pf = 0;
  for (const q of p.deliveryQuotes) {
    c += q.customerFeeCents;
    pc += q.providerCostCents;
    pf += q.platformFeeCents;
  }
  return { ...split, deliveryCustomerCents: c, deliveryProviderCostCents: pc, deliveryPlatformFeeCents: pf };
}
