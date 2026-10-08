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
