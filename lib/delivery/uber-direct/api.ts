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
 * VERIFIED against our own account on 2026-10-13 (test keys, South Africa;
 * docs/logistics/uber-direct.md "Sandbox results"):
 *   - token: auth.uber.com/oauth/v2/token, client_credentials, scope
 *     eats.deliveries, expires_in 2592000 (30 days); same host for test keys;
 *   - quote: POST /v1/customers/{id}/delivery_quotes with the address JSON
 *     below, answers { id: "dqt_...", fee: cents, currency: "zar",
 *     expires: +15 min }; too far answers 400 code "address_undeliverable";
 *   - Uber's radius: 6.21 miles (10 km) from the pickup point;
 *   - create, get and cancel at the paths below; a cancel answers status
 *     "canceled"; the test robot courier went pending, pickup, dropoff,
 *     delivered;
 *   - a second create with the same `idempotency_key` is refused with 409
 *     "duplicate_delivery" (also after a cancel); a new key makes a new
 *     delivery even with identical content;
 *   - GET /deliveries?external_id=... returns exactly the deliveries with
 *     that external_id (an empty list when there are none);
 *   - proof comes back as pickup/dropoff.verification.{picture,signature}
 *     .image_url, which is "" until the proof exists.
 *
 * Every `// VERIFY:` below is a detail NOT confirmed by our research. Check it
 * against the live docs (and in sandbox) before enabling the provider.
 */

export const UBER_DIRECT_PROVIDER_ID = 'uber_direct';

export const UBER_DIRECT_API = {
  // Verified 2026-10-13.
  tokenUrl: 'https://auth.uber.com/oauth/v2/token',
  // Verified: the scope Direct uses for deliveries.
  scope: 'eats.deliveries',
  // Verified 2026-10-13: one host for both; the test keys make test deliveries
  // (live_mode false). Customer-scoped paths: /v1/customers/{customer_id}/...
  baseUrl: { sandbox: 'https://api.uber.com', production: 'https://api.uber.com' },
  paths: {
    // Verified 2026-10-13 (quote, create, get, cancel, list by external_id).
    quote: (customerId: string): string => `/v1/customers/${encodeURIComponent(customerId)}/delivery_quotes`,
    create: (customerId: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries`,
    get: (customerId: string, id: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries/${encodeURIComponent(id)}`,
    cancel: (customerId: string, id: string): string => `/v1/customers/${encodeURIComponent(customerId)}/deliveries/${encodeURIComponent(id)}/cancel`,
    byExternalId: (customerId: string, externalId: string): string =>
      `/v1/customers/${encodeURIComponent(customerId)}/deliveries?external_id=${encodeURIComponent(externalId)}`,
  },
  // Verified: 15-minute quote expiry (and in our sandbox, 2026-10-13).
  quoteValidityMinutes: 15,
  // Verified 2026-10-13: { street_address: [..], city, state, zip_code, country: "ZA" } as a JSON string.
  countryCode: 'ZA',
  // Verified 2026-10-13: `fee` is cents (6038 = R60.38) and `currency` is "zar".
  currency: 'ZAR',
  // Verified 2026-10-13: Uber refuses a drop-off more than 6.21 miles from the
  // pickup ("Max Radius: 6.21 miles"). We skip Uber above this straight-line
  // distance; Uber's own answer still decides near the edge.
  maxRadiusKm: 10,
  // Hand-to-hand: meet at the door (verified: echoed back on create), and on
  // failure bring the parcel back rather than leaving it (VERIFY: the create
  // answer shows undeliverable_action as "", so check a failed test delivery).
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
 * Seen in our sandbox 2026-10-13: pending, pickup, dropoff, delivered,
 * canceled. VERIFY: pickup_complete and returned (not seen yet). Mapped conservatively: anything not listed is
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
 *  - recipientPin: true. Verified in our South African sandbox (2026-10-14):
 *    with dropoff_verification.pincode.enabled Uber makes a PIN and returns
 *    it at dropoff.verification_requirements.pincode.value; Uber's guide says
 *    it texts the PIN to the drop-off phone and repeats it as the driver
 *    approaches. We keep a copy for the booking page (089).
 *  - declaredValueSupport: false. The SA per-delivery value cap is not verified.
 *  - cancellation: true. Verified in our sandbox (2026-10-13): the cancel call
 *    answers "canceled". SA cancellation FEES are still not verified: any fee
 *    is picked up from the invoice (reconcileDelivery).
 *  - idempotentCreate: true. Verified in our sandbox (2026-10-13): a repeated
 *    create with the same idempotency_key is refused (409 duplicate_delivery),
 *    never a second courier, and the adapter then finds the first delivery by
 *    external_id (the same reference).
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
  recipientPin: true,
  declaredValueSupport: false,
  verifiedTransitCover: false,
  cancellation: true,
  noLeaveAtDoor: true,
  idempotentCreate: true,
};
