import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import type { ProviderDeliveryState } from '@/lib/core/delivery/port';

/**
 * WumDrop: everything provider-specific that may need correcting lives here
 * (docs/logistics/wumdrop.md).
 *
 * VERIFIED (docs/logistics/provider-comparison.md, wumdrop.readme.io; the docs
 * are dated, so re-check):
 *   - API with a sandbox key on registration;
 *   - Johannesburg and Pretoria;
 *   - Priority (on demand) and Standard (same day) services;
 *   - proof of delivery: image, signature, or ID plus signature;
 *   - create with a unique `order_reference` (a duplicate is refused);
 *   - lookup by our reference: /deliveries/ext/:order_reference;
 *   - R40,000 default cover from OLD pages, below our R50,000 ceiling, with
 *     exclusions: NOT treated as verified transit cover.
 *
 * NOT verified (NV in the research): quote expiry, scheduling a future
 * window, pickup confirmation, PIN, leave-at-door control, returns, webhook
 * signing. Every `// VERIFY:` marks a detail to confirm before enabling.
 */

export const WUMDROP_PROVIDER_ID = 'wumdrop';

export const WUMDROP_API = {
  // VERIFY: hosts. The sandbox may use the same host with a sandbox key.
  baseUrl: { sandbox: 'https://api.wumdrop.com', production: 'https://api.wumdrop.com' },
  paths: {
    // Verified (task research): create.
    create: '/v1/deliveries',
    // Verified: lookup by our order_reference. VERIFY: the /v1 prefix.
    byReference: (orderReference: string): string => `/v1/deliveries/ext/${encodeURIComponent(orderReference)}`,
    // VERIFY: read one delivery by WumDrop's id.
    get: (id: string): string => `/v1/deliveries/${encodeURIComponent(id)}`,
    // VERIFY: cancel is DELETE on the delivery.
    cancel: (id: string): string => `/v1/deliveries/${encodeURIComponent(id)}`,
    // VERIFY: quote endpoint and request fields.
    quote: '/v1/quotes',
  },
  // VERIFY: Basic auth with the API key as the user name and an empty password.
  basicAuth: (apiKey: string): string => `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
  // VERIFY: quote price field and unit (rands, possibly as a string).
  quotePriceField: 'price',
  // VERIFY: quote expiry is not documented. We hold a WumDrop price for 15
  // minutes at most (the core never charges a quote past its expiry).
  quoteValidityMinutes: 15,
  timeoutsMs: { read: 8_000, create: 15_000, cancel: 10_000 },
  breaker: { failureThreshold: 5, cooldownMs: 60_000 },
} as const;

/**
 * VERIFY: WumDrop's status names are not in our research. Only unambiguous
 * words are mapped; everything else is 'unknown' (the core never applies it).
 */
export const WUMDROP_STATUS: Readonly<Record<string, ProviderDeliveryState>> = {
  delivered: 'delivered',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function mapWumdropStatus(status: unknown): ProviderDeliveryState {
  if (typeof status !== 'string') return 'unknown';
  return WUMDROP_STATUS[status.trim().toLowerCase()] ?? 'unknown';
}

/**
 * Capabilities for OUR account: only what the research verified.
 *
 *  - onDemand: Priority service.
 *  - proofOfDelivery, signature: image / signature / ID + signature POD.
 *  - idempotentCreate: unique order_reference refused twice, and a lookup by
 *    it (findByMerchantReference).
 *  - scheduled: false (Standard is same day; a chosen future window is NV).
 *  - reverseLogistics: false (returns NV).
 *  - liveTracking, trackingWebhooks: false (status/GPS only via third
 *    parties; webhook signing NV — polling is the fallback).
 *  - pickupConfirmation: false (NV).
 *  - recipientPin: false (NV). noLeaveAtDoor: false (NV).
 *  - declaredValueSupport: false (NV).
 *  - cancellation: false (the DELETE call is implemented but not verified).
 *  - verifiedTransitCover: false (R40k default cover is old, unverified and
 *    below R50k).
 *
 * With pickupConfirmation and noLeaveAtDoor false, the risk gate excludes
 * WumDrop until both are confirmed in writing.
 */
export const WUMDROP_CAPABILITIES: DeliveryCapabilities = {
  onDemand: true,
  scheduled: false,
  reverseLogistics: false,
  liveTracking: false,
  trackingWebhooks: false,
  pickupConfirmation: false,
  proofOfDelivery: true,
  signature: true,
  recipientPin: false,
  declaredValueSupport: false,
  verifiedTransitCover: false,
  cancellation: false,
  noLeaveAtDoor: false,
  idempotentCreate: true,
};
