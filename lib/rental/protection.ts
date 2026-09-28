import { STUDIO } from '@/lib/constants';

/**
 * Gear protection (TASK-067). Pure rules, tested directly; the routes load the
 * numbers from the database and call these.
 *
 * Apple's answer to phone theft was to make theft pointless and keep the
 * security out of honest people's way. Here: a renter starts with a modest
 * limit that rises with every clean return, first and large hires are handed
 * over in person, and every serial-registered item says so.
 */

export interface TrustTier {
  cleanReturns: number;
  maxValue: number;
  label: string;
}

const tiers = (): readonly TrustTier[] => STUDIO.rental.protection.trustTiers;

/** Replacement value of one listing: its recorded value, or its deposit. */
export function itemValue(item: { replacement_value?: number | null; deposit_amount?: number | null }): number {
  const v = Number(item.replacement_value ?? 0);
  return v > 0 ? v : Math.max(0, Number(item.deposit_amount ?? 0));
}

/** The highest tier this renter has reached. */
export function tierFor(cleanReturns: number): TrustTier {
  const reached = tiers().filter((t) => cleanReturns >= t.cleanReturns);
  return reached[reached.length - 1] ?? tiers()[0];
}

/** The next tier up, if any, for "your limit rises after..." wording. */
export function nextTier(cleanReturns: number): TrustTier | null {
  return tiers().find((t) => t.cleanReturns > cleanReturns) ?? null;
}

const rand = (n: number): string => `${STUDIO.currency.symbol}${Math.round(n).toLocaleString(STUDIO.currency.locale)}`;

export type ProtectionResult =
  | { ok: true; tier: TrustTier }
  | { ok: false; code: 'trust_limit' | 'collection_only'; message: string; tier: TrustTier };

/**
 * Whether this order may go ahead.
 *
 * @param cleanReturns  hires this renter completed without a dispute
 * @param alreadyOut    value of their other gear booked or out right now
 * @param orderValue    value of the gear in this order
 * @param delivery      whether they asked for delivery
 */
export function checkProtection(params: {
  cleanReturns: number;
  alreadyOut: number;
  orderValue: number;
  delivery: boolean;
}): ProtectionResult {
  const tier = tierFor(params.cleanReturns);
  const total = params.alreadyOut + params.orderValue;

  if (total > tier.maxValue) {
    const next = nextTier(params.cleanReturns);
    const out = params.alreadyOut > 0 ? ` (including ${rand(params.alreadyOut)} of gear you already have booked)` : '';
    const rise = next
      ? ` After ${next.cleanReturns - params.cleanReturns} more on-time return${next.cleanReturns - params.cleanReturns === 1 ? '' : 's'} your limit rises to ${rand(next.maxValue)}.`
      : '';
    return {
      ok: false,
      code: 'trust_limit',
      tier,
      message: `As a ${tier.label.toLowerCase()} you can hire up to ${rand(tier.maxValue)} of gear at a time. This order comes to ${rand(total)}${out}.${rise} For a bigger hire, contact us and we will arrange it with you.`,
    };
  }

  const p = STUDIO.rental.protection;
  if (params.delivery) {
    if (p.firstRentalCollectionOnly && params.cleanReturns === 0) {
      return {
        ok: false,
        code: 'collection_only',
        tier,
        message: 'Your first hire is collected in person, so we can hand the gear over and check it with you. Delivery opens after your first return.',
      };
    }
    if (params.orderValue > p.collectionOnlyAboveValue) {
      return {
        ok: false,
        code: 'collection_only',
        tier,
        message: `Orders over ${rand(p.collectionOnlyAboveValue)} of gear are collected in person. Please choose collection.`,
      };
    }
  }

  return { ok: true, tier };
}

/** The line shown on a listing: only what is actually true of that item. */
export function protectionLine(item: { serial_number?: string | null; tracker_fitted?: boolean | null }): string | null {
  const serial = Boolean(item.serial_number && item.serial_number.trim());
  if (serial && item.tracker_fitted) return 'Serial-registered and tracked. A stolen item can be traced and cannot be resold legally.';
  if (serial) return 'Serial-registered. A stolen item can be traced and cannot be resold legally.';
  return null;
}
