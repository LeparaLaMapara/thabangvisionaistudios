/**
 * What a delivery adapter can actually do (spec Phase 4 §4.5). Flags describe
 * features VERIFIED and operationally available for our merchant account, not
 * what a provider advertises: until verified, a flag is false. Pure module.
 */

export interface DeliveryCapabilities {
  /** Dispatch as soon as possible (same day). */
  onDemand: boolean;
  /** Book for a chosen future window. */
  scheduled: boolean;
  /** Collect from the renter and bring back (return legs). */
  reverseLogistics: boolean;
  /** Live driver location. */
  liveTracking: boolean;
  /** Status pushed to us by signed webhooks. */
  trackingWebhooks: boolean;
  /** The driver confirms collection (scan, PIN or photo). */
  pickupConfirmation: boolean;
  /** Proof of delivery returned to us (photo, signature or PIN). */
  proofOfDelivery: boolean;
  signature: boolean;
  /** A one-time PIN the recipient gives the driver. */
  recipientPin: boolean;
  /** The provider records a declared value for the parcel. */
  declaredValueSupport: boolean;
  /** Goods-in-transit cover verified in writing for rented camera equipment (not a liability limit). */
  verifiedTransitCover: boolean;
  /** Cancel an unstarted job through the API. */
  cancellation: boolean;
  /** Hand-to-hand only: the provider can be told never to leave a parcel unattended. */
  noLeaveAtDoor: boolean;
  /** Create calls accept our stable reference and refuse a duplicate (or let us look it up). */
  idempotentCreate: boolean;
}

export type DeliveryNeed = keyof DeliveryCapabilities;

export const NO_DELIVERY_CAPABILITIES: DeliveryCapabilities = {
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

/** The flags an adapter lacks from a list of needs. */
export function missingCapabilities(c: DeliveryCapabilities, needs: readonly DeliveryNeed[]): DeliveryNeed[] {
  return needs.filter((n) => !c[n]);
}
