/**
 * Shipment-leg state machine (spec Phase 4 §4.9). Pure.
 *
 * A leg is one trip: the outbound leg (owner or us → renter) or the return
 * leg (renter → owner or us). Each leg has its own state, separate from the
 * rental booking status: gear can be in transit while the hire is still
 * `confirmed`, and a courier's "delivered" never makes a hire `active`.
 *
 *   requested → quoted → prepared → booking → scheduled → courier_assigned
 *     → courier_at_pickup → collected → in_transit → courier_at_dropoff → delivered
 *
 * Exceptions: cancelled, failed (both final), delivery_attempt_failed,
 * return_to_sender, lost, damaged, incident_under_review.
 *
 * Provider events arrive late, twice and out of order. `applyProviderState`
 * only ever moves a leg forward (by rank); the few legitimate sideways moves
 * (a second delivery attempt) also need a newer provider timestamp. So a
 * stale "in transit" can never overwrite "delivered" (D13).
 */

import type { ProviderDeliveryState } from './port';

export const DELIVERY_STATES = [
  'requested',
  'quoted',
  'prepared',
  'booking',
  'scheduled',
  'courier_assigned',
  'courier_at_pickup',
  'collected',
  'in_transit',
  'courier_at_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'delivery_attempt_failed',
  'return_to_sender',
  'lost',
  'damaged',
  'incident_under_review',
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];
export type ShipmentLeg = 'outbound' | 'return';

/**
 * Who moves a leg. `provider` is a VERIFIED webhook or a poll of the
 * provider's API; `system` is our own server (dispatch, jobs); `staff` is an
 * authenticated admin (and drives the manual adapter).
 */
export type DeliveryActor = 'system' | 'provider' | 'staff';

/** States after which nothing else happens to the leg. */
export const FINAL_DELIVERY_STATES: readonly DeliveryState[] = ['cancelled', 'failed'];

/** States in which the gear is (or may be) with a courier: custody has left the sender. */
export const IN_COURIER_CUSTODY: readonly DeliveryState[] = [
  'collected',
  'in_transit',
  'courier_at_dropoff',
  'delivery_attempt_failed',
  'return_to_sender',
];

/** States in which a leg can still be cancelled without the gear having moved. */
export const CANCELLABLE_STATES: readonly DeliveryState[] = [
  'requested',
  'quoted',
  'prepared',
  'booking',
  'scheduled',
  'courier_assigned',
  'courier_at_pickup',
];

/**
 * Progress rank. A provider event may only move a leg to a higher rank,
 * except the sideways moves in SIDEWAYS (which also need a newer timestamp).
 * Exception states rank above the whole happy path, so no ordinary courier
 * update can pull a leg out of `lost` or `incident_under_review`.
 */
export const DELIVERY_RANK: Record<DeliveryState, number> = {
  requested: 0,
  quoted: 1,
  prepared: 2,
  booking: 3,
  scheduled: 4,
  courier_assigned: 5,
  courier_at_pickup: 6,
  collected: 7,
  in_transit: 8,
  courier_at_dropoff: 9,
  delivery_attempt_failed: 9,
  return_to_sender: 10,
  delivered: 11,
  failed: 12,
  cancelled: 12,
  damaged: 13,
  lost: 13,
  incident_under_review: 14,
};

interface Rule {
  from: readonly DeliveryState[];
  to: DeliveryState;
  actors: readonly DeliveryActor[];
  reasonRequired?: boolean;
}

const HAPPY: readonly DeliveryState[] = [
  'booking',
  'scheduled',
  'courier_assigned',
  'courier_at_pickup',
  'collected',
  'in_transit',
  'courier_at_dropoff',
];
const after = (s: DeliveryState): DeliveryState[] => HAPPY.filter((h) => DELIVERY_RANK[h] < DELIVERY_RANK[s]);

