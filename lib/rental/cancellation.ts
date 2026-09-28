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
  /**
   * True when the 7 day cooling off right applies (ECT Act s44): cancelled
   * within STUDIO.legal.coolingOffDays of booking and before the start, so
   * everything paid comes back whatever the notice.
   */
  coolingOff: boolean;
  /** Portion of the charge refunded. */
  hireRefund: number;
  /** Portion of the charge retained by us. */
  cancellationFee: number;
  /** Security deposit refunded. Always in full — the gear never left. */
  depositRefund: number;
  /** Delivery fee refunded. Always in full — nothing was dispatched yet. */
  deliveryRefund: number;
  /** What actually goes back to the customer's card. */
  totalRefund: number;
}

const HOUR_MS = 1000 * 60 * 60;
const DAY_MS = HOUR_MS * 24;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * When a hire or shoot starts. Start and shoot dates are stored as plain
 * dates, and a plain date read by `new Date()` is midnight UTC, which is
 * 02:00 in South Africa. The day starts at midnight South African time
 * (UTC+2 all year, no daylight saving), so that is what we measure to.
 */
export function startOfBookedDay(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+02:00`);
  return new Date(value);
}

/** Whether a booking made at `bookedAt` is still inside the cooling off period at `now`. */
export function withinCoolingOff(
  bookedAt: string | Date | null | undefined,
  now: Date,
  days: number = STUDIO.legal.coolingOffDays,
): boolean {
  if (!bookedAt) return false;
  const booked = bookedAt instanceof Date ? bookedAt : new Date(bookedAt);
  if (Number.isNaN(booked.getTime())) return false;
  return now.getTime() - booked.getTime() <= days * DAY_MS;
}

/**
 * Works out what a customer gets back when they cancel.
 *
 * The scale lives in constants so the published policy and the charged amount
 * cannot drift apart. The deposit and delivery fee are excluded from the scale
 * on purpose: on a cancellation no equipment was handed over or dispatched, so
 * there is nothing for them to pay for.
 *
 * Inside the cooling off period (booked within 7 days, not yet started) the
 * whole amount is refunded, as the Refunds policy section 10 promises.
 *
 * Pure and side-effect free, so it can be unit tested and reused in the UI to
 * show a customer what they will get back before they confirm.
 */
export function calculateCancellationRefund(params: {
  /** Start of the hire, or the shoot date for a service booking. */
  startDate: string | Date;
  /** The chargeable amount paid online, excluding any deposit. */
  totalPrice: number;
  /** The security deposit paid online. Zero for service bookings. */
  depositAmount: number;
  /** Delivery fee paid online, if any. */
  deliveryFee?: number;
  /** When the booking was made, for the cooling off right. */
  bookedAt?: string | Date | null;
  /** Defaults to STUDIO.rental.cancellationTiers. */
  tiers?: readonly CancellationTier[];
  /** Defaults to now. Injected so tests are deterministic. */
  now?: Date;
}): CancellationQuote {
  const { totalPrice, depositAmount } = params;
  const tiers = params.tiers ?? STUDIO.rental.cancellationTiers;
  const now = params.now ?? new Date();
  const start = startOfBookedDay(params.startDate);

  const msBefore = start.getTime() - now.getTime();
  const hoursBefore = Math.floor(msBefore / HOUR_MS);

  const coolingOff = msBefore > 0 && withinCoolingOff(params.bookedAt, now);
  const tier = tiers.find((t) => hoursBefore >= t.minHoursBefore);
  const refundPercent = coolingOff ? 100 : (tier?.refundPercent ?? 0);

  const hire = Math.max(0, totalPrice);
  const deposit = Math.max(0, depositAmount);
  const delivery = Math.max(0, params.deliveryFee ?? 0);

  const hireRefund = round2(hire * (refundPercent / 100));
  const cancellationFee = round2(hire - hireRefund);

  return {
    hoursBefore,
    refundPercent,
    coolingOff,
    hireRefund,
    cancellationFee,
    depositRefund: deposit,
    deliveryRefund: delivery,
    totalRefund: round2(hireRefund + deposit + delivery),
  };
}

/**
 * What was actually paid online for one equipment booking line, which is all a
 * card refund can return.
 *
 * - Booked from a listing (no checkout group): the hire charge was paid online;
 *   the deposit is taken at collection, so none of it is on the card.
 * - Cart, pay in full: the hire charge less the bulk discount, the deposit, and
 *   the delivery fee (stored on the group's first line only).
 * - Cart, deposit only: just the deposit; the hire charge is settled at the
 *   counter.
 *
 * `total_price` is stored before the bulk discount, so refunding it as-is
 * returned more than was paid; and a deposit-only order refunded a hire charge
 * that was never taken, which the payment provider refused.
 */
export function paidOnlineForLine(line: {
  totalPrice: number;
  depositAmount: number;
  deliveryFee?: number | null;
  paymentPlan?: string | null;
  checkoutGroupId?: string | null;
  /** The cart's bulk discount, in percent. */
  discountPercent?: number;
}): { hire: number; deposit: number; delivery: number } {
  const hire = Math.max(0, line.totalPrice);
  const deposit = Math.max(0, line.depositAmount);
  const delivery = Math.max(0, line.deliveryFee ?? 0);

  if (!line.checkoutGroupId) return { hire, deposit: 0, delivery: 0 };
  if (line.paymentPlan === 'deposit_only') return { hire: 0, deposit, delivery };

  const discount = Math.min(100, Math.max(0, line.discountPercent ?? 0));
  return { hire: round2(hire * (1 - discount / 100)), deposit, delivery };
}

/** The cart's bulk discount for an order of this many items (same rule as checkout). */
export function bulkDiscountPercentFor(itemCount: number): number {
  const tier = STUDIO.rental.bulkDiscount.find(
    (t) => itemCount >= t.minItems && itemCount <= t.maxItems,
  );
  return tier?.discountPercent ?? 0;
}

/**
 * Cancellation quote for a production or creative service booking, measured
 * against the start of the agreed shoot day. No deposit is involved.
 *
 * Returns null when the booking has no shoot date on record — bookings created
 * before migration 040, or through the AI assistant with a free-text date. Those
 * still have to be assessed by a person, because there is no clock to measure
 * notice against.
 */
export function calculateServiceCancellationRefund(params: {
  shootDate: string | Date | null | undefined;
  total: number;
  bookedAt?: string | Date | null;
  now?: Date;
}): CancellationQuote | null {
  if (!params.shootDate) return null;

  const start = startOfBookedDay(params.shootDate);
  if (Number.isNaN(start.getTime())) return null;

  return calculateCancellationRefund({
    startDate: start,
    totalPrice: params.total,
    depositAmount: 0,
    bookedAt: params.bookedAt,
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
