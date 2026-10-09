/**
 * What a payment or payout adapter can actually do (spec §8.4). Capabilities
 * describe the adapter as implemented and verified here, not a provider's
 * marketing: a feature the adapter does not call is `false` even if the
 * provider offers it. Pure: no provider, Supabase or Next.js imports.
 */

export interface PaymentCapabilities {
  /** Hosted card checkout. */
  cardPayments: boolean;
  /** A refund for less than the charge. */
  partialRefunds: boolean;
  /** Authorise now, capture later (a held deposit). */
  cardPreauthorisation: boolean;
  /** Stored-card or subscription billing. */
  recurringPayments: boolean;
  /** Server-side lookup of a charge by our reference. */
  chargeVerification: boolean;
  /** Listing the refunds held for a charge (reconcile before any resend). */
  refundLookup: boolean;
  currencies: readonly string[];
  countries: readonly string[];
}

export interface PayoutCapabilities {
  /** Ordinary bank transfers to a validated recipient. */
  bankTransfers: boolean;
  /** Real-time rails (PayShap, RTC). Off until verified with a real agreement (spec §8.5). */
  instantTransfers: boolean;
  /** Lookup of a transfer by our stable reference. */
  transferVerification: boolean;
  currencies: readonly string[];
  countries: readonly string[];
}

export type PaymentNeed = keyof Omit<PaymentCapabilities, 'currencies' | 'countries'>;
export type PayoutNeed = keyof Omit<PayoutCapabilities, 'currencies' | 'countries'>;

export const NO_PAYMENT_CAPABILITIES: PaymentCapabilities = {
  cardPayments: false,
  partialRefunds: false,
  cardPreauthorisation: false,
  recurringPayments: false,
  chargeVerification: false,
  refundLookup: false,
  currencies: [],
  countries: [],
};

export const NO_PAYOUT_CAPABILITIES: PayoutCapabilities = {
  bankTransfers: false,
  instantTransfers: false,
  transferVerification: false,
  currencies: [],
  countries: [],
};

export interface SelectionContext {
  currency: string;
  country: string;
}

export type Selection<T> = { ok: true; adapter: T } | { ok: false; reason: string };

/**
 * The first adapter that can do everything asked, in this currency and
 * country. Order is preference. Business policy never changes with the
 * provider: a missing capability means the action is refused, not done some
 * other way.
 */
export function selectPaymentAdapter<T extends { provider: string; capabilities: PaymentCapabilities }>(
  candidates: readonly T[],
  needs: readonly PaymentNeed[],
  ctx: SelectionContext,
): Selection<T> {
  for (const c of candidates) {
    const cap = c.capabilities;
    if (!cap.currencies.includes(ctx.currency) || !cap.countries.includes(ctx.country)) continue;
    if (needs.every((n) => cap[n])) return { ok: true, adapter: c };
  }
  return { ok: false, reason: `no payment provider supports ${needs.join(', ') || 'payments'} in ${ctx.currency}/${ctx.country}` };
}

export function selectPayoutAdapter<T extends { provider: string; capabilities: PayoutCapabilities }>(
  candidates: readonly T[],
  needs: readonly PayoutNeed[],
  ctx: SelectionContext,
): Selection<T> {
  for (const c of candidates) {
    const cap = c.capabilities;
    if (!cap.currencies.includes(ctx.currency) || !cap.countries.includes(ctx.country)) continue;
    if (needs.every((n) => cap[n])) return { ok: true, adapter: c };
  }
  return { ok: false, reason: `no payout provider supports ${needs.join(', ') || 'payouts'} in ${ctx.currency}/${ctx.country}` };
}

/**
 * Which rail a payout uses. Instant only when the feature flag is on, the
 * adapter has a verified instant rail, and the amount is within the rail's
 * limit; otherwise an ordinary bank transfer. The platform works the same
 * either way (spec §8.5).
 */
export function payoutRail(p: {
  capabilities: PayoutCapabilities;
  instantFlagEnabled: boolean;
  amountCents: number;
  instantLimitCents: number | null;
}): 'instant' | 'standard' {
  if (!p.instantFlagEnabled || !p.capabilities.instantTransfers) return 'standard';
  if (p.instantLimitCents === null || p.amountCents > p.instantLimitCents) return 'standard';
  return 'instant';
}
