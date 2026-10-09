import { createAdminClient } from '@/lib/supabase/server';
import type { DeliveryRepository } from '@/lib/core/delivery/repository';
import { checkRentalSettlement, type SettlementCheck } from '@/lib/core/delivery/use-cases';
import { CANCELLABLE_STATES, FINAL_DELIVERY_STATES } from '@/lib/core/delivery/state';
import { isMissingPipeline } from './repos';

/**
 * Where the gear-hire money paths meet Phase 4 delivery (risk register R-39,
 * R-40). Used by take-back, dispute settlement, owner payout eligibility and
 * cancellation.
 *
 * R-39: an order that uses Phase 4 delivery (it has shipment legs, or a paid
 * delivery quote) earns its delivery fee per leg through the delivery use
 * cases. The legacy order-level `deliveryEarned({ bookingGroupId })` journal
 * must not be posted for it, or the fee is earned twice. Orders without Phase 4
 * delivery keep the legacy behaviour unchanged.
 *
 * R-40: settlement (deposit, owner payout) waits for checkRentalSettlement:
 * an open delivery incident holds it (D29), a courier collection never
 * releases a deposit (D17, every returned item must be inspected), and a
 * provider-caused or unattributed delay stops an automatic late fee (D19).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Whether this order uses Phase 4 delivery. Throws when it cannot tell (callers fail closed). */
export async function usesPhase4Delivery(db: Admin, bookingGroupId: string | null): Promise<boolean> {
  if (!bookingGroupId) return false;
  const [ships, quotes] = await Promise.all([
    db.from('delivery_shipments').select('id').eq('booking_group_id', bookingGroupId).limit(1),
    db.from('delivery_quotes').select('id').eq('booking_group_id', bookingGroupId).in('status', ['paid', 'consumed']).limit(1),
  ]);
  for (const r of [ships, quotes]) {
    if (r.error && !isMissingPipeline(r.error)) throw new Error(`delivery lookup failed: ${r.error.message}`);
  }
  return (ships.data ?? []).length > 0 || (quotes.data ?? []).length > 0;
}

/** Nothing about delivery stands in the way. */
export const NO_DELIVERY_HOLD: SettlementCheck = { allowed: true, reasons: [], lateFeeAutoCharge: true };

/**
 * checkRentalSettlement for one booking line. A line outside any order, or an
 * order before migration 076, has no delivery and is not held. Throws when the
 * delivery records cannot be read (callers fail closed).
 */
export async function deliverySettlement(
  input: { bookingGroupId: string | null; bookingId: string },
  repo?: Pick<DeliveryRepository, 'listShipments' | 'listIncidents' | 'listCustody'>,
): Promise<SettlementCheck> {
  if (!input.bookingGroupId) return NO_DELIVERY_HOLD;
  const r = repo ?? new (await import('@/lib/delivery/repos')).SupabaseDeliveryRepository();
  return checkRentalSettlement({ bookingGroupId: input.bookingGroupId, bookingId: input.bookingId }, { repo: r as DeliveryRepository });
}

/** Plain words for staff, per hold reason. */
export function settlementHoldMessage(reasons: readonly string[]): string {
  const parts = reasons.map((r) =>
    r === 'open_delivery_incident'
      ? 'a delivery incident on this item is still open'
      : r.includes('inspect')
        ? 'the item has not been received back and inspected on its return delivery (if it came back in person, cancel the return pickup)'
        : r.replace(/_/g, ' '),
  );
  return `The deposit cannot be settled yet: ${[...new Set(parts)].join('; ')}. Resolve it in the delivery console first.`;
}

export interface DeliveryCancellationPlan {
  /** The order uses Phase 4 delivery: its fee is refunded per leg (cancelDelivery), not with the hire. */
  phase4: boolean;
  /** This is the order's last line still booked, so its delivery legs go with it. */
  lastLine: boolean;
  /** Live legs (not cancelled or failed) to cancel when the last line goes. */
  shipmentIds: string[];
  /** A live leg is past the point where it can be cancelled (the gear is on its way). */
  tooLate: boolean;
  /** Paid delivery fees on those legs, in cents: refunded in full unless a courier was already booked (D-39). */
  feeCents: number;
  /** A courier job is booked on one of them: its cancellation fee may be passed on at cost, capped at the fee (D-39). */
  courierBooked: boolean;
}

/**
 * What cancelling this booking line means for its order's delivery (D-39).
 * Throws when the records cannot be read (callers fail closed).
 */
export async function deliveryCancellationPlan(
  db: Admin,
  input: { bookingGroupId: string | null; bookingId: string },
  repo?: Pick<DeliveryRepository, 'listShipments'>,
): Promise<DeliveryCancellationPlan> {
  const none: DeliveryCancellationPlan = { phase4: false, lastLine: false, shipmentIds: [], tooLate: false, feeCents: 0, courierBooked: false };
  if (!input.bookingGroupId) return none;
  if (!(await usesPhase4Delivery(db, input.bookingGroupId))) return none;
  const { data: lines, error } = await db.from('equipment_bookings').select('id, status').eq('checkout_group_id', input.bookingGroupId);
  if (error) throw new Error(`order lines lookup failed: ${error.message}`);
  const lastLine = !((lines ?? []) as { id: string; status: string }[]).some((l) => l.id !== input.bookingId && l.status !== 'cancelled');
  if (!lastLine) return { ...none, phase4: true };
  const r = repo ?? new (await import('@/lib/delivery/repos')).SupabaseDeliveryRepository(db);
  const live = (await r.listShipments(input.bookingGroupId)).filter((s) => !FINAL_DELIVERY_STATES.includes(s.status));
  return {
    phase4: true,
    lastLine: true,
    shipmentIds: live.map((s) => s.id),
    tooLate: live.some((s) => !CANCELLABLE_STATES.includes(s.status)),
    feeCents: live.filter((s) => s.paidReference).reduce((n, s) => n + s.customerFeeCents, 0),
    courierBooked: live.some((s) => s.providerKind === 'courier' && !!s.providerReference),
  };
}
