import type { AdminRateTier } from '@/lib/auth';

/**
 * Which admin rate-limit bucket a delivery-ops request counts against.
 *
 * One delivery is several taps by one person within a minute or two: driver
 * assigned, on the way, at the door, then the handover with photos. Counting
 * every tap against the 5-a-minute `sensitive` bucket (shared with payouts,
 * suspensions and refunds) stopped staff halfway through a single delivery.
 *
 * So recording what physically happened goes to the `standard` bucket
 * (30 a minute). Anything that moves money, books a courier, decides
 * liability, reveals a renter's address (D21) or runs a batch stays
 * `sensitive`. An incident that says whether the provider caused it is a
 * liability decision (it waives the automatic late fee), so it is sensitive
 * too. Every action is still admin only, enforced by the delivery use cases,
 * and logged. Anything this does not recognise is `sensitive` (fail closed).
 */
const OPERATIONAL_ACTIONS: ReadonlySet<string> = new Set([
  'advance_manual',
  'record_collection',
  'record_handover',
  'record_inspection',
  'report_incident',
  'reschedule',
  'quote_leg',
]);

export function deliveryActionRateTier(body: unknown): AdminRateTier {
  if (!body || typeof body !== 'object') return 'sensitive';
  const b = body as { action?: unknown; providerCaused?: unknown };
  if (typeof b.action !== 'string' || !OPERATIONAL_ACTIONS.has(b.action)) return 'sensitive';
  // The route reads providerCaused as true, false or (anything else) null.
  if (b.action === 'report_incident' && (b.providerCaused === true || b.providerCaused === false)) return 'sensitive';
  return 'standard';
}
