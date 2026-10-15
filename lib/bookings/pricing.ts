/**
 * The price of a service booking, computed the same way on the page, in the
 * form and in the API (which never trusts a price sent by the browser).
 *
 * Two kinds of booking:
 * - hourly: a type of shoot at its hourly rate, times the hours;
 * - package: a studio package at its own price ("Family Birthday, R1 500 per
 *   project"). The studio page used to show the package price and then send
 *   people to a form that charged by the hour, so the price changed on the way.
 *
 * VAT comes from the tax core (lib/core/pricing/tax.ts). The company is not
 * VAT-registered, so vat is 0 and total = subtotal = the advertised price.
 * After a dated registration, advertised prices are treated as VAT-inclusive:
 * VAT is carved out of the same total (subtotal = total - vat), so a
 * customer's price never rises. Money is whole rands, as elsewhere in bookings.
 */
import { priceWithVat, type TaxConfig } from '@/lib/core/pricing/tax';
import { toCents } from '@/lib/core/pricing/money';
import { rateWords } from '@/lib/format/money';

/** When the sale happens and (for tests) which tax config to apply. */
export interface QuoteOptions {
  at?: Date;
  tax?: TaxConfig;
}

export type PackageUnit = 'project' | 'session' | 'event' | 'hour';

export interface ServiceQuote {
  basis: 'hourly' | 'package';
  /** One line describing what is being charged, e.g. "R1 500 per project". */
  line: string;
  /** The price before VAT. Equals total while not VAT-registered. */
  subtotal: number;
  /** VAT within the total. 0 while not VAT-registered. */
  vat: number;
  /** What the customer pays: always the advertised price. */
  total: number;
}

// Plain spaces as thousands separators (en-ZA uses a non-breaking space).
const rand = (n: number): string => `R${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

/** "an hour", "a session", "an event", else "a project" (lib/format/money rateWords). */
export function packageUnitWords(unit: string): string {
  return rateWords(unit === 'hour' || unit === 'session' || unit === 'event' ? unit : 'project');
}

/**
 * Whole-rand customer price with any VAT broken out. VAT is rounded to the
 * rand, like every other booking amount, and subtotal + vat = total.
 */
export function serviceVat(price: number, opts: QuoteOptions = {}): { subtotal: number; vat: number; total: number } {
  const b = priceWithVat(toCents(Math.round(price)), opts.at, opts.tax);
  const total = Math.round(b.grossCents / 100);
  const vat = Math.round(b.vatCents / 100);
  return { subtotal: total - vat, vat, total };
}

/**
 * @param _legacyVatRate Ignored. Kept so existing callers that still pass
 *   STUDIO.booking.vatRate keep compiling; the rate now comes from the tax
 *   core, which is 0 while the company is not VAT-registered.
 */
export function quoteHourly(rate: number, hours: number, _legacyVatRate?: number, opts?: QuoteOptions): ServiceQuote {
  return { basis: 'hourly', line: `${rand(rate)} an hour × ${hours} hours`, ...serviceVat(Math.round(rate * hours), opts) };
}

/**
 * A package: its fixed price, or its hourly price times the hours when priced per hour.
 * @param _legacyVatRate Ignored; see quoteHourly.
 */
export function quotePackage(price: number, unit: string, hours: number, _legacyVatRate?: number, opts?: QuoteOptions): ServiceQuote {
  const perHour = unit === 'hour';
  const amount = Math.round(perHour ? price * hours : price);
  const line = perHour ? `${rand(price)} an hour × ${hours} hours` : `${rand(price)} ${packageUnitWords(unit)}`;
  return { basis: 'package', line, ...serviceVat(amount, opts) };
}

/**
 * Splits a service booking between the creator and us.
 *
 * Commission is taken from the price before VAT (quote.subtotal). While the
 * company is not VAT-registered, vat is 0 and subtotal is the whole price.
 * After a registration any VAT is ours to pay to SARS; it is never part of
 * the creator's share.
 *
 * platformAmount is the commission only; subtotal + vat = total, and
 * creatorAmount + platformAmount = subtotal.
 */
export function splitServiceBooking(
  quote: { subtotal: number },
  commissionPercent: number,
): { platformAmount: number; creatorAmount: number } {
  const platformAmount = Math.round(quote.subtotal * (commissionPercent / 100));
  return { platformAmount, creatorAmount: quote.subtotal - platformAmount };
}
