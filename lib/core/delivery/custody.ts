/**
 * Chain of custody, per physical item (spec Phase 4 §4.10–4.12). Pure.
 *
 *   owner / us ─handed_to_courier→ courier ─delivered_to_renter→ renter
 *     ─renter_accepted | renter_reported_exception→ (rental period)
 *     ─handed_to_return_courier→ return courier ─received_by_owner→ owner / us
 *     ─inspected→ settlement
 *
 * Rules enforced here:
 *  - Every event names a booking line that is on the shipment (D14).
 *  - A courier's "delivered" does not certify receipt: only the booking's
 *    renter accepts, or the renter (or staff for them) reports an exception
 *    (D15). Nobody else can accept.
 *  - Each item has its own chain, keyed by booking line + listing, so a
 *    problem with one lens never marks a camera received (D28).
 *  - An item's chain never goes backwards.
 *  - A courier collecting a return releases nothing: the deposit waits for
 *    `inspected` (D17).
 */

import type { ShipmentLeg } from './state';

export const CUSTODY_ACTOR_KINDS = ['owner', 'thabangvision_staff', 'courier', 'renter'] as const;
export type CustodyActorKind = (typeof CUSTODY_ACTOR_KINDS)[number];

export const CUSTODY_EVENT_KINDS = [
  'handed_to_courier',
  'collected_by_courier',
  'delivered_to_renter',
  'renter_accepted',
  'renter_reported_exception',
  'handed_to_return_courier',
  'received_by_owner',
  'inspected',
] as const;
export type CustodyEventKind = (typeof CUSTODY_EVENT_KINDS)[number];

export type EvidenceKind = 'photo' | 'signature' | 'pin_verified' | 'provider_confirmation' | 'scan';

export interface EvidenceRef {
  kind: EvidenceKind;
  /** Storage key / provider proof id. Never the image itself. */
  ref: string;
}

export interface AccessoryCheck {
  name: string;
  present: boolean;
}

export interface CustodyActor {
  kind: CustodyActorKind;
  /** User id for people; provider id for a courier. */
  id: string | null;
}

export interface CustodyEvent {
  shipmentId: string;
  bookingGroupId: string;
  /** Equipment booking line. */
  bookingId: string;
  /** smart_rentals id. */
  rentalId: string;
  serialNumber: string | null;
  kind: CustodyEventKind;
  actor: CustodyActor;
  occurredAt: string;
  evidence: EvidenceRef[];
  accessories: AccessoryCheck[];
  /** The serial on the item was checked against the listing. */
  serialConfirmed: boolean;
  condition: string | null;
  discrepancies: string[];
  incidentId: string | null;
  /** Stable key so a replayed confirmation is stored once. */
  dedupeKey: string;
}

/** Which leg each event belongs to, and who may record it. */
const RULES: Record<CustodyEventKind, { leg: ShipmentLeg; actors: readonly CustodyActorKind[]; stage: number }> = {
  handed_to_courier: { leg: 'outbound', actors: ['owner', 'thabangvision_staff'], stage: 1 },
  collected_by_courier: { leg: 'outbound', actors: ['courier', 'thabangvision_staff'], stage: 1 },
  delivered_to_renter: { leg: 'outbound', actors: ['courier', 'thabangvision_staff'], stage: 2 },
  renter_accepted: { leg: 'outbound', actors: ['renter'], stage: 3 },
  renter_reported_exception: { leg: 'outbound', actors: ['renter', 'thabangvision_staff'], stage: 3 },
  handed_to_return_courier: { leg: 'return', actors: ['renter', 'thabangvision_staff'], stage: 1 },
  received_by_owner: { leg: 'return', actors: ['owner', 'thabangvision_staff'], stage: 3 },
  inspected: { leg: 'return', actors: ['thabangvision_staff'], stage: 4 },
};

/** `collected_by_courier` is used on both legs (the courier's own confirmation). */
function legOk(kind: CustodyEventKind, leg: ShipmentLeg): boolean {
  if (kind === 'collected_by_courier') return true;
  return RULES[kind].leg === leg;
}

