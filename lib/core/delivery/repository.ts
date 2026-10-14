/**
 * Repository and supporting ports for the delivery use cases (spec Phase 4
 * §4.4, §4.16). Pure interfaces: the Supabase adapter is lib/delivery/repos.ts
 * and the tests use in-memory fakes.
 */

import type { Clock } from '@/lib/core/ports';
import type { Journal } from '@/lib/core/rental/ledger';
import type { OutboxMessage } from '@/lib/core/rental/notifications';
import type { BookingStatus } from '@/lib/core/rental/state';
import type { HoldingForTrust, RenterFacts } from '@/lib/core/rental/trust';
import type { CustodyEvent } from './custody';
import type { DeliveryIncident, IncidentStatus } from './incidents';
import type { OwnerPickupDecision } from './origin';
import type { DeliveryPolicyValues } from './policy';
import type { DeliveryInsurancePort, DeliveryPoint, DeliveryPort, DeliveryWindow } from './port';
import type { CustomerDeliveryQuote, QuoteStatus } from './quote';
import type { DeliveryState, ShipmentLeg } from './state';

export interface ShipmentItem {
  bookingId: string;
  rentalId: string;
  ownerId: string | null;
  serialNumber: string | null;
}

/** One dispatch attempt of one leg of one order (a row of delivery_shipments). */
export interface Shipment {
  id: string;
  bookingGroupId: string;
  leg: ShipmentLeg;
  attempt: number;
  renterId: string;
  items: ShipmentItem[];
  /**
   * Where the gear lives (Phase 8, migration 080): null (or absent, before
   * 080) = our site; an owner's user id = that owner's pickup address. The
   * outbound leg starts there, the return leg ends there. One live leg per
   * order, leg and origin.
   */
  originOwnerId?: string | null;
  providerId: string;
  providerKind: 'courier' | 'own_fleet';
  quoteId: string;
  merchantReference: string;
  providerReference: string | null;
  status: DeliveryState;
  /** The provider's quoted price for this leg. */
  quoteAmountCents: number;
  /** What the customer pays for this leg. */
  customerFeeCents: number;
  platformFeeCents: number;
  /** Courier cost booked to the ledger so far (job + fees − reductions). */
  accruedCostCents: number;
  /** The provider's final invoiced cost, once reconciled. */
  providerCostCents: number | null;
  replacementValueCents: number;
  coverageVerified: boolean;
  insuranceReference: string | null;
  trackingReference: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  /** Drop-off PIN the courier made (089). Shown to the renter of an outbound leg only. */
  recipientPin?: string | null;
  originAddressId: string;
  destinationAddressId: string;
  window: DeliveryWindow;
  scheduledAt: string | null;
  collectedAt: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  /** Provider timestamp of the last applied provider update (D13). */
  lastProviderStateAt: string | null;
  /** The payment reference that captured this leg's fee; null = not paid. */
  paidReference: string | null;
  createdAt: string;
}

export type DispatchIntentState = 'pending' | 'claimed' | 'succeeded' | 'unknown' | 'rejected';

/** Durable record that we intend to (or did) call the provider for a shipment (D09, D10). */
export interface DispatchIntent {
  id: string;
  shipmentId: string;
  merchantReference: string;
  idempotencyKey: string;
  providerId: string;
  state: DispatchIntentState;
  attempts: number;
  claimedAt: string | null;
  lastError: string | null;
  providerReference: string | null;
}

export type ShipmentPatch = Partial<
  Pick<
    Shipment,
    | 'providerReference'
    | 'trackingReference'
    | 'trackingUrl'
    | 'courierName'
    | 'scheduledAt'
    | 'collectedAt'
    | 'deliveredAt'
    | 'acceptedAt'
    | 'lastProviderStateAt'
    | 'providerCostCents'
    | 'accruedCostCents'
  >
>;

export type DeliveryEventSource = 'provider_webhook' | 'provider_poll' | 'staff' | 'system' | 'renter' | 'owner';

export interface DeliveryProof {
  shipmentId: string;
  bookingId: string | null;
  kind: 'pin' | 'signature' | 'photo' | 'scan' | 'provider_confirmation' | 'renter_acceptance';
  ref: string;
  source: 'provider' | 'staff' | 'renter' | 'owner';
  capturedAt: string;
}

/**
 * One atomic change to a shipment. The adapter applies it in ONE transaction:
 * compare-and-set on the status (`from`), append the canonical event (unique
 * dedupe key), custody events, proofs, incidents, journals, notices and the
 * refund obligation. Either everything commits or nothing does.
 * `to` may equal the current status for a patch-only change (still CAS).
 */
