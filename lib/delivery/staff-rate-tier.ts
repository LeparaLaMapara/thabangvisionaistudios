import type { AdminRateTier } from '@/lib/auth';

/**
 * Which admin rate-limit bucket a delivery-ops action counts against.
 *
 * One delivery is several taps by one person within a minute or two: reveal
 * the pickup and drop-off, record "driver assigned", "on the way", "at the
 * door", then the handover with photos. Counting every tap against the
 * 5-a-minute `sensitive` bucket (shared with payouts, suspensions and
 * refunds) stopped staff halfway through a single delivery.
 *
 * So recording what physically happened goes to the `standard` bucket
 * (30 a minute), and anything that moves money, books a courier, decides
 * liability or runs a batch stays `sensitive`. Every action is still admin
 * only, enforced by the delivery use cases, and logged. An action this list
 * does not know is `sensitive` (fail closed).
 */
const OPERATIONAL_ACTIONS: ReadonlySet<string> = new Set([
  'advance_manual',
  'record_collection',
  'record_handover',
  'record_inspection',
  'report_incident',
  'reschedule',
  'quote_leg',
  // Logged with the admin's id on every reveal (D21); one per side of a leg.
  'reveal_address',
]);

export function deliveryActionRateTier(action: unknown): AdminRateTier {
  return typeof action === 'string' && OPERATIONAL_ACTIONS.has(action) ? 'standard' : 'sensitive';
}
