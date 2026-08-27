import { STUDIO } from '@/lib/constants';

/** A cancellation scale: ordered most-notice-first, first match wins. */
export type CancellationTier = {
  readonly minHoursBefore: number;
  readonly refundPercent: number;
};

export interface CancellationQuote {
  /** Whole hours between "now" and the start. Negative once it has begun. */
  hoursBefore: number;
  /** Percentage of the chargeable amount refunded. */
  refundPercent: number;
  /** Portion of the charge refunded. */
  hireRefund: number;
  /** Portion of the charge retained by us. */
  cancellationFee: number;
  /** Security deposit refunded. Always in full — the gear never left. */
  depositRefund: number;
  /** What actually goes back to the customer's card. */
  totalRefund: number;
}

/**
 * Works out what a customer gets back when they cancel.
 *
 * The scale lives in constants so the published policy and the charged amount
 * cannot drift apart. The deposit is excluded from the scale on purpose: it
 * secures equipment against damage and late return, and on a cancellation no
 * equipment was ever handed over, so there is nothing for it to secure.
 *
 * Pure and side-effect free, so it can be unit tested and reused in the UI to
 * show a customer what they will get back before they confirm.
 */
export function calculateCancellationRefund(params: {
  /** Start of the hire, or the shoot date for a service booking. */
  startDate: string | Date;
  /** The chargeable amount paid, excluding any deposit. */
  totalPrice: number;
  /** The security deposit paid. Zero for service bookings. */
  depositAmount: number;
  /** Defaults to STUDIO.rental.cancellationTiers. */
  tiers?: readonly CancellationTier[];
  /** Defaults to now. Injected so tests are deterministic. */
  now?: Date;
}): CancellationQuote {
  const { totalPrice, depositAmount } = params;
  const tiers = params.tiers ?? STUDIO.rental.cancellationTiers;
  const now = params.now ?? new Date();
  const start = params.startDate instanceof Date
    ? params.startDate
    : new Date(params.startDate);

  const msPerHour = 1000 * 60 * 60;
  const hoursBefore = Math.floor((start.getTime() - now.getTime()) / msPerHour);

  const tier = tiers.find((t) => hoursBefore >= t.minHoursBefore);
  const refundPercent = tier?.refundPercent ?? 0;

  const hire = Math.max(0, totalPrice);
  const deposit = Math.max(0, depositAmount);

  const hireRefund = Math.round(hire * (refundPercent / 100) * 100) / 100;
  const cancellationFee = Math.round((hire - hireRefund) * 100) / 100;

  return {
    hoursBefore,
    refundPercent,
    hireRefund,
    cancellationFee,
    depositRefund: deposit,
    totalRefund: Math.round((hireRefund + deposit) * 100) / 100,
  };
}

/**
 * Cancellation quote for a production or creative service booking, measured
 * against the agreed shoot date. No deposit is involved.
 *
 * Returns null when the booking has no shoot date on record — bookings created
 * before migration 040, or through the AI assistant with a free-text date. Those
 * still have to be assessed by a person, because there is no clock to measure
 * notice against.
 */
export function calculateServiceCancellationRefund(params: {
  shootDate: string | Date | null | undefined;
  total: number;
  now?: Date;
}): CancellationQuote | null {
  if (!params.shootDate) return null;

  const start = params.shootDate instanceof Date
    ? params.shootDate
    : new Date(params.shootDate);
  if (Number.isNaN(start.getTime())) return null;

  return calculateCancellationRefund({
    startDate: start,
    totalPrice: params.total,
    depositAmount: 0,
    tiers: STUDIO.booking.cancellationTiers,
    now: params.now,
  });
}

/**
 * Whether an equipment booking in this status may still be cancelled by the
 * customer. Once equipment is handed over the return pipeline takes over.
 */
export function isCancellableStatus(status: string): boolean {
  return status === 'pending' || status === 'confirmed';
}
