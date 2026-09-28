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
 * Service prices exclude VAT; VAT is added on top (see the merchant-of-record
 * note in lib/constants.ts). Money is whole rands, as elsewhere in bookings.
 */
export type PackageUnit = 'project' | 'session' | 'event' | 'hour';

export interface ServiceQuote {
  basis: 'hourly' | 'package';
  /** One line describing what is being charged, e.g. "R1 500 per project". */
  line: string;
  subtotal: number;
  vat: number;
  total: number;
}

// Plain spaces as thousands separators (en-ZA uses a non-breaking space).
const rand = (n: number): string => `R${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

export function packageUnitWords(unit: string): string {
  switch (unit) {
    case 'hour': return 'per hour';
    case 'session': return 'per session';
    case 'event': return 'per event';
    default: return 'per project';
  }
}

function withVat(subtotal: number, vatRate: number): { subtotal: number; vat: number; total: number } {
  const vat = Math.round(subtotal * (vatRate / 100));
  return { subtotal, vat, total: subtotal + vat };
}

export function quoteHourly(rate: number, hours: number, vatRate: number): ServiceQuote {
  return { basis: 'hourly', line: `${rand(rate)}/hr × ${hours}hrs`, ...withVat(Math.round(rate * hours), vatRate) };
}

/** A package: its fixed price, or its hourly price times the hours when priced per hour. */
export function quotePackage(price: number, unit: string, hours: number, vatRate: number): ServiceQuote {
  const perHour = unit === 'hour';
  const subtotal = Math.round(perHour ? price * hours : price);
  const line = perHour ? `${rand(price)}/hr × ${hours}hrs` : `${rand(price)} ${packageUnitWords(unit)}`;
  return { basis: 'package', line, ...withVat(subtotal, vatRate) };
}

/**
 * Splits a service booking between the creator and us.
 *
 * Commission is taken from the price before VAT. We are the seller, so all of
 * the VAT is ours to pay to SARS; it is never part of the creator's share.
 * Until 2026-09-28 commission was taken from the VAT-inclusive total, so the
 * creator received 85% of the VAT as well and we kept about 2% of a booking
 * instead of 15%.
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
