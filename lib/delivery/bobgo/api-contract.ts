import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import type { ProviderDeliveryState } from '@/lib/core/delivery/port';

/**
 * Bob Go: the API contract the adapter uses.
 *
 * Source: Bob Go's official API reference, published as a Postman collection
 * behind https://api-docs.bob.co.za/bobgo (file
 * /postman-collections/bobgo.postman_collection.json), checked against the
 * Bob Go SANDBOX on 2026-10-11 with our own sandbox key (quote, create, a
 * second create under the same reference, lookup, read, tracking, cancel).
 *
 * Every endpoint path, header, request/response field and status word the
 * adapter uses lives in THIS file, so correcting the contract never means
 * hunting through adapter code. Each item is tagged with where it comes from:
 *
 *   [sandbox]  documented in the reference AND exercised against the sandbox;
 *   [docs]     in the reference, not yet exercised;
 *   [research] docs/logistics/provider-comparison.md (public pages);
 *   [assumed]  our guess. Treat as wrong until Bob Go confirms it.
 *
 * Bob Go's model: a SHIPMENT is a courier booking. (Bob Go "orders" are
 * shop orders that book nothing, and /rates-at-checkout is a shop checkout
 * price; neither is used.) A shipment is identified by Bob Go's
 * `tracking_reference`, and carries ours in `custom_tracking_reference`.
 *
 * What the sandbox showed that matters most: Bob Go does NOT refuse a second
 * shipment under the same custom reference. Two creates = two couriers. The
 * adapter therefore never retries a create, and the core reconciles by
 * reference before any retry (use-cases.ts).
 *
 * Open questions for Bob Go: docs/logistics/bobgo.md.
 */

export const BOBGO_PROVIDER_ID = 'bobgo';

/** Where each contract item comes from. */
export type ContractSource = 'sandbox' | 'docs' | 'research' | 'assumed';

