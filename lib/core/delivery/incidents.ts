/**
 * Delivery incidents (spec Phase 4 §4.12–4.13). Pure.
 *
 * An incident records that something went wrong with a shipment and keeps
 * the evidence for a lawful claim. It never decides who is to blame:
 *  - no automatic theft accusation: `liability` starts 'undetermined' and only
 *    a person changes it;
 *  - no automatic deposit forfeiture: nothing here touches the deposit;
 *  - a delay the provider caused (or may have caused) is never turned into an
 *    automatic late fee for the renter (D19);
 *  - while any incident on the order is open, the rental is not settled (D29).
 */

import type { ProviderDeliveryState } from './port';
import type { ShipmentLeg } from './state';

export const INCIDENT_KINDS = ['lost', 'damaged', 'stolen', 'delayed', 'failed_attempt', 'driver_no_show'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type IncidentReporter = 'provider' | 'staff' | 'renter' | 'owner' | 'system';

export interface DeliveryIncident {
  id: string;
  shipmentId: string;
  bookingGroupId: string;
  bookingIds: string[];
  leg: ShipmentLeg;
  kind: IncidentKind;
  status: IncidentStatus;
  /**
   * true = the provider caused it; false = it did not; null = not yet known.
   * Only staff (or a provider's own event) ever set true or false; a renter,
   * owner or agent report always starts null. Only an attributed true waives
   * an automatic late fee; an open unattributed incident holds settlement
   * for a person instead (D19, D29).
   */
  providerCaused: boolean | null;
  /** Always 'undetermined' when opened. Only a person sets anything else. */
  liability: 'undetermined' | 'provider' | 'renter' | 'owner' | 'platform' | 'none';
  reportedBy: { kind: IncidentReporter; id: string | null };
  description: string;
  evidence: { kind: string; ref: string }[];
  /** One incident per (shipment, kind, discriminator): a replayed event opens nothing new. */
  dedupeKey: string;
  createdAt: string;
}

export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = ['open', 'investigating'];

export function incidentKey(shipmentId: string, kind: IncidentKind, discriminator = ''): string {
  return `incident:${shipmentId}:${kind}${discriminator ? `:${discriminator}` : ''}`;
}

/** Build a new incident. Never accuses anyone. */
export function newIncident(p: {
  id: string;
  shipmentId: string;
  bookingGroupId: string;
  bookingIds: string[];
  leg: ShipmentLeg;
  kind: IncidentKind;
  reportedBy: DeliveryIncident['reportedBy'];
  description: string;
  evidence?: DeliveryIncident['evidence'];
  /**
   * Set only by staff or from a provider's own event (e.g. the provider
   * reports its driver lost the parcel). Anyone else: leave it out (null).
   */
  providerCaused?: boolean | null;
  discriminator?: string;
  now: Date;
}): DeliveryIncident {
  // Never inferred from the kind: a renter saying "the driver did not come" does not attribute it.
  const providerCaused = p.providerCaused === undefined ? null : p.providerCaused;
  return {
    id: p.id,
    shipmentId: p.shipmentId,
    bookingGroupId: p.bookingGroupId,
    bookingIds: p.bookingIds,
    leg: p.leg,
    kind: p.kind,
    status: 'open',
    providerCaused,
    liability: 'undetermined',
    reportedBy: p.reportedBy,
    description: p.description.slice(0, 2000),
    evidence: p.evidence ?? [],
    dedupeKey: incidentKey(p.shipmentId, p.kind, p.discriminator),
    createdAt: p.now.toISOString(),
  };
}

/** The incident a provider state opens by itself (D16), if any. */
export function incidentKindForProviderState(s: ProviderDeliveryState): IncidentKind | null {
  switch (s) {
    case 'lost':
      return 'lost';
    case 'damaged':
      return 'damaged';
    case 'delivery_attempt_failed':
      return 'failed_attempt';
    default:
      return null;
  }
}

export function isOpen(i: Pick<DeliveryIncident, 'status'>): boolean {
  return OPEN_INCIDENT_STATUSES.includes(i.status);
}

/** D29: an open delivery incident on the order holds settlement (deposit, payout). */
export function settlementBlockedByIncidents(incidents: readonly Pick<DeliveryIncident, 'status' | 'bookingIds'>[], bookingId?: string): { blocked: boolean; open: number } {
  const relevant = incidents.filter((i) => isOpen(i) && (bookingId === undefined || i.bookingIds.length === 0 || i.bookingIds.includes(bookingId)));
  return { blocked: relevant.length > 0, open: relevant.length };
}

/**
 * D19: whether a late fee for this return may be charged automatically.
 * Waived only for a delay, no-show or failed collection on the RETURN leg
 * that staff (or the provider's own event) attributed to the provider
 * (`providerCaused === true`). An unattributed incident does not waive
 * anything silently: while it is open it holds settlement for a person
 * (settlementBlockedByIncidents); resolved without attribution, the normal
 * late-fee rule applies.
 */
export function lateFeeAutoChargeAllowed(incidents: readonly Pick<DeliveryIncident, 'leg' | 'kind' | 'providerCaused'>[]): { allowed: boolean; reason: string | null } {
  const delay = incidents.find(
    (i) => i.leg === 'return' && (i.kind === 'delayed' || i.kind === 'driver_no_show' || i.kind === 'failed_attempt') && i.providerCaused === true,
  );
  if (delay) return { allowed: false, reason: 'provider_caused_delay' };
  return { allowed: true, reason: null };
}

/**
 * D17: whether the deposit for these items may be settled. A courier
 * collecting the return is not enough: every item must be received back and
 * inspected, and no incident may be open.
 */
export function depositSettlementAllowed(p: {
  everyItemInspected: boolean;
  incidents: readonly Pick<DeliveryIncident, 'status' | 'bookingIds'>[];
}): { allowed: boolean; reason: string | null } {
  if (!p.everyItemInspected) return { allowed: false, reason: 'awaiting_inspection' };
  if (settlementBlockedByIncidents(p.incidents).blocked) return { allowed: false, reason: 'open_delivery_incident' };
  return { allowed: true, reason: null };
}
