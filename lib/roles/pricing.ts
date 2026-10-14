import { ROLES_POLICY } from '@/lib/constants';
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
  return `R${(Number.isInteger(r) ? r : Number(r.toFixed(2))).toLocaleString('en-ZA')}`;
};

/** "R650 per look", "R1 800 per day + R6 per km". */
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
