import { STUDIO } from '@/lib/constants';
import { priceWithVat, vatRateAt } from '@/lib/core/pricing/tax';
import { fromCents, toCents } from '@/lib/core/pricing/money';

/**
 * One way to write a customer price: "R1 300". The rand symbol, no "ZAR", and
 * a space between thousands (a non-breaking one, so a price never wraps
 * across two lines). Written by hand rather than with toLocaleString so the
 * server and the browser always print exactly the same text.
 *
 * Stored currency codes are untouched; this is display only.
 */
export function formatRand(amount: number, opts?: { decimals?: boolean }): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const fixed = opts?.decimals ? abs.toFixed(2) : String(Math.round(abs));
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${negative ? '-' : ''}${STUDIO.currency.symbol}${grouped}${cents ? `.${cents}` : ''}`;
}

/** What a price is for. Every unit a customer price is quoted in on the site. */
export type RateUnit =
  | 'hour'
  | 'day'
  | 'week'
  | 'half_day'
  | 'full_day'
  | 'look'
  | 'session'
  | 'event'
  | 'project'
  | 'day_plus_km'
  | 'km';

const RATE_WORDS: Record<RateUnit, string> = {
  hour: 'an hour',
  day: 'a day',
  week: 'a week',
  half_day: 'a half day',
  full_day: 'a full day',
  look: 'a look',
  session: 'a session',
  event: 'an event',
  project: 'a project',
  // The day rate; the per-km part is quoted on its own ("+ R6 a km").
  day_plus_km: 'a day',
  km: 'a km',
};

/** "a day", "an hour": the words after a price. Unknown units read "a project". */
export function rateWords(unit: string): string {
  return RATE_WORDS[unit as RateUnit] ?? RATE_WORDS.project;
}

/**
 * One way to write a price with its unit, everywhere (pages, cards, emails
 * and the Ubunye prompt): "R1 300 a day", "R900 an hour". Built on
 * formatRand, so the thousands space never wraps.
 */
export function formatRate(amount: number, unit: RateUnit | string, opts?: { decimals?: boolean }): string {
  return `${formatRand(amount, opts)} ${rateWords(unit)}`;
}

/**
 * The VAT rate (percent) on services right now, from the tax core: 0 while
 * the company is not VAT-registered. Evaluated at module load; use
 * vatRateAt() from lib/core/pricing/tax for a rate at a specific date.
 */
export const SERVICE_VAT_RATE = vatRateAt();

/**
 * The customer price of a service amount. The name is historical: VAT used
 * to be added on top. Now the advertised amount IS the customer price: while
 * not VAT-registered nothing is added, and after a registration prices are
 * treated as VAT-inclusive, so this returns the amount unchanged unless the
 * tax config explicitly says prices exclude VAT. Display only: what is
 * charged is worked out in lib/bookings/pricing.ts and the API routes.
 */
export function withServiceVat(amountExclVat: number): number {
  return fromCents(priceWithVat(toCents(amountExclVat)).grossCents);
}
