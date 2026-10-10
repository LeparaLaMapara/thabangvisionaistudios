import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import type { ProviderDeliveryState } from '@/lib/core/delivery/port';

/**
 * Bob Go: the API contract the adapter ASSUMES.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ UNVERIFIED — confirm against the official Bob Go API reference before   │
 * │ enabling. The reference is gated behind Bob Go sales                    │
 * │ (sales@bobgo.co.za); nothing here has been checked against it or        │
 * │ exercised in a Bob Go sandbox.                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Every endpoint path, header, request/response field and status word the
 * adapter uses lives in THIS file, so correcting the contract never means
 * hunting through adapter code. Each item is tagged with where it comes from:
 *
 *   [plugin]   seen in a third-party WooCommerce plugin that calls Bob Go
 *              (path and method only; the plugin is not Bob Go's documentation);
 *   [research] docs/logistics/provider-comparison.md (public pages, NV there too);
 *   [assumed]  our guess. Treat as wrong until Bob Go confirms it.
 *
 * Questions to send Bob Go: docs/logistics/bobgo.md.
 */

export const BOBGO_PROVIDER_ID = 'bobgo';

/** Where each contract item comes from. */
export type ContractSource = 'plugin' | 'research' | 'assumed';

export const BOBGO_CONTRACT = {
  baseUrl: {
    // [plugin] production host and the /v2 prefix.
    production: 'https://api.bobgo.co.za/v2',
    // [assumed] a separate sandbox host. Bob Go has a sandbox [research]; its
    // host is unknown. A sandbox key may instead work against the production
    // host: confirm before pointing anything at either.
    sandbox: 'https://api.sandbox.bobgo.co.za/v2',
  },

  auth: {
    // [assumed] `Authorization: Bearer <merchant API key>`. The plugin
    // authenticates with the merchant API key [plugin]; the header form is a guess.
    header: 'Authorization',
    value: (apiKey: string): string => `Bearer ${apiKey}`,
  },

  paths: {
    // [plugin] POST: rates for a parcel between two addresses.
    rates: '/rates-at-checkout',
    // [plugin] POST: create an order (a shipment request).
    createOrder: '/orders',
    // [assumed] GET one order by Bob Go's id. The plugin GETs /orders; the
    // id-in-path form is a guess.
    getOrder: (id: string): string => `/orders/${encodeURIComponent(id)}`,
    // [plugin] PATCH /orders exists; [assumed] that cancelling is a PATCH on
    // the order with `cancelBody` below.
    cancelOrder: (id: string): string => `/orders/${encodeURIComponent(id)}`,
    // [assumed] GET /orders filtered by OUR reference. The plugin GETs
    // /orders [plugin]; the query parameter is a guess. The adapter accepts
    // only an order that echoes our reference exactly in `fields.merchantReference`
    // and NEVER reads an empty answer as "no such order" (see adapter.ts).
    findByReference: (merchantReference: string): string => `/orders?channel_order_number=${encodeURIComponent(merchantReference)}`,
    // [plugin] GET /tracking and GET/POST/DELETE /webhooks exist. NOT called:
    // tracking is read from the order, and webhooks are never registered by
    // code (no signing scheme is known, so they would be refused anyway).
    tracking: '/tracking',
    webhooks: '/webhooks',
  },

  /** [assumed] Field names in requests and responses. */
  fields: {
    // Request: our stable reference for the leg (also what the lookup filters on).
    merchantReference: 'channel_order_number',
    // Request: the service level chosen from the rates (the courier + service).
    serviceLevelCode: 'service_level_code',
    collectionAddress: 'collection_address',
    deliveryAddress: 'delivery_address',
    collectionContact: 'collection_contact',
    deliveryContact: 'delivery_contact',
    parcels: 'parcels',
    collectionInstructions: 'collection_instructions',
    deliveryInstructions: 'delivery_instructions',
    // Parcel sub-fields: a generic label, a count and a weight. No value is ever sent.
    parcel: { description: 'description', quantity: 'quantity', weightKg: 'submitted_weight_kg' },
    // Address sub-fields.
    address: { street: 'street_address', suburb: 'local_area', city: 'city', province: 'zone', postalCode: 'code', country: 'country', lat: 'lat', lng: 'lng' },
    contact: { name: 'name', phone: 'mobile_number' },
    // Response: the order may come bare or wrapped in one of these keys.
    orderWrappers: ['order', 'data'],
    // Response: Bob Go's order id, our reference, status, time, tracking.
    orderId: 'id',
    orderStatus: 'status',
    updatedAt: 'time_modified',
    createdAt: 'time_created',
    // The order's first shipment carries the courier-side status and tracking.
    shipments: 'shipments',
    shipmentStatus: 'status',
    shipmentTrackingUrl: 'tracking_url',
    // Rates response: a list, each with a service level code and a price.
    rates: 'rates',
    ratePrice: 'total_price',
    rateServiceLevelCode: 'service_level_code',
    rateCurrency: 'currency',
    // Lookup response: a list of orders.
    orderList: 'orders',
  },

  // [assumed] prices are rands (number or decimal string), converted to integer cents.
  priceUnit: 'rands' as const,
  // [assumed] currency. A rate in another currency is refused.
  currency: 'ZAR',
  // [assumed] cancel = PATCH the order with this body.
  cancelBody: { status: 'cancelled' } as const,
  // [assumed] quote expiry is unknown. We hold a Bob Go price for 15 minutes at
  // most (the core never charges a quote past its expiry).
  quoteValidityMinutes: 15,
  countryCode: 'ZA',

  /**
   * [assumed] Which Bob Go service levels we may book. EMPTY on purpose.
   *
   * Bob Go is an aggregator: one rate request returns options from several
   * couriers, and some break custody (Pargo is a counter hand-over; overnight
   * networks do not suit a same-day rental) [research]. The adapter never
   * picks a courier on price alone: it quotes and books ONLY service levels
   * listed here. Until the codes are confirmed with Bob Go and each courier
   * behind them is approved for hand-to-hand rented gear, the list is empty
   * and every quote is refused (nothing is sent).
   */
  approvedServiceLevelCodes: [] as readonly string[],

  /**
   * [research] RAM needs written consent for lithium batteries; other
   * couriers' rules are unknown. Until Bob Go confirms in writing which
   * service levels accept them, a parcel with lithium is refused locally.
   */
  lithiumAccepted: false,

  timeoutsMs: { read: 8_000, create: 15_000, cancel: 10_000 },
  breaker: { failureThreshold: 5, cooldownMs: 60_000 },

  /**
   * [assumed] Webhook signing scheme: UNKNOWN. Bob Go has subscription
   * endpoints [plugin, research]; how a delivery is signed is not known, so
   * no algorithm is implemented and the parser stays closed (webhook.ts).
   */
  webhookSigning: null,
} as const;

