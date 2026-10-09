import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import type { ProviderDeliveryState } from '@/lib/core/delivery/port';

/**
 * Uber Direct: everything provider-specific that may need correcting lives
 * here, in one place (docs/logistics/uber-direct.md).
 *
 * VERIFIED (docs/logistics/provider-comparison.md, from Uber's developer docs):
 *   - API at developer.uber.com with test mode / sandbox;
 *   - OAuth2 client-credentials authentication;
 *   - quotes expire after 15 minutes;
 *   - same-day, express and scheduled (up to 30 days ahead);
 *   - webhooks signed with HMAC-SHA256;
 *   - pickup verification; dropoff PIN, signature, photo, ID, barcode;
 *     PIN, signature and ID cannot be combined with leave-at-door;
 *   - return deliveries;
 *   - `idempotency_key` and `external_id` appear in an official example
 *     (their BEHAVIOUR is not verified);
 *   - Uber states it carries no insurance for loss, damage or theft.
 *
 * Every `// VERIFY:` below is a detail NOT confirmed by our research. Check it
 * against the live docs (and in sandbox) before enabling the provider.
 */

export const UBER_DIRECT_PROVIDER_ID = 'uber_direct';

export const UBER_DIRECT_API = {
  // VERIFY: token endpoint host and path (Uber's authentication guide).
  tokenUrl: 'https://auth.uber.com/oauth/v2/token',
  // Verified: the scope Direct uses for deliveries.
  scope: 'eats.deliveries',
  // VERIFY: API base. Customer-scoped paths follow it: /v1/customers/{customer_id}/...
  // VERIFY: whether sandbox uses the same host (test credentials) or a separate one.
  baseUrl: { sandbox: 'https://api.uber.com', production: 'https://api.uber.com' },
  paths: {
    // VERIFY: each path and method.
    quote: (customerId: string): string => `/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,
    create: (customerId: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries`,
    get: (customerId: string, id: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries/${encodeURIComponent(id)}`,
    cancel: (customerId: string, id: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries/${encodeURIComponent(id)}/cancel`,
    // Deliberately absent: a lookup by external_id. None is verified, so
    // findByMerchantReference answers "unknown" and a person checks.
  },
  // Verified: 15-minute quote expiry.
  quoteValidityMinutes: 15,
  // VERIFY: address JSON shape and the country code field.
  countryCode: 'ZA',
  // VERIFY: `fee` is in the currency's smallest unit (cents) and `currency` is "zar".
  currency: 'ZAR',
  // VERIFY: field values. Hand-to-hand: meet at the door, and on failure bring
  // the parcel back rather than leaving it.
  deliverableActionMeetAtDoor: 'deliverable_action_meet_at_door',
  undeliverableActionReturn: 'return',
  // VERIFY: webhook signature header names (both are cited by Uber's docs).
  signatureHeaders: ['x-uber-signature', 'x-postmates-signature'],
  // VERIFY: the delivery status event kind.
  statusEventKind: 'event.delivery_status',
  timeoutsMs: { token: 8_000, read: 8_000, create: 15_000, cancel: 10_000 },
  breaker: { failureThreshold: 5, cooldownMs: 60_000 },
  // Refresh the token this long before Uber says it expires.
  tokenRefreshSkewMs: 5 * 60_000,
} as const;

/**
 * VERIFY: Uber's status names. Mapped conservatively: anything not listed is
 * 'unknown', which the core never applies (it reconciles instead).
 */
export const UBER_DIRECT_STATUS: Readonly<Record<string, ProviderDeliveryState>> = {
  pending: 'pending',
  // A courier has accepted and is heading to the pickup.
  pickup: 'courier_assigned',
  pickup_complete: 'collected',
  // On the way to the dropoff.
  dropoff: 'in_transit',
  delivered: 'delivered',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  returned: 'return_to_sender',
};

export function mapUberStatus(status: unknown): ProviderDeliveryState {
  if (typeof status !== 'string') return 'unknown';
  return UBER_DIRECT_STATUS[status.trim().toLowerCase()] ?? 'unknown';
}

/**
 * Capabilities for OUR account: only what the research verified.
 *
 *  - onDemand, scheduled: documented (same day, up to 30 days ahead).
 *  - reverseLogistics: documented return deliveries; our return leg is an
 *    ordinary pickup at the renter's address.
 *  - trackingWebhooks: HMAC-SHA256 signed webhooks.
 *  - pickupConfirmation, proofOfDelivery, signature: documented verification.
 *  - noLeaveAtDoor: documented (meet at door; PIN/signature exclude leave-at-door).
 *  - liveTracking: false. Courier location fields are not in our research.
 *  - recipientPin: false. Documented, but whether it works in South Africa is
 *    an open question (provider-comparison.md). The adapter still sends a PIN
 *    when the core supplies one.
 *  - declaredValueSupport: false. The SA per-delivery value cap is not verified.
 *  - cancellation: false. The cancel endpoint and SA cancellation fees are not
 *    in our verified research; the call is implemented, flip after sandbox.
 *  - idempotentCreate: false. `idempotency_key` / `external_id` behaviour is
 *    not verified and no lookup by our reference is documented. The core's
 *    risk gate therefore excludes Uber Direct until this is confirmed.
 *  - verifiedTransitCover: false. Uber states it carries no insurance.
 */
export const UBER_DIRECT_CAPABILITIES: DeliveryCapabilities = {
  onDemand: true,
  scheduled: true,
  reverseLogistics: true,
  liveTracking: false,
  trackingWebhooks: true,
  pickupConfirmation: true,
  proofOfDelivery: true,
  signature: true,
  recipientPin: false,
  declaredValueSupport: false,
  verifiedTransitCover: false,
  cancellation: false,
  noLeaveAtDoor: true,
  idempotentCreate: false,
};