/** Every allowed move. Anything not listed is refused. */
export const DELIVERY_TRANSITIONS: readonly Rule[] = [
  { from: ['requested'], to: 'quoted', actors: ['system'] },
  { from: ['quoted'], to: 'prepared', actors: ['system', 'staff'] },
  // Dispatch claimed: we are about to call the provider.
  { from: ['prepared'], to: 'booking', actors: ['system', 'staff'] },
  // Forward along the happy path. A provider may skip states (a missed webhook).
  { from: after('scheduled'), to: 'scheduled', actors: ['system', 'provider', 'staff'] },
  { from: after('courier_assigned'), to: 'courier_assigned', actors: ['system', 'provider', 'staff'] },
  { from: after('courier_at_pickup'), to: 'courier_at_pickup', actors: ['system', 'provider', 'staff'] },
  { from: after('collected'), to: 'collected', actors: ['system', 'provider', 'staff'] },
  { from: [...after('in_transit'), 'delivery_attempt_failed'], to: 'in_transit', actors: ['system', 'provider', 'staff'] },
  { from: [...after('courier_at_dropoff'), 'delivery_attempt_failed'], to: 'courier_at_dropoff', actors: ['system', 'provider', 'staff'] },
  { from: [...HAPPY.filter((h) => h !== 'booking'), 'delivery_attempt_failed'], to: 'delivered', actors: ['system', 'provider', 'staff'] },
  // Nobody home, wrong address, refused at the door.
  { from: ['collected', 'in_transit', 'courier_at_dropoff'], to: 'delivery_attempt_failed', actors: ['system', 'provider', 'staff'] },
  { from: ['collected', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed'], to: 'return_to_sender', actors: ['system', 'provider', 'staff'] },
  // Before the gear moved.
  { from: ['requested', 'quoted', 'prepared'], to: 'cancelled', actors: ['system', 'staff'] },
  // Once a provider job may exist, only after the provider confirmed the cancel.
  { from: ['booking', 'scheduled', 'courier_assigned', 'courier_at_pickup'], to: 'cancelled', actors: ['system', 'provider', 'staff'] },
  { from: ['booking', 'scheduled', 'courier_assigned', 'courier_at_pickup'], to: 'failed', actors: ['system', 'provider', 'staff'] },
  // The gear came back to the sender: a person closes the leg.
  { from: ['return_to_sender'], to: 'failed', actors: ['staff'], reasonRequired: true },
  // Loss or damage while a courier had it.
  { from: [...IN_COURIER_CUSTODY, 'delivered'], to: 'lost', actors: ['provider', 'staff'] },
  { from: [...IN_COURIER_CUSTODY, 'delivered'], to: 'damaged', actors: ['provider', 'staff'] },
  { from: [...IN_COURIER_CUSTODY, 'delivered', 'lost', 'damaged'], to: 'incident_under_review', actors: ['system', 'staff'] },
  // Only a person ends a review, and says why.
  { from: ['incident_under_review'], to: 'delivered', actors: ['staff'], reasonRequired: true },
  { from: ['incident_under_review'], to: 'lost', actors: ['staff'], reasonRequired: true },
  { from: ['incident_under_review'], to: 'damaged', actors: ['staff'], reasonRequired: true },
  { from: ['incident_under_review', 'lost', 'damaged'], to: 'failed', actors: ['staff'], reasonRequired: true },
];

/** Sideways moves a provider may make (equal or lower rank), only with a newer timestamp. */
const SIDEWAYS: ReadonlyArray<readonly [DeliveryState, DeliveryState]> = [
  ['courier_at_dropoff', 'delivery_attempt_failed'],
  ['delivery_attempt_failed', 'courier_at_dropoff'],
  ['delivery_attempt_failed', 'in_transit'],
];

export function isDeliveryState(v: unknown): v is DeliveryState {
  return typeof v === 'string' && (DELIVERY_STATES as readonly string[]).includes(v);
}

export type DeliveryTransitionCheck =
  | { ok: true; alreadyDone: boolean }
  | { ok: false; code: 'unknown_state' | 'not_allowed' | 'actor_not_allowed' | 'reason_required'; message: string };

export function checkDeliveryTransition(
  from: unknown,
  to: DeliveryState,
  actor: DeliveryActor,
  reason?: string | null,
): DeliveryTransitionCheck {
  if (!isDeliveryState(from)) return { ok: false, code: 'unknown_state', message: `Unknown delivery state: ${String(from)}` };
  if (from === to) return { ok: true, alreadyDone: true };
  const rules = DELIVERY_TRANSITIONS.filter((r) => r.to === to && r.from.includes(from));
  if (rules.length === 0) return { ok: false, code: 'not_allowed', message: `A delivery cannot move from ${from} to ${to}.` };
  const rule = rules.find((r) => r.actors.includes(actor));
  if (!rule) return { ok: false, code: 'actor_not_allowed', message: `${actor} cannot move a delivery from ${from} to ${to}.` };
  if (rule.reasonRequired && !(reason && reason.trim().length >= 3)) {
    return { ok: false, code: 'reason_required', message: `Moving a delivery from ${from} to ${to} needs a recorded reason.` };
  }
  return { ok: true, alreadyDone: false };
}

/** Our canonical state for a provider state. `unknown` maps to null: ask the provider, never guess. */
export function canonicalFromProvider(s: ProviderDeliveryState): DeliveryState | null {
  switch (s) {
    case 'pending':
      return 'scheduled';
    case 'courier_assigned':
    case 'courier_at_pickup':
    case 'collected':
    case 'in_transit':
    case 'courier_at_dropoff':
    case 'delivered':
    case 'delivery_attempt_failed':
    case 'return_to_sender':
    case 'cancelled':
    case 'failed':
    case 'lost':
    case 'damaged':
      return s;
    case 'unknown':
      return null;
  }
}

export type ProviderStateDecision =
  | { apply: true; to: DeliveryState }
  | { apply: false; reason: 'same_state' | 'stale' | 'not_allowed' | 'unknown_provider_state' };

/**
 * Whether a provider-reported state may be applied to a leg (D13). Applied
 * only when the move is allowed for a provider AND it moves the leg forward;
 * a sideways move also needs the event to be newer than the last applied one.
 * `lastAppliedAt` is the provider timestamp of the last applied event.
 */
export function applyProviderState(p: {
  current: DeliveryState;
  incoming: ProviderDeliveryState;
  incomingAt: string | null;
  lastAppliedAt: string | null;
}): ProviderStateDecision {
  const to = canonicalFromProvider(p.incoming);
  if (!to) return { apply: false, reason: 'unknown_provider_state' };
  if (to === p.current) return { apply: false, reason: 'same_state' };
  const check = checkDeliveryTransition(p.current, to, 'provider');
  if (!check.ok) {
    // An older update for a state we already passed: stale, not an error.
    return { apply: false, reason: DELIVERY_RANK[to] < DELIVERY_RANK[p.current] ? 'stale' : 'not_allowed' };
  }
  if (DELIVERY_RANK[to] > DELIVERY_RANK[p.current]) return { apply: true, to };
  const sideways = SIDEWAYS.some(([a, b]) => a === p.current && b === to);
  if (!sideways) return { apply: false, reason: 'stale' };
  const newer =
    p.incomingAt !== null &&
    (p.lastAppliedAt === null || new Date(p.incomingAt).getTime() > new Date(p.lastAppliedAt).getTime());
  return newer ? { apply: true, to } : { apply: false, reason: 'stale' };
}