/**
 * [assumed] Status words. Only unambiguous words are mapped; everything else
 * is 'unknown', which the core never applies (and the core only ever moves a
 * leg forward, D13), so a wrong or new word cannot move a shipment.
 *
 * Deliberately NOT mapped: "collected" (could mean collected from a pickup
 * point by the recipient, or by the courier from us), "submitted",
 * "ready", "open", "pending-collection" and any exception word.
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
 * Capabilities for OUR account: NOTHING is verified, so nothing is claimed.
 * Every flag is false until Bob Go confirms it in writing and it is tested in
 * the sandbox:
 *
 *  - onDemand, scheduled: same-day and future collections are courier-
 *    dependent [research]; which service levels we may use is not settled;
 *  - reverseLogistics: TCG returns exist [research], not through our account;
 *  - liveTracking, trackingWebhooks: no verified location; webhook signing unknown;
 *  - pickupConfirmation, proofOfDelivery, signature, recipientPin: TCG uses
 *    OTP or signature [research], but whether the API returns it is unknown;
 *  - noLeaveAtDoor: no per-shipment control known;
 *  - declaredValueSupport, verifiedTransitCover: cover passes through each
 *    courier, with second-hand exclusions [research];
 *  - cancellation: the PATCH is implemented but assumed;
 *  - idempotentCreate: duplicate-reference behaviour and the lookup are
 *    assumed. The lookup is still used (a positive, exact match is safe),
 *    but an empty answer is never read as "none".
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
  'baseUrl.production': 'plugin',
  'baseUrl.sandbox': 'assumed',
  'auth.header': 'assumed',
  'paths.rates': 'plugin',
  'paths.createOrder': 'plugin',
  'paths.getOrder': 'assumed',
  'paths.cancelOrder': 'assumed',
  'paths.findByReference': 'assumed',
  'paths.tracking': 'plugin',
  'paths.webhooks': 'plugin',
  fields: 'assumed',
  priceUnit: 'assumed',
  currency: 'assumed',
  cancelBody: 'assumed',
  quoteValidityMinutes: 'assumed',
  approvedServiceLevelCodes: 'assumed',
  lithiumAccepted: 'research',
  webhookSigning: 'assumed',
  status: 'assumed',
};