function stageOf(kind: CustodyEventKind, leg: ShipmentLeg): number {
  if (kind === 'collected_by_courier' && leg === 'return') return 2;
  return RULES[kind].stage;
}

export interface ShipmentCustodyContext {
  shipmentId: string;
  bookingGroupId: string;
  leg: ShipmentLeg;
  /** Booking lines on this shipment, each with its listing. */
  items: readonly { bookingId: string; rentalId: string; ownerId: string | null }[];
  /** The booking's renter: the only person who can accept a delivery. */
  renterId: string;
}

export type CustodyCheck =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      code:
        | 'wrong_shipment'
        | 'item_not_on_shipment'
        | 'wrong_leg'
        | 'actor_not_allowed'
        | 'wrong_recipient'
        | 'not_owner'
        | 'out_of_order'
        | 'evidence_required'
        | 'exception_needs_detail';
      message: string;
    };

/**
 * Whether this custody event may be recorded on this shipment, given the
 * item's chain so far. Pure; the repository then appends it (append-only).
 */
export function checkCustodyEvent(e: CustodyEvent, ctx: ShipmentCustodyContext, chainSoFar: readonly CustodyEvent[]): CustodyCheck {
  if (e.shipmentId !== ctx.shipmentId || e.bookingGroupId !== ctx.bookingGroupId) {
    return { ok: false, code: 'wrong_shipment', message: 'This record belongs to a different delivery.' };
  }
  const item = ctx.items.find((i) => i.bookingId === e.bookingId && i.rentalId === e.rentalId);
  if (!item) return { ok: false, code: 'item_not_on_shipment', message: 'That item is not on this delivery.' };
  if (!legOk(e.kind, ctx.leg)) return { ok: false, code: 'wrong_leg', message: `${e.kind} does not happen on the ${ctx.leg} leg.` };

  const rule = RULES[e.kind];
  if (!rule.actors.includes(e.actor.kind)) {
    return { ok: false, code: 'actor_not_allowed', message: `${e.actor.kind} cannot record ${e.kind}.` };
  }
  // D15: only the booking's own renter accepts or hands back as the renter.
  if (e.actor.kind === 'renter' && e.actor.id !== ctx.renterId) {
    return { ok: false, code: 'wrong_recipient', message: 'Only the person who booked can confirm this delivery.' };
  }
  if (e.actor.kind === 'owner' && (!e.actor.id || e.actor.id !== item.ownerId)) {
    return { ok: false, code: 'not_owner', message: 'Only the owner of this item can confirm this.' };
  }

  const mine = chainSoFar.filter((c) => c.bookingId === e.bookingId && c.rentalId === e.rentalId && c.shipmentId === e.shipmentId);
  if (mine.some((c) => c.dedupeKey === e.dedupeKey)) return { ok: true, duplicate: true };
  const reached = mine.reduce((m, c) => Math.max(m, stageOf(c.kind, ctx.leg)), 0);
  const stage = stageOf(e.kind, ctx.leg);
  if (stage < reached) return { ok: false, code: 'out_of_order', message: `${e.kind} comes before what is already recorded for this item.` };
  if (mine.some((c) => c.kind === e.kind)) return { ok: true, duplicate: true };
  // The renter can only accept gear that has left the sender.
  if ((e.kind === 'renter_accepted' || e.kind === 'renter_reported_exception') && reached < 1) {
    return { ok: false, code: 'out_of_order', message: 'This item has not been sent yet.' };
  }
  // Receipt from a renter is final: an item is either accepted or under exception.
  if (e.kind === 'renter_accepted' && mine.some((c) => c.kind === 'renter_reported_exception')) {
    return { ok: false, code: 'out_of_order', message: 'An exception is open for this item; staff resolve it.' };
  }
  if (e.kind === 'inspected' && !mine.some((c) => c.kind === 'received_by_owner')) {
    return { ok: false, code: 'out_of_order', message: 'An item is inspected only after it is received back.' };
  }

  // Evidence: handovers between people need photos; the courier's own confirmation needs the provider's proof.
  const has = (k: EvidenceKind): boolean => e.evidence.some((x) => x.kind === k && x.ref.trim() !== '');
  if ((e.kind === 'handed_to_courier' || e.kind === 'handed_to_return_courier' || e.kind === 'received_by_owner') && !has('photo')) {
    return { ok: false, code: 'evidence_required', message: 'Add a photo of the item at handover.' };
  }
  if (e.kind === 'collected_by_courier' || e.kind === 'delivered_to_renter') {
    if (e.actor.kind === 'courier' && !has('provider_confirmation') && !has('scan') && !has('pin_verified')) {
      return { ok: false, code: 'evidence_required', message: 'A courier update needs the provider confirmation.' };
    }
    if (e.actor.kind === 'thabangvision_staff' && !has('photo')) {
      return { ok: false, code: 'evidence_required', message: 'Add a photo of the item at handover.' };
    }
  }
  if (e.kind === 'renter_reported_exception' && e.discrepancies.filter((d) => d.trim()).length === 0) {
    return { ok: false, code: 'exception_needs_detail', message: 'Say what is wrong or missing.' };
  }
  if (e.kind === 'inspected' && !(e.condition && e.condition.trim())) {
    return { ok: false, code: 'evidence_required', message: 'Record the condition found at inspection.' };
  }
  return { ok: true, duplicate: false };
}

