import { STUDIO } from '@/lib/constants';

/**
 * How many units of a listing are genuinely spoken for on a set of dates.
 *
 * Two things were wrong before this existed.
 *
 * Availability blocked on the FIRST overlapping booking and never read
 * smart_rentals.quantity, so a listing with two cameras rented one at a time
 * and the second customer was refused while stock sat on the shelf.
 *
 * And a hold was taken at checkout, before payment, and never released. An
 * abandoned payment page removed those dates from sale permanently. On
 * production that had already cost five date ranges, the oldest unsellable for
 * 161 days.
 *
 * Pure on purpose: the arithmetic is the part worth testing, and it is easier
 * to be sure about it here than inside a query.
 */

export interface BookingHold {
  id: string;
  /** Units held by this booking. */
  quantity: number;
  status: string;
  /** ISO timestamp the booking row was created. */
  createdAt: string;
  /** Gateway reference. Null means nobody has paid yet. */
  paymentReference: string | null;
}

/** Statuses that occupy stock. Anything else has released it. */
const OCCUPYING = new Set(['pending', 'confirmed', 'active']);

/**
 * An unpaid `pending` row is a checkout someone started. It holds stock only
 * for a grace window; after that it is an abandoned basket, not a booking.
 *
 * Deliberately keyed on payment, not on status alone: a PAID booking sitting
 * in `pending` because a webhook has not landed yet must never be released.
 * That case is real -- the reconciliation bug earlier this week would have
 * left exactly those rows behind -- and releasing them would sell gear twice.
 */
export function isExpiredHold(
  hold: BookingHold,
  now: Date,
  holdMinutes: number = STUDIO.rental.pendingHoldMinutes,
): boolean {
  if (hold.status !== 'pending') return false;
  if (hold.paymentReference) return false;

  const created = new Date(hold.createdAt).getTime();
  // An unparseable timestamp must not silently free stock.
  if (Number.isNaN(created)) return false;

  return now.getTime() - created > holdMinutes * 60_000;
}

/** Units currently occupied, ignoring holds that have expired. */
export function bookedUnits(
  holds: BookingHold[],
  now: Date,
  holdMinutes: number = STUDIO.rental.pendingHoldMinutes,
): number {
  return holds
    .filter((h) => OCCUPYING.has(h.status) && !isExpiredHold(h, now, holdMinutes))
    .reduce((sum, h) => sum + Math.max(1, Math.floor(h.quantity || 1)), 0);
}

export interface AvailabilityResult {
  available: boolean;
  /** Units of stock this listing has. */
  stock: number;
  /** Units already spoken for on these dates. */
  booked: number;
  /** Units still bookable. Never negative. */
  remaining: number;
  requested: number;
}

/**
 * Whether `requested` units can be booked over the given dates.
 *
 * Overbooking is possible in principle if two checkouts race, since this reads
 * and then writes. At this volume the window is small and the consequence is a
 * conversation rather than a loss; a database-level exclusion constraint is
 * the answer if that ever stops being true.
 */
export function checkAvailability(params: {
  stock: number;
  holds: BookingHold[];
  requested: number;
  now?: Date;
  holdMinutes?: number;
}): AvailabilityResult {
  const now = params.now ?? new Date();
  const holdMinutes = params.holdMinutes ?? STUDIO.rental.pendingHoldMinutes;

  // A listing with no quantity recorded is a single unit, which is how every
  // listing behaved before quantity was honoured.
  const stock = Math.max(0, Math.floor(params.stock || 1));
  const requested = Math.max(1, Math.floor(params.requested || 1));
  const booked = bookedUnits(params.holds, now, holdMinutes);
  const remaining = Math.max(0, stock - booked);

  return { available: requested <= remaining, stock, booked, remaining, requested };
}

/** Wording a customer can act on, rather than a flat "unavailable". */
export function availabilityMessage(title: string, r: AvailabilityResult): string {
  if (r.remaining === 0) {
    return `${title} is fully booked for those dates.`;
  }
  return `${title}: only ${r.remaining} of ${r.stock} available for those dates, but ${r.requested} were requested.`;
}
