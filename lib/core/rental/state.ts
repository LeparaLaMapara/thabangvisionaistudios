/**
 * Gear-hire booking state machine. Pure: no Supabase, Next.js or provider
 * imports.
 *
 * The booking status only says where the GEAR is in its journey. Payment,
 * deposit, refund, payout and dispute progress each have their own status
 * (see payments.ts, refunds.ts, payouts.ts), so one column is never asked to
 * mean two things.
 *
 *   pending ──► confirmed ──► active ──► return_pending ──► return_reviewed
 *      │            │           │             ▲   │                │
 *      ▼            ▼           ▼             │   ├──► completed ◄─┤
 *   cancelled   cancelled    overdue ─────────┘   └──► disputed ◄──┘
 *                                                          │
 *                                                          ▼
 *                                                      completed
 *
 * `return_reviewed` is the existing "inspected, deposit being settled" step.
 * It keeps the item off sale until settlement is done, like an inspection.
 */

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'active',
  'overdue',
  'return_pending',
  'return_reviewed',
  'completed',
  'disputed',
  'cancelled',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Who is asking for the change. Routes map their caller to one of these. */
export type Actor = 'system' | 'customer' | 'staff' | 'owner';

interface TransitionRule {
  from: BookingStatus;
  to: BookingStatus;
  actors: readonly Actor[];
  /** A recorded reason is required (exceptional or human-judgement steps). */
  reasonRequired?: boolean;
}

/**
 * Every allowed move. Anything not listed is refused. `system` means a
 * verified webhook or a scheduled job, never a browser.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // Verified payment (webhook/reconciliation), or staff recording a payment
  // taken by hand (EFT/cash) with the reference as the reason.
  { from: 'pending', to: 'confirmed', actors: ['system', 'staff'] },
  // Hold expiry, customer abandons, staff cancels.
  { from: 'pending', to: 'cancelled', actors: ['system', 'customer', 'staff'] },

  // Handover recorded with complete evidence.
  { from: 'confirmed', to: 'active', actors: ['staff', 'owner'] },
  // Eligible cancellation workflow (refund tier applies), or staff with reason
  // (e.g. identity check failed at collection).
  { from: 'confirmed', to: 'cancelled', actors: ['customer', 'staff'] },

  { from: 'active', to: 'overdue', actors: ['system'] },
  { from: 'active', to: 'return_pending', actors: ['staff', 'owner'] },
  { from: 'overdue', to: 'return_pending', actors: ['staff', 'owner'] },

  // Inspection.
  { from: 'return_pending', to: 'return_reviewed', actors: ['staff'] },
  { from: 'return_pending', to: 'completed', actors: ['staff'] },
  { from: 'return_pending', to: 'disputed', actors: ['staff', 'customer', 'owner'], reasonRequired: true },
  { from: 'return_reviewed', to: 'completed', actors: ['staff', 'system'] },
  { from: 'return_reviewed', to: 'disputed', actors: ['staff', 'customer', 'owner'], reasonRequired: true },

  // Only a person closes a dispute, and says why.
  { from: 'disputed', to: 'completed', actors: ['staff'], reasonRequired: true },
];

export const TERMINAL_STATUSES: readonly BookingStatus[] = ['completed', 'cancelled'];

/**
 * Statuses that take a unit off sale for the booking's dates. A `pending`
 * booking only blocks while its hold is still valid (see holdIsLive).
 * Disputed, overdue and under-inspection gear stays unavailable (T24, T25).
 */
export const INVENTORY_BLOCKING_STATUSES: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'active',
  'overdue',
  'return_pending',
  'return_reviewed',
  'disputed',
];

/**
 * Statuses where the renter is holding, or about to hold, the gear. These
 * count against their trust limit.
 */
export const EXPOSURE_STATUSES: readonly BookingStatus[] = [
  'confirmed',
  'active',
  'overdue',
  'return_pending',
  'disputed',
];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

export type TransitionCheck =
  | { ok: true; alreadyDone: false }
  /** The booking is already in the target state: a replay, not an error. */
  | { ok: true; alreadyDone: true }
  | { ok: false; code: 'unknown_status' | 'not_allowed' | 'actor_not_allowed' | 'reason_required'; message: string };

/**
 * Whether `actor` may move a booking from `from` to `to`.
 *
 * A repeat of a move that already happened (from === to) is reported as
 * `alreadyDone` so callers return the original result instead of failing or
 * acting twice.
 */
export function checkTransition(
  from: unknown,
  to: BookingStatus,
  actor: Actor,
  reason?: string | null,
): TransitionCheck {
  if (!isBookingStatus(from)) {
    return { ok: false, code: 'unknown_status', message: `Unknown booking status: ${String(from)}` };
  }
  if (from === to) return { ok: true, alreadyDone: true };

  const rule = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) {
    return { ok: false, code: 'not_allowed', message: `A booking cannot move from ${from} to ${to}.` };
  }
  if (!rule.actors.includes(actor)) {
    return { ok: false, code: 'actor_not_allowed', message: `${actor} cannot move a booking from ${from} to ${to}.` };
  }
  if (rule.reasonRequired && !(reason && reason.trim().length >= 3)) {
    return { ok: false, code: 'reason_required', message: `Moving a booking from ${from} to ${to} needs a recorded reason.` };
  }
  return { ok: true, alreadyDone: false };
}

/** The statuses a booking may legally be in just before moving to `to`. */
export function allowedFromStatuses(to: BookingStatus, actor: Actor): BookingStatus[] {
  return TRANSITIONS.filter((t) => t.to === to && t.actors.includes(actor)).map((t) => t.from);
}

/**
 * Whether a pending booking still holds its stock. A pending booking with no
 * expiry recorded (legacy rows) is treated as live for `legacyHoldMinutes`
 * after creation, matching the old cron behaviour.
 */
export function holdIsLive(
  booking: { status: string; hold_expires_at?: string | null; created_at?: string | null },
  now: Date,
  legacyHoldMinutes: number,
): boolean {
  if (booking.status !== 'pending') return false;
  if (booking.hold_expires_at) return new Date(booking.hold_expires_at).getTime() > now.getTime();
  if (!booking.created_at) return false;
  return new Date(booking.created_at).getTime() + legacyHoldMinutes * 60_000 > now.getTime();
}

/** Whether a booking takes stock off sale right now. */
export function blocksInventory(
  booking: { status: string; hold_expires_at?: string | null; created_at?: string | null },
  now: Date,
  legacyHoldMinutes: number,
): boolean {
  if (!isBookingStatus(booking.status)) return true; // unknown → fail closed
  if (booking.status === 'pending') return holdIsLive(booking, now, legacyHoldMinutes);
  return INVENTORY_BLOCKING_STATUSES.includes(booking.status);
}