export const BOBGO_CONTRACT = {
  baseUrl: {
    // [docs] production host. Not exercised: we hold no production key.
    production: 'https://api.bobgo.co.za/v2',
    // [sandbox] the reference's `host` variable; our sandbox key works here.
    sandbox: 'https://api.sandbox.bobgo.co.za/v2',
  },

  auth: {
    // [sandbox] bearer token = the merchant API key. A wrong key gets 401.
    header: 'Authorization',
    value: (apiKey: string): string => `Bearer ${apiKey}`,
  },

  paths: {
    // [sandbox] POST: courier rates for parcels between two addresses.
    rates: '/rates',
    // [sandbox] POST: create a shipment (book a courier).
    createShipment: '/shipments',
    // [sandbox] GET: shipments filtered by tracking reference. Bob Go matches
    // both its own reference and our custom one here.
    shipmentsByReference: (reference: string): string => `/shipments?tracking_reference=${encodeURIComponent(reference)}`,
    // [sandbox] POST { tracking_reference }: cancel a shipment.
    cancelShipment: '/shipments/cancel',
    // [sandbox] GET: tracking events (an array). Not called: status is read from the shipment.
    tracking: (reference: string): string => `/tracking?tracking_reference=${encodeURIComponent(reference)}`,
    // [sandbox] GET: proof of delivery ({ count, pods }). Not called yet: proof is not claimed.
    proofOfDelivery: (reference: string): string => `/shipments/pod?tracking_reference=${encodeURIComponent(reference)}`,
  },

  /** Field names in requests and responses. */
  fields: {
    // ── Requests [sandbox] ──
    collectionAddress: 'collection_address',
    deliveryAddress: 'delivery_address',
    address: { street: 'street_address', suburb: 'local_area', city: 'city', province: 'zone', postalCode: 'code', country: 'country', lat: 'lat', lng: 'lng' },
    collectionContactName: 'collection_contact_name',
    collectionContactPhone: 'collection_contact_mobile_number',
    deliveryContactName: 'delivery_contact_name',
    deliveryContactPhone: 'delivery_contact_mobile_number',
    collectionInstructions: 'instructions_collection',
    deliveryInstructions: 'instructions_delivery',
    // Our stable reference for the leg (also what the lookup matches on).
    merchantReference: 'custom_tracking_reference',
    // The courier and its service level, both from a rate.
    providerSlug: 'provider_slug',
    serviceLevelCode: 'service_level_code',
    parcels: 'parcels',
    // Parcel sub-fields: a generic label and a weight. No value is ever sent.
    parcel: { description: 'description', weightKg: 'submitted_weight_kg' },
    // How long Bob Go waits for the couriers, in ms. Without it a courier can
    // answer "pending" and its rates are missing.
    timeout: 'timeout',

    // ── Rates response [sandbox] ──
    rateProviders: 'provider_rate_requests',
    rateProviderSlug: 'provider_slug',
    rateProviderStatus: 'status',
    rateResponses: 'responses',
    rateServiceLevelCode: 'service_level_code',
    rateStatus: 'status',
    // VAT inclusive: what we are charged.
    ratePrice: 'rate_amount',

    // ── Shipment [sandbox] ──
    shipmentList: 'shipments',
    shipmentReference: 'tracking_reference',
    shipmentStatus: 'status',
    // 'success' once the courier has the booking; anything else is not booked.
    submissionStatus: 'submission_status',
    updatedAt: 'time_modified',
    createdAt: 'time_created',
  },

  // [sandbox] rates are rands (number), converted to integer cents.
  priceUnit: 'rands' as const,
  // [sandbox] the answer that marks a rate, a courier's rate request and a submission as good.
  successWord: 'success',
  // [sandbox] milliseconds Bob Go waits for couriers (the reference's own values).
  courierTimeoutMs: { rates: 10_000, create: 20_000 },
  // [assumed] quote expiry is unknown. We hold a Bob Go price for 15 minutes at
  // most (the core never charges a quote past its expiry).
  quoteValidityMinutes: 15,
  countryCode: 'ZA',

  /**
   * [assumed] Which couriers and service levels we may book, as
   * `provider_slug:service_level_code` (e.g. `thecourierguy:ECO`). EMPTY on purpose.
   *
   * Bob Go is an aggregator: one rate request returns options from several
   * couriers, and some break custody (Pargo is a counter hand-over; overnight
   * networks do not suit a same-day rental) [research]. The adapter never
   * picks a courier on price alone: it quotes and books ONLY entries listed
   * here. Until each courier behind an entry is approved for hand-to-hand
   * rented gear, the list is empty and every quote is refused (nothing is sent).
   * The sandbox's own couriers are `sandbox` and `demo` (service levels ECO,
   * LOF, LSE, LSX); they are never listed here.
   */
  approvedServiceLevels: [] as readonly string[],

  /**
   * [research] RAM needs written consent for lithium batteries; other
   * couriers' rules are unknown. Until Bob Go confirms in writing which
   * service levels accept them, a parcel with lithium is refused locally.
   */
  lithiumAccepted: false,

  // Our own HTTP timeouts: a little above the courier waits we ask Bob Go for.
  timeoutsMs: { read: 8_000, quote: 15_000, create: 25_000, cancel: 10_000 },
  breaker: { failureThreshold: 5, cooldownMs: 60_000 },

  /**
   * [assumed] Webhook signing scheme: UNKNOWN. The reference has no webhook
   * section; how a delivery is signed is not known, so no algorithm is
   * implemented and the parser stays closed (webhook.ts).
   */
  webhookSigning: null,
} as const;

/** `provider_slug:service_level_code`, the key the approved list uses. */
export function bobgoServiceLevelKey(providerSlug: string, serviceLevelCode: string): string {
  return `${providerSlug}:${serviceLevelCode}`;
}

