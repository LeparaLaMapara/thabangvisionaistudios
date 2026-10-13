/**
 * Ports for delivery (spec Phase 4 §4.4–4.5). Couriers, our own vehicle and
 * future insured partners are adapters behind DeliveryPort; the rental rules
 * never import a provider. Every provider call returns ProviderCallResult so
 * a refusal (safe to mark failed) is never confused with an unknown outcome
 * (reconcile before any retry: a timeout must never book a second courier).
 * Amounts are integer cents. Pure module: no provider, Supabase or Next.js.
 */

import type { ProviderCallResult } from '@/lib/core/ports';
import type { DeliveryCapabilities } from './capabilities';

/** A point a driver goes to. Contact details travel only to the adapter that needs them. */
export interface DeliveryPoint {
  /** Our id for the place (an owner's handover location, our office, the renter's saved address). */
  placeId: string;
  lat: number;
  lng: number;
  /** Street address, as verified server-side (AddressPort), never as typed by the browser. */
  formattedAddress: string;
  suburb: string | null;
  city: string | null;
  postalCode: string | null;
  /** Province as verified server-side (service-area check). Optional so older callers still compile. */
  province?: string | null;
  /** First name (or business name) and phone for the driver only: no ID numbers, no surnames needed. */
  contactName: string;
  contactPhone: string;
  instructions: string | null;
}

export interface ParcelItem {
  /** smart_rentals id. */
  rentalId: string;
  /** Equipment booking line id, so custody is per item. */
  bookingId: string;
  /** Description shown to the driver: generic ("camera equipment"), never the value. */
  driverLabel: string;
  /** Replacement value of ALL the units on this line. */
  replacementValueCents: number;
  /** Units of this listing on the line (default 1). A line of 3 tripods is 3 items to carry. */
  quantity?: number;
  weightGrams: number | null;
  /** Contains lithium-ion batteries (many couriers restrict them). */
  containsLithium: boolean;
}

/** Physical units on a parcel: the sum of each line's quantity (at least 1 each). */
export function parcelUnits(items: readonly Pick<ParcelItem, 'quantity'>[]): number {
  return items.reduce((n, i) => n + Math.max(1, Math.floor(i.quantity ?? 1)), 0);
}

export interface DeliveryWindow {
  /** ISO times; null start means as soon as possible. */
  start: string | null;
  end: string | null;
}

export interface ServiceabilityRequest {
  from: Pick<DeliveryPoint, 'lat' | 'lng' | 'suburb' | 'city' | 'postalCode' | 'province'>;
  to: Pick<DeliveryPoint, 'lat' | 'lng' | 'suburb' | 'city' | 'postalCode' | 'province'>;
  window: DeliveryWindow;
  items: readonly ParcelItem[];
}

export interface ServiceabilityResult {
  serviceable: boolean;
  /** Machine code when not serviceable: 'out_of_area' | 'window_unavailable' | 'item_refused' | … */
  reason: string | null;
}

export interface DeliveryQuoteRequest extends ServiceabilityRequest {
  leg: 'outbound' | 'return';
}

/** What a provider charges us. The customer's price is decided by our policy, not here. */
export interface ProviderQuote {
  providerId: string;
  /** The provider's own quote id, if it issues one. */
  providerQuoteRef: string | null;
  providerCostCents: number;
  /** When the provider's price stops being valid. */
  expiresAt: string;
  window: DeliveryWindow;
}

export interface CreateDeliveryRequest {
  /** Our stable reference for this dispatch: the same on every retry of the same leg. */
  merchantReference: string;
  leg: 'outbound' | 'return';
  quote: ProviderQuote;
  from: DeliveryPoint;
  to: DeliveryPoint;
  items: readonly ParcelItem[];
  window: DeliveryWindow;
  requirements: {
    /** Hand-to-hand: never leave unattended. */
    noLeaveAtDoor: boolean;
    /**
     * A recipient PIN we made, for a provider that takes ours. Uber Direct
     * makes its own (and texts it to the drop-off phone): it comes back as
     * ProviderDelivery.recipientPin instead.
     */
    recipientPin: string | null;
    declaredValueCents: number | null;
  };
}

/** Provider-side states, mapped by each adapter onto our canonical states. */
export type ProviderDeliveryState =
  | 'pending'
  | 'courier_assigned'
  | 'courier_at_pickup'
  | 'collected'
  | 'in_transit'
  | 'courier_at_dropoff'
  | 'delivered'
  | 'delivery_attempt_failed'
  | 'return_to_sender'
  | 'cancelled'
  | 'failed'
  /** The provider reports the parcel lost or damaged in its care (opens an incident). */
  | 'lost'
  | 'damaged'
  | 'unknown';

export interface ProviderDelivery {
  providerReference: string;
  merchantReference: string;
  state: ProviderDeliveryState;
  /** When the provider says the state was reached (may arrive out of order). */
  stateAt: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  /** Proof returned by the provider, as references (no raw images stored here). */
  proof: { kind: 'pin' | 'signature' | 'photo' | 'scan'; ref: string }[];
  /** The drop-off PIN the provider made, when it makes one (Uber Direct pincode). */
  recipientPin?: string | null;
}

export interface TrackingResult {
  state: ProviderDeliveryState;
  etaAt: string | null;
  location: { lat: number; lng: number; at: string } | null;
  trackingUrl: string | null;
}

export interface DeliveryPort {
  readonly providerId: string;
  /**
   * 'courier': a third party carries the gear (insurance and custody gates
   * apply, we owe the provider). 'own_fleet': our own vehicle and staff (the
   * manual adapter). Omitted means 'courier' (the stricter rules).
   */
  readonly kind?: 'courier' | 'own_fleet';
  /** 'sandbox' adapters are never offered to customers unless explicitly allowed. Omitted means 'production'. */
  readonly mode?: 'sandbox' | 'production';
  /** Verified for our account (see capabilities.ts). */
  readonly capabilities: DeliveryCapabilities;
  checkServiceability(r: ServiceabilityRequest): Promise<ProviderCallResult<ServiceabilityResult>>;
  quote(r: DeliveryQuoteRequest): Promise<ProviderCallResult<ProviderQuote>>;
  createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>>;
  /** Look a job up by OUR reference: how an uncertain create is reconciled before any retry. */
  findByMerchantReference(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>>;
  getDelivery(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>>;
  cancelDelivery(providerReference: string, reason: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>>;
  getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>>;
}

/** Server-side address verification (the browser's coordinates are never trusted for a price). */
export interface AddressPort {
  readonly providerId: string;
  /** Geocode a typed address inside the service country. */
  geocode(text: string): Promise<ProviderCallResult<Omit<DeliveryPoint, 'placeId' | 'contactName' | 'contactPhone' | 'instructions'> | null>>;
}

/**
 * Whether a shipment is covered in transit (spec §4.13). Until a policy is
 * verified in writing, the adapter answers "not covered" and automated
 * courier delivery stays blocked.
 */
export interface DeliveryInsurancePort {
  coverFor(p: { providerId: string; items: readonly ParcelItem[]; leg: 'outbound' | 'return' }): Promise<{
    covered: boolean;
    /** Policy reference when covered. */
    policyRef: string | null;
    /** Highest replacement value per item the cover accepts. */
    maxItemValueCents: number;
    reason: string | null;
  }>;
}
