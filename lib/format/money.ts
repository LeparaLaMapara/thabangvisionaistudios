import { STUDIO, PRODUCTION_SERVICES } from '@/lib/constants';

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

/** The VAT rate on services, from constants (never typed in). */
export const SERVICE_VAT_RATE = PRODUCTION_SERVICES.billing.vatRate;

/**
 * A service amount stored or quoted excluding VAT, shown to the customer
 * including VAT. Rounded the same way calculatePackagePrice rounds VAT, so a
 * package shows the same total everywhere. Display only: what is charged is
 * worked out in lib/bookings/pricing.ts and the API routes.
 */
export function withServiceVat(amountExclVat: number): number {
  return amountExclVat + Math.round(amountExclVat * (SERVICE_VAT_RATE / 100));
}