export interface ShipmentTransition {
  shipmentId: string;
  from: readonly DeliveryState[];
  to: DeliveryState;
  patch: ShipmentPatch;
  event: {
    source: DeliveryEventSource;
    actorId: string | null;
    /** Unique: a replayed provider event or confirmation is applied once (D12). */
    dedupeKey: string | null;
    providerState: string | null;
    occurredAt: string;
    note: string | null;
  };
  custody: CustodyEvent[];
  proofs: DeliveryProof[];
  incidents: DeliveryIncident[];
  journals: Journal[];
  notices: OutboxMessage[];
  /** A refund obligation for the customer's delivery fee (reason 'cancellation'). */
  refund: { key: string; amountCents: number; paidReference: string; userId: string; bookingIds: string[] } | null;
  /** Quote status change in the same transaction. */
  quoteStatus?: { quoteId: string; to: QuoteStatus } | null;
}

export type TransitionResult = 'applied' | 'conflict' | 'duplicate';

/**
 * A paid quote whose leg was never made (after-payment prepare refused it, or
 * the order was cancelled first): the fee is owed back. Applied atomically:
 * compare-and-set the quote from `paid` to `refunded` (only while no live
 * shipment uses it), the journal, the refund obligation (capped at what is
 * left of the charge) and the notices. A manual (hand-taken) payment gets no
 * provider refund obligation; a person refunds it (staff alert in `notices`).
 */
export interface UnusedQuoteRefund {
  quoteId: string;
  bookingGroupId: string;
  journals: Journal[];
  notices: OutboxMessage[];
  refund: { key: string; amountCents: number; paidReference: string; userId: string; bookingIds: string[] } | null;
}

export interface NewShipment extends Omit<Shipment, 'id' | 'createdAt' | 'status' | 'providerReference' | 'trackingReference' | 'trackingUrl' | 'courierName' | 'scheduledAt' | 'collectedAt' | 'deliveredAt' | 'acceptedAt' | 'lastProviderStateAt' | 'providerCostCents' | 'accruedCostCents'> {
  status: 'prepared';
}

export interface ReconciliationRecord {
  shipmentId: string;
  providerId: string;
  providerInvoiceRef: string;
  quotedCents: number;
  accruedCents: number;
  invoicedCents: number;
  differenceCents: number;
  status: 'matched' | 'over' | 'under';
  checkedAt: string;
  checkedBy: string | null;
}

export interface DeliveryRepository {
  saveQuote(q: Omit<CustomerDeliveryQuote, 'id' | 'createdAt'>): Promise<CustomerDeliveryQuote>;
  getQuote(id: string): Promise<CustomerDeliveryQuote | null>;
  /** Compare-and-set on the quote status. */
  setQuoteStatus(id: string, from: readonly QuoteStatus[], to: QuoteStatus, patch?: { paidReference?: string; bookingGroupId?: string }): Promise<boolean>;

  getShipment(id: string): Promise<Shipment | null>;
  findShipment(by: { merchantReference: string } | { providerId: string; providerReference: string }): Promise<Shipment | null>;
  listShipments(bookingGroupId: string): Promise<Shipment[]>;
  /**
   * Insert the shipment and its dispatch intent together. On a conflict
   * (same order + leg + attempt, or the same merchant reference) returns the
   * existing pair with created = false. For a leg from (or back to) an
   * owner's address, throws OriginAddressChangedError when that address is
   * no longer the owner's active pickup address (checked under the per-owner
   * lock the address save and removal take).
   */
  createShipment(s: NewShipment, intent: Omit<DispatchIntent, 'id' | 'shipmentId' | 'attempts' | 'claimedAt' | 'lastError' | 'providerReference' | 'state'>): Promise<{ shipment: Shipment; intent: DispatchIntent; created: boolean }>;

  getDispatchIntent(shipmentId: string): Promise<DispatchIntent | null>;
  /**
   * Compare-and-set claim: moves the intent to `claimed` (attempts + 1) only
   * if its state is in `from`, or it is `claimed` with claimed_at before
   * `staleBefore`. Exactly one caller wins.
   */
  claimDispatch(intentId: string, from: readonly DispatchIntentState[], now: string, staleBefore: string): Promise<boolean>;
  finishDispatch(intentId: string, to: Exclude<DispatchIntentState, 'pending' | 'claimed'>, patch: { providerReference?: string | null; lastError?: string | null }): Promise<void>;

  transitionShipment(t: ShipmentTransition): Promise<TransitionResult>;
  /** Keep the drop-off PIN the courier made for this leg (089). */
  saveRecipientPin(shipmentId: string, pin: string): Promise<void>;
  /** A canonical event with this dedupe key was already applied. */
  hasEvent(dedupeKey: string): Promise<boolean>;