/** Events grouped per physical item (D28). Key: `${bookingId}:${rentalId}`. */
export function chainsByItem(events: readonly CustodyEvent[]): Map<string, CustodyEvent[]> {
  const out = new Map<string, CustodyEvent[]>();
  for (const e of events) {
    const k = `${e.bookingId}:${e.rentalId}`;
    const list = out.get(k) ?? [];
    list.push(e);
    out.set(k, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return out;
}

export type ItemReceipt = 'not_sent' | 'with_courier' | 'awaiting_renter' | 'accepted' | 'exception';

/**
 * Where an outbound item stands. A courier's delivered status alone is
 * `awaiting_renter`, never `accepted` (spec §4.10).
 */
export function outboundReceipt(chain: readonly CustodyEvent[]): ItemReceipt {
  const kinds = new Set(chain.map((c) => c.kind));
  if (kinds.has('renter_reported_exception')) return 'exception';
  if (kinds.has('renter_accepted')) return 'accepted';
  if (kinds.has('delivered_to_renter')) return 'awaiting_renter';
  if (kinds.has('collected_by_courier') || kinds.has('handed_to_courier')) return 'with_courier';
  return 'not_sent';
}

export type ReturnProgress = 'with_renter' | 'with_return_courier' | 'received' | 'inspected';

export function returnProgress(chain: readonly CustodyEvent[]): ReturnProgress {
  const kinds = new Set(chain.map((c) => c.kind));
  if (kinds.has('inspected')) return 'inspected';
  if (kinds.has('received_by_owner')) return 'received';
  if (kinds.has('handed_to_return_courier') || kinds.has('collected_by_courier')) return 'with_return_courier';
  return 'with_renter';
}

/** Every item on the leg was accepted by the renter with no exception. */
export function allAccepted(items: readonly { bookingId: string; rentalId: string }[], events: readonly CustodyEvent[]): boolean {
  const chains = chainsByItem(events);
  return items.length > 0 && items.every((i) => outboundReceipt(chains.get(`${i.bookingId}:${i.rentalId}`) ?? []) === 'accepted');
}

/** Every item on the return leg is back and inspected. */
export function allInspected(items: readonly { bookingId: string; rentalId: string }[], events: readonly CustodyEvent[]): boolean {
  const chains = chainsByItem(events);
  return items.length > 0 && items.every((i) => returnProgress(chains.get(`${i.bookingId}:${i.rentalId}`) ?? []) === 'inspected');
}
