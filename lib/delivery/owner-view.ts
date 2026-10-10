import { chainsByItem, outboundReceipt, ownerMayConfirmReturn, returnProgress, type CustodyEvent } from '@/lib/core/delivery/custody';
import type { Shipment } from '@/lib/core/delivery/repository';
import { FINAL_DELIVERY_STATES, type DeliveryState, type ShipmentLeg } from '@/lib/core/delivery/state';
import { deliveryStatusLabel } from './customer-view';
import { windowLabel } from './checkout';

/**
 * What an OWNER sees of the delivery legs that carry their gear (Phase 8).
 * Pure.
 *
 * Only their own items, the leg's state and window, and what they can do now
 * (hand the gear to our driver at their door; confirm it came back, or report
 * a problem). Never the renter's name, address, contact or booking, never
 * the fee, a tracking link (it shows where the renter is) or another owner's
 * items (D22, D-88).
 */

export interface OwnerLegItem {
  booking_id: string;
  rental_id: string;
  title: string | null;
  progress: string;
  /** Outbound from the owner's address, not yet handed over: the owner records the handover (photo). */
  can_hand_over: boolean;
  /**
   * Return to the owner's address, not yet confirmed, and the gear has left
   * the renter (core ownerMayConfirmReturn, the same rule the server
   * enforces): the owner confirms receipt and condition, or reports a problem.
   */
  can_confirm_return: boolean;
}

export interface OwnerLeg {
  shipment_id: string;
  leg: ShipmentLeg;
  /** 'your_address': the leg starts (outbound) or ends (return) at the owner's pickup address. 'studio': via our studio. */
  via: 'your_address' | 'studio';
  status: DeliveryState;
  status_label: string;
  window_start: string | null;
  window_end: string | null;
  window_label: string | null;
  items: OwnerLegItem[];
}

const HAND_OVER_STATES: readonly DeliveryState[] = ['scheduled', 'courier_assigned', 'courier_at_pickup'];

/** The leg's state in words, from the owner's side of their own address. */
export function ownerStatusLabel(leg: ShipmentLeg, status: DeliveryState, fromOwner: boolean): string {
  if (!fromOwner) return deliveryStatusLabel(leg, status);
  if (leg === 'outbound') {
    switch (status) {
      case 'scheduled':
        return 'Collection from you booked';
      case 'courier_assigned':
        return 'Driver assigned';
      case 'courier_at_pickup':
        return 'Driver at your address';
      case 'collected':
      case 'in_transit':
      case 'courier_at_dropoff':
        return 'Collected from you';
      case 'delivered':
        return 'With the renter';
      default:
        return deliveryStatusLabel(leg, status);
    }
  }
  switch (status) {
    case 'scheduled':
      return 'Return to you booked';
    case 'courier_assigned':
    case 'courier_at_pickup':
      return 'Driver collecting from the renter';
    case 'collected':
    case 'in_transit':
      return 'On its way back to you';
    case 'courier_at_dropoff':
      return 'Driver arriving with your gear';
    case 'delivered':
      return 'Back with you';
    default:
      return deliveryStatusLabel(leg, status);
  }
}

export function ownerLegs(
  ownerId: string,
  shipments: readonly Shipment[],
  custody: readonly CustodyEvent[],
  titles: ReadonlyMap<string, string> = new Map(),
): OwnerLeg[] {
  const out: OwnerLeg[] = [];
  for (const s of shipments) {
    const mine = s.items.filter((i) => i.ownerId === ownerId);
    if (mine.length === 0) continue;
    const fromOwner = !!s.originOwnerId && s.originOwnerId === ownerId;
    const chains = chainsByItem(custody.filter((c) => c.shipmentId === s.id));
    out.push({
      shipment_id: s.id,
      leg: s.leg,
      via: fromOwner ? 'your_address' : 'studio',
      status: s.status,
      status_label: ownerStatusLabel(s.leg, s.status, fromOwner),
      window_start: s.window.start,
      window_end: s.window.end,
      window_label: windowLabel(s.window),
      items: mine.map((i) => {
        const chain = chains.get(`${i.bookingId}:${i.rentalId}`) ?? [];
        const kinds = new Set(chain.map((c) => c.kind));
        return {
          booking_id: i.bookingId,
          rental_id: i.rentalId,
          title: titles.get(i.rentalId) ?? null,
          progress: s.leg === 'outbound' ? outboundReceipt(chain) : returnProgress(chain),
          can_hand_over: fromOwner && s.leg === 'outbound' && HAND_OVER_STATES.includes(s.status) && !kinds.has('handed_to_courier') && !kinds.has('collected_by_courier'),
          can_confirm_return: fromOwner && s.leg === 'return' && !FINAL_DELIVERY_STATES.includes(s.status) && ownerMayConfirmReturn(s, chain) && !kinds.has('inspected'),
        };
      }),
    });
  }
  return out;
}