  listCustody(shipmentId: string): Promise<CustodyEvent[]>;
  listIncidents(bookingGroupId: string): Promise<DeliveryIncident[]>;
  getIncident(id: string): Promise<DeliveryIncident | null>;
  /** Insert an incident (unique dedupe key) with its notices, outside a state change. */
  openIncident(i: DeliveryIncident, notices: OutboxMessage[]): Promise<'inserted' | 'duplicate'>;
  /** Compare-and-set on the incident status. */
  updateIncident(id: string, from: readonly IncidentStatus[], patch: Partial<Pick<DeliveryIncident, 'status' | 'providerCaused' | 'liability'>> & { resolution?: string; resolvedBy?: string | null }): Promise<boolean>;

  /** Insert a reconciliation row (unique per shipment + invoice ref) with its journals and notices. */
  saveReconciliation(r: ReconciliationRecord, journals: Journal[], notices: OutboxMessage[], patch: ShipmentPatch): Promise<'inserted' | 'duplicate'>;
  /** Post journals and notices on their own (idempotent by key). */
  post(journals: Journal[], notices: OutboxMessage[]): Promise<void>;
  /** See UnusedQuoteRefund. 'conflict' when the quote is not paid any more, or a live shipment uses it. */
  refundUnusedQuote(r: UnusedQuoteRefund): Promise<'applied' | 'conflict'>;
}

/** What delivery needs to know about the hire. Read-only. */
export interface DeliveryBookingLine {
  bookingId: string;
  rentalId: string;
  ownerId: string | null;
  serialNumber: string | null;
  status: BookingStatus;
  unitReplacementValueCents: number;
  quantity: number;
  startDate: string;
  endDate: string;
  /** Generic label for a driver ("camera equipment"); never the value. */
  driverLabel: string;
  weightGrams: number | null;
  containsLithium: boolean;
}

export interface DeliveryBookingView {
  bookingGroupId: string;
  renterId: string;
  lines: DeliveryBookingLine[];
  /** The order's payment was verified server-side (intent paid). */
  paymentVerified: boolean;
  paymentReference: string | null;
  /**
   * Set when every live line of the order was confirmed through the
   * manual-payment path (confirm_manual_payment: a person recorded an EFT,
   * cash or card-link payment). Staff, and only staff, may then dispatch the
   * legs whose fee they marked paid (F-2, D-50). Never set by the browser.
   */
  manualPaymentReference?: string | null;
}

export interface DeliveryBookingPort {
  getGroup(bookingGroupId: string): Promise<DeliveryBookingView | null>;
}

/** The same facts the checkout eligibility uses (lib/rental/eligibility-server.ts). */
export interface RenterTrustPort {
  /** `excludeGroupId`: the order being checked; its own lines are not already-held gear. */
  getTrustInputs(renterId: string, opts?: { excludeGroupId?: string | null }): Promise<{ facts: RenterFacts; holdings: HoldingForTrust[] }>;
}

/**
 * Where each listing's gear is collected from (Phase 8). The server reads the
 * listing (community, live, the owner's per-listing opt-in), the owner
 * (verified, not suspended) and the owner's active pickup address. A listing
 * that is not decided `ok` goes from our site (the owner brings it to the
 * studio). Read-only.
 */
export interface DeliveryOriginPort {
  originsFor(rentalIds: readonly string[]): Promise<Map<string, OwnerPickupDecision>>;
}

/** Verified addresses (delivery_addresses), readable only by the server. */
export interface DeliveryAddressStore {
  getPoint(addressId: string): Promise<(DeliveryPoint & { userId: string | null }) | null>;
}

export interface DeliveryProviderRegistry {
  /** Enabled providers in configured priority order. */
  list(): DeliveryPort[];
  get(providerId: string): DeliveryPort | null;
  /** Sandbox adapters may be offered (never in production). */
  allowSandbox: boolean;
}

export interface DeliveryDeps {
  repo: DeliveryRepository;
  bookings: DeliveryBookingPort;
  trust: RenterTrustPort;
  addresses: DeliveryAddressStore;
  providers: DeliveryProviderRegistry;
  insurance: DeliveryInsurancePort;
  clock: Clock;
  /** Feature flag `delivery_courier` and own-vehicle switch, read by the caller. */
  flags: { courierEnabled: boolean; ownFleetEnabled: boolean };
  /** New ids for incidents. */
  newId: () => string;
  /** Policy values; defaults to DELIVERY_POLICY (lib/constants.ts). Tests and staged roll-outs override. */
  policy?: DeliveryPolicyValues;
  /**
   * Where gear is collected from (Phase 8). Absent: every leg runs from our
   * site, as before; a leg from an owner's address is then refused (fail closed).
   */
  origins?: DeliveryOriginPort;
}

/** The owner replaced or removed their pickup address before this leg was stored (080, Codex review). */
export class OriginAddressChangedError extends Error {
  constructor() {
    super('delivery_origin_address_changed');
    this.name = 'OriginAddressChangedError';
  }
}
