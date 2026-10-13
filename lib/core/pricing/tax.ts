import { STUDIO } from '@/lib/constants';
import { assertCents } from './money';

/**
 * VAT, as one dated rule. Pure apart from reading the config in
 * STUDIO.legal (no Supabase, Next.js or provider imports).
 *
 * Founder decision 2026-10-08: the company is NOT a registered VAT vendor, so
 * the rate is 0 everywhere and no VAT is added, shown or "included".
 *
 * Future registration is a config change: set vatRegistered, a
 * vatEffectiveFrom date and keep (or explicitly change) pricesIncludeVat.
 * With pricesIncludeVat = true, advertised prices are treated as
 * VAT-inclusive: VAT is carved out of the same customer total, so
 * registering never raises what a customer pays.
 */

export interface TaxConfig {
  vatRegistered: boolean;
  /** Percentage, e.g. 15. */
  vatRatePercent: number;
  /** ISO date (YYYY-MM-DD or full timestamp) registration takes effect, or null. */
  vatEffectiveFrom: string | null;
  /** Advertised prices already include VAT (customer totals never rise). */
  pricesIncludeVat: boolean;
}

export function currentTaxConfig(): TaxConfig {
  return {
    vatRegistered: STUDIO.legal.vatRegistered,
    vatRatePercent: STUDIO.legal.tax.vatRate,
    vatEffectiveFrom: STUDIO.legal.tax.vatEffectiveFrom,
    pricesIncludeVat: STUDIO.legal.tax.pricesIncludeVat,
  };
}

/** A date-only effective date starts at midnight South African time. */
function effectiveInstant(value: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+02:00` : value;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new RangeError(`Invalid vatEffectiveFrom: ${value}`);
  return t;
}

/**
 * The VAT rate, as a percentage, for a sale made at `at`. 0 when not
 * registered, when no effective date is set, or before the effective date.
 */
export function vatRateAt(at: Date = new Date(), cfg: TaxConfig = currentTaxConfig()): number {
  if (!cfg.vatRegistered) return 0;
  if (!cfg.vatEffectiveFrom) return 0;
  if (at.getTime() < effectiveInstant(cfg.vatEffectiveFrom)) return 0;
  return cfg.vatRatePercent;
}

/** Whether VAT applies to a sale at `at` (drives any VAT line or wording). */
export function vatAppliesAt(at: Date = new Date(), cfg: TaxConfig = currentTaxConfig()): boolean {
  return vatRateAt(at, cfg) > 0;
}

/** VAT contained in a VAT-inclusive amount: gross × r / (100 + r), to the cent. */
export function vatOnInclusive(grossCents: number, ratePercent: number): number {
  assertCents(grossCents, 'grossCents');
  if (ratePercent <= 0) return 0;
  return Math.round((grossCents * ratePercent) / (100 + ratePercent));
}

/** VAT on a VAT-exclusive amount: net × r / 100, to the cent. */
export function vatOnExclusive(netCents: number, ratePercent: number): number {
  assertCents(netCents, 'netCents');
  if (ratePercent <= 0) return 0;
  return Math.round((netCents * ratePercent) / 100);
}

export interface VatBreakdown {
  ratePercent: number;
  netCents: number;
  vatCents: number;
  /** What the customer pays. */
  grossCents: number;
}

/**
 * The customer price for an advertised amount, with any VAT broken out.
 *
 * - Not registered (today): gross = amount, vat = 0.
 * - Registered, pricesIncludeVat (the default): gross = amount, VAT carved out.
 * - Registered, pricesIncludeVat explicitly false: VAT added on top. Only an
 *   explicit config change can reach this branch.
 */
export function priceWithVat(
  amountCents: number,
  at: Date = new Date(),
  cfg: TaxConfig = currentTaxConfig(),
): VatBreakdown {
  assertCents(amountCents, 'amountCents');
  const ratePercent = vatRateAt(at, cfg);
  if (ratePercent === 0) {
    return { ratePercent: 0, netCents: amountCents, vatCents: 0, grossCents: amountCents };
  }
  if (cfg.pricesIncludeVat) {
    const vatCents = vatOnInclusive(amountCents, ratePercent);
    return { ratePercent, netCents: amountCents - vatCents, vatCents, grossCents: amountCents };
  }
  const vatCents = vatOnExclusive(amountCents, ratePercent);
  return { ratePercent, netCents: amountCents, vatCents, grossCents: amountCents + vatCents };
}
