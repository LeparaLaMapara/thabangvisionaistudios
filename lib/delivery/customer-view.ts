import type { BookingStatus } from '@/lib/core/rental/state';
import type { Shipment } from '@/lib/core/delivery/repository';
import { FINAL_DELIVERY_STATES, type DeliveryState, type ShipmentLeg } from '@/lib/core/delivery/state';
import type { DeliveryStatusLeg } from '@/lib/core/delivery/use-cases';
import { windowLabel } from './checkout';

/**
 * What a renter sees of their delivery (spec §4.17). Pure.
 *
 * Only what a provider or our staff actually recorded: no invented courier
 * name, ETA or location. When a detail is missing it says so. No address is
 * ever included (the renter knows their own; notifications never carry it).
 */

export function deliveryStatusLabel(leg: ShipmentLeg, status: DeliveryState): string {
  switch (status) {
    case 'requested':
    case 'quoted':
    case 'prepared':
    case 'booking':
      return 'Being arranged';
    case 'scheduled':
      return 'Scheduled';
    case 'courier_assigned':
      return 'Driver assigned';
    case 'courier_at_pickup':
      return leg === 'outbound' ? 'Driver collecting your gear' : 'Driver at your address';
    case 'collected':
      return leg === 'outbound' ? 'Collected, on its way to you soon' : 'Collected from you';
    case 'in_transit':
      return leg === 'outbound' ? 'On the way to you' : 'On the way back to us';
    case 'courier_at_dropoff':
      return leg === 'outbound' ? 'Driver arriving' : 'Arriving back with us';
    case 'delivered':
      return leg === 'outbound' ? 'Delivered' : 'Back with us';
    case 'delivery_attempt_failed':
      return 'Attempt failed: we will contact you';
    case 'return_to_sender':
      return 'Being returned to us';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Could not be arranged: collect in person';
    case 'lost':
    case 'damaged':
    case 'incident_under_review':
      return 'Under review: we will contact you';
  }
}

/** A tracking link only when the provider gave one, and only a web link. */
export function safeTrackingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface CustomerLeg {
  leg: ShipmentLeg;
  status: DeliveryState;
  status_label: string;
  window_start: string | null;
  window_end: string | null;
  window_label: string | null;
  fee_cents: number;
  /** Null when the provider has not named anyone: "not available yet", never invented. */
  courier_name: string | null;
  tracking_url: string | null;
  scheduled_at: string | null;
  items: number;
  /** Own vehicle (our staff) or a courier. */
  by: 'our_vehicle' | 'courier';
}

export function customerLegs(legs: readonly DeliveryStatusLeg[], shipments: readonly Shipment[]): CustomerLeg[] {
  return legs.map((l) => {
    const s = shipments.find((x) => x.id === l.shipmentId);
    return {
      leg: l.leg,
      status: l.status,
      status_label: deliveryStatusLabel(l.leg, l.status),
      window_start: s?.window.start ?? null,
      window_end: s?.window.end ?? null,
      window_label: s ? windowLabel(s.window) : null,
      fee_cents: s?.customerFeeCents ?? 0,
      courier_name: l.courierName?.trim() || null,
      tracking_url: safeTrackingUrl(l.trackingUrl),
      scheduled_at: l.scheduledAt,
      items: l.items.length,
      by: s?.providerKind === 'courier' ? 'courier' : 'our_vehicle',
    };
  });
}

export type ReturnPickupOption =
  | { allowed: true }
  | { allowed: false; reason: 'collected_in_person' | 'already_arranged' | 'not_during_hire'; message: string };

const DURING_HIRE: readonly BookingStatus[] = ['confirmed', 'active', 'overdue'];

/**
 * Whether the renter may arrange a return pickup now. D-44: gear that was
 * collected in person is returned in person; a return pickup is offered only
 * when the gear went out by delivery. One live return leg at a time.
 */
export function returnPickupOption(shipments: readonly Pick<Shipment, 'leg' | 'status'>[], lineStatuses: readonly BookingStatus[]): ReturnPickupOption {
  const delivered = shipments.some((s) => s.leg === 'outbound' && !FINAL_DELIVERY_STATES.includes(s.status));
  if (!delivered) return { allowed: false, reason: 'collected_in_person', message: 'Gear collected in person is returned in person.' };
  if (shipments.some((s) => s.leg === 'return' && !FINAL_DELIVERY_STATES.includes(s.status))) {
    return { allowed: false, reason: 'already_arranged', message: 'Your return pickup is already arranged.' };
  }
  if (!lineStatuses.some((st) => DURING_HIRE.includes(st))) return { allowed: false, reason: 'not_during_hire', message: 'A return pickup can be arranged only during the hire.' };
  return { allowed: true };
}
