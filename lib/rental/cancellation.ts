import { STUDIO } from '@/lib/constants';

export interface CancellationQuote {
  /** Whole hours between "now" and the start of the hire. Negative once started. */
  hoursBefore: number;
  /** Percentage of the hire charge refunded, from STUDIO.rental.cancellationTiers. */
  refundPercent: number;
  /** Portion of the hire charge refunded. */
  hireRefund: number;
  /** Portion of the hire charge retained by us. */
  cancellationFee: number;
  /** Security deposit refunded. Always the full deposit — the gear never left. */
  depositRefund: number;
  /** What actually goes back to the customer's card. */
  totalRefund: number;
}

/**
 * Works out what a customer gets back when they cancel an equipment hire.
 *
 * The scale lives in STUDIO.rental.cancellationTiers so the published policy
 * and the charged amount cannot drift apart. The deposit is excluded from the
 * scale on purpose: it secures equipment against damage and late return, and
 * on a cancellation no equipment was ever handed over, so there is nothing for
 * it to secure.
 *
 * Pure and side-effect free so it can be unit tested and reused in the UI to
 * show the customer what they will get back before they confirm.
 */
export function calculateCancellationRefund(params: {
  /** Hire start date, as stored on equipment_bookings.start_date. */
  startDate: string | Date;
  /** The hire charge paid, excluding the deposit. */
  totalPrice: number;
  /** The security deposit paid. */
  depositAmount: number;
  /** Defaults to the current time. Injected so tests are deterministic. */
  now?: Date;
}): CancellationQuote {
  const { totalPrice, depositAmount } = params;
  const now = params.now ?? new Date();
  const start = params.startDate instanceof Date
    ? params.startDate
    : new Date(params.startDate);

  const msPerHour = 1000 * 60 * 60;
  const hoursBefore = Math.floor((start.getTime() - now.getTime()) / msPerHour);

  // Tiers are ordered most-notice-first; take the first one the customer clears.
  const tier = STUDIO.rental.cancellationTiers.find(
    (t) => hoursBefore >= t.minHoursBefore,
  );
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
 * Whether a booking in this status may still be cancelled by the customer.
 * Once equipment is handed over the return pipeline takes over instead.
 */
export function isCancellableStatus(status: string): boolean {
  return status === 'pending' || status === 'confirmed';
}