/** Splits an approved-list key back into its courier and service level. Null if malformed. */
export function parseBobgoServiceLevelKey(key: string | null | undefined): { providerSlug: string; serviceLevelCode: string } | null {
  const m = /^([^:\s]+):([^:\s]+)$/.exec(key ?? '');
  return m ? { providerSlug: m[1], serviceLevelCode: m[2] } : null;
}

/**
 * Status words. Only unambiguous words are mapped; everything else is
 * 'unknown', which the core never applies (and the core only ever moves a leg
 * forward, D13), so a wrong or new word cannot move a shipment.
 *
 * Seen in the sandbox: "pending-collection" (just booked), "cancelled", and in
 * the reference's example "submitted", "collection-assigned", "collected".
 * Deliberately NOT mapped: "collected" (from us, or by the recipient from a
 * pickup point?), "submitted", "pending-collection", "collection-assigned"
 * and any exception word.
 */
export const BOBGO_STATUS: Readonly<Record<string, ProviderDeliveryState>> = {
  delivered: 'delivered',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  'in-transit': 'in_transit',
  in_transit: 'in_transit',
};

export function mapBobgoStatus(status: unknown): ProviderDeliveryState {
  if (typeof status !== 'string') return 'unknown';
  return BOBGO_STATUS[status.trim().toLowerCase()] ?? 'unknown';
}

/**
 * Capabilities for OUR account: NOTHING is claimed. A flag turns true only
 * once Bob Go confirms it in writing AND it is tested in the sandbox:
 *
 *  - onDemand, scheduled: same-day and future collections are courier-
 *    dependent [research]; which service levels we may use is not settled;
 *  - reverseLogistics: returns exist (POST /orders/return) [docs], not wired;
 *  - liveTracking, trackingWebhooks: tracking events have no verified
 *    location; webhook signing unknown;
 *  - pickupConfirmation, proofOfDelivery, signature, recipientPin: a POD
 *    endpoint exists [sandbox], but what a courier puts in it is unknown;
 *  - noLeaveAtDoor: no per-shipment control known;
 *  - declaredValueSupport, verifiedTransitCover: cover passes through each
 *    courier, with second-hand exclusions [research];
 *  - cancellation: works in the sandbox, not yet confirmed in writing;
 *  - idempotentCreate: FALSE, and proven so: the sandbox booked two
 *    shipments under one custom reference.
 *
 * With every flag false, the risk gate excludes Bob Go even if every policy
 * gate is opened (policy.ts, DELIVERY_POLICY.requiredCourierCapabilities).
 */
export const BOBGO_CAPABILITIES: DeliveryCapabilities = {
  onDemand: false,
  scheduled: false,
  reverseLogistics: false,
  liveTracking: false,
  trackingWebhooks: false,
  pickupConfirmation: false,
  proofOfDelivery: false,
  signature: false,
  recipientPin: false,
  declaredValueSupport: false,
  verifiedTransitCover: false,
  cancellation: false,
  noLeaveAtDoor: false,
  idempotentCreate: false,
};

/** Contract items and their sources, for the docs and the tests (kept in step with the comments above). */
export const BOBGO_CONTRACT_SOURCES: Readonly<Record<string, ContractSource>> = {
  'baseUrl.production': 'docs',
  'baseUrl.sandbox': 'sandbox',
  'auth.header': 'sandbox',
  'paths.rates': 'sandbox',
  'paths.createShipment': 'sandbox',
  'paths.shipmentsByReference': 'sandbox',
  'paths.cancelShipment': 'sandbox',
  'paths.tracking': 'sandbox',
  'paths.proofOfDelivery': 'sandbox',
  fields: 'sandbox',
  priceUnit: 'sandbox',
  courierTimeoutMs: 'sandbox',
  quoteValidityMinutes: 'assumed',
  approvedServiceLevels: 'assumed',
  lithiumAccepted: 'research',
  webhookSigning: 'assumed',
  status: 'sandbox',
};
