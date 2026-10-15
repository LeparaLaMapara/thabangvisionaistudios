import { ROLES_POLICY } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import type { PricingUnit, SuggestedPrice } from './types';

/**
 * Fixed, clear prices per role and unit. Pure.
 *
 * The maker pre-fills the role's typical price. The person may move it, but
 * only inside the role's low..high band, so a client always sees a fair,
 * comparable price before paying.
 */

export function clampPrice(cents: number, band: SuggestedPrice): number {
  if (!Number.isFinite(cents)) return band.typical;
  return Math.min(Math.max(Math.round(cents), band.low), band.high);
}

/** Per-km price for day_plus_km: within 50% to 200% of the suggested rate. */
export function clampPerKm(cents: number, band: SuggestedPrice): number | null {
  if (band.per_km === undefined) return null;
  if (!Number.isFinite(cents)) return band.per_km;
  const low = Math.floor(band.per_km / 2);
  const high = band.per_km * 2;
  return Math.min(Math.max(Math.round(cents), low), high);
}

export function unitLabel(unit: PricingUnit): string {
  return ROLES_POLICY.pricing.unitLabels[unit];
}

const rand = (cents: number): string => {
  const r = cents / 100;
  return formatRand(r, { decimals: !Number.isInteger(r) });
};

/** "R650 a look", "R1 800 a day + R6 a km" (the site's one price format, lib/format/money). */
export function formatRolePrice(unit: PricingUnit, priceCents: number, perKmCents?: number | null): string {
  const base = `${rand(priceCents)} ${unitLabel(unit)}`;
  if (unit === 'day_plus_km' && perKmCents !== null && perKmCents !== undefined) {
    return `${base} + ${rand(perKmCents)} ${ROLES_POLICY.pricing.perKmLabel}`;
  }
  return base;
}

/** Rands typed by a person ("650", "R1 800", "1800.50") to cents, or null. */
export function randsToCents(input: string): number | null {
  const cleaned = input.replace(/[Rr\s,]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** The unit a person charges in: their own, else the role's (092). */
export function effectiveUnit(roleUnit: PricingUnit, personUnit: PricingUnit | null | undefined): PricingUnit {
  return personUnit ?? roleUnit;
}

export interface BookingTotal {
  totalCents: number;
  /** How many units were counted (days, hours or 1). */
  quantity: number;
  /** "R1 800 x 2 days". */
  label: string;
}

const DAY_UNITS: readonly PricingUnit[] = ['day', 'half_day', 'day_plus_km'];

/** Whether the client picks dates (days) or hours for this unit. */
export function pricedByDays(unit: PricingUnit): boolean {
  return DAY_UNITS.includes(unit);
}

/**
 * One price, shown before booking, like Rentals: rate x days for day units,
 * rate x hours for an hourly person, the rate once for a look or a project.
 * Kilometres for day_plus_km are added when the trip is known, not here.
 */
export function bookingTotal(unit: PricingUnit, priceCents: number, input: { days?: number; hours?: number }): BookingTotal {
  const days = Math.max(1, Math.min(31, Math.floor(input.days ?? 1)));
  const hours = Math.max(0.5, Math.min(24, Math.round((input.hours ?? 1) * 2) / 2));
  const price = Math.max(0, Math.round(priceCents));
  if (pricedByDays(unit)) {
    return { totalCents: price * days, quantity: days, label: `${rand(price)} x ${days} day${days === 1 ? '' : 's'}` };
  }
  if (unit === 'hour') {
    return { totalCents: Math.round(price * hours), quantity: hours, label: `${rand(price)} x ${hours} hour${hours === 1 ? '' : 's'}` };
  }
  return { totalCents: price, quantity: 1, label: `${rand(price)} ${unitLabel(unit)}` };
}

export function formatRands(cents: number): string {
  return rand(cents);
}
