/**
 * Delivery use cases (spec Phase 4 §4.6–4.13). They depend only on ports, so
 * the same code runs behind checkout, webhooks, the admin console, jobs and
 * Ubunye. Tests drive them with in-memory fakes.
 *
 * Money rules:
 *  - the browser never sets a delivery price; prices come from stored quotes
 *    (D08), and an expired quote is never charged silently (D07);
 *  - nothing is dispatched before the order's payment is verified and the
 *    booking is in the right state;
 *  - every dispatch has a durable intent with a stable merchant reference; an
 *    uncertain create is reconciled with the provider before ANY retry, so a
 *    timeout never books a second courier (D09, D10);
 *  - a dispatch that fails leaves the delivery fee either earned or owed back
 *    (refund obligation), never stuck (D24);
 *  - a courier collecting a return releases nothing: the deposit waits for
 *    inspection (D17), and an open incident holds settlement (D29).
 */

import { DELIVERY_OPS, DELIVERY_POLICY } from '@/lib/constants';
import * as L from '@/lib/core/rental/ledger';
import { buildNotices, type OutboxMessage, type RentalNoticeKind } from '@/lib/core/rental/notifications';
import { refundObligationKey } from '@/lib/core/rental/refunds';
import type { BookingStatus } from '@/lib/core/rental/state';
import type { OrderLineForTrust } from '@/lib/core/rental/trust';
import type { ProviderCallResult } from '@/lib/core/ports';
import {
  allAccepted,
  allInspected,
  chainsByItem,
  checkCustodyEvent,
  endsRenterPossession,
  outboundReceipt,
  ownerMayConfirmReturn,
  returnProgress,
  type AccessoryCheck,
  type CustodyActor,
  type CustodyEvent,
  type CustodyEventKind,
  type EvidenceRef,
} from './custody';
import {
  depositSettlementAllowed,
  incidentKindForProviderState,
  isOpen,
  lateFeeAutoChargeAllowed,
  newIncident,
  settlementBlockedByIncidents,
  type DeliveryIncident,
  type IncidentKind,
} from './incidents';
import { coarsePricingPoint, originDiscriminator, originReferenceSuffix, sameOrigin, type OriginOwnerId } from './origin';
import { evaluateDeliveryEligibility, inServiceArea, providerRiskGate, type DeliveryIneligibleCode, type InsuranceAnswer } from './policy';
import type { CreateDeliveryRequest, DeliveryWindow, ParcelItem, ProviderDelivery, ProviderDeliveryState, ProviderQuote } from './port';
import { checkQuotesForCharge, priceDeliveryQuote, quoteIsLive, type ChargeCheck, type CustomerDeliveryQuote, type QuoteLineSnapshot } from './quote';
import { OriginAddressChangedError, type DeliveryBookingLine, type DeliveryDeps, type DeliveryProof, type DispatchIntent, type Shipment, type ShipmentTransition } from './repository';
import { selectDeliveryProviders, type EvaluatedCandidate } from './select';
import {
  CANCELLABLE_STATES,
  FINAL_DELIVERY_STATES,
  applyProviderState,
  canonicalFromProvider,
  checkDeliveryTransition,
  type DeliveryState,
  type ShipmentLeg,
} from './state';

// ── Callers ─────────────────────────────────────────────────────────────────

/**
 * Who is asking. Routes map their session to one of these; Ubunye is always
 * `agent`, carrying the result of the server-side approval-token check (never
 * a model claim).
 */
export type DeliveryCaller =
  | { kind: 'system' }
  | { kind: 'staff'; userId: string }
  | { kind: 'renter'; userId: string }
  | { kind: 'owner'; userId: string }
  | { kind: 'agent'; userId: string; approval: { verified: boolean; userId: string; amountCents: number } | null };

type Refusal<C extends string> = { ok: false; code: C; message: string };
const refuse = <C extends string>(code: C, message: string): Refusal<C> => ({ ok: false, code, message });

/** The caller acts for this renter: themselves, staff or the server. */
function actsForRenter(caller: DeliveryCaller, renterId: string): boolean {
  if (caller.kind === 'system' || caller.kind === 'staff') return true;
  if (caller.kind === 'renter' || caller.kind === 'agent') return caller.userId === renterId;
  return false;
}

/**
 * D26: an agent may change a paid delivery only with the person's verified
 * approval for exactly this amount.
 */
function agentApproved(caller: DeliveryCaller, renterId: string, amountCents: number): boolean {
  if (caller.kind !== 'agent') return true;
  const a = caller.approval;
  return !!a && a.verified && a.userId === renterId && caller.userId === renterId && a.amountCents === amountCents;
}

const actorId = (c: DeliveryCaller): string | null => (c.kind === 'system' ? null : c.userId);

/**
 * A payment a person recorded by hand (EFT, cash, card link): the same prefix
 * as `manualReference()` in lib/payments/routing.ts (a test keeps the two in
 * step). Such a payment was never booked in the ledger and is never refunded
 * through the payment provider: a person refunds it.
 */
export const MANUAL_PAYMENT_PREFIX = 'manual:';
export function isManualPaymentReference(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(MANUAL_PAYMENT_PREFIX);
}

/** The leg's fee went through the ledger (collected into unearned hire with a provider-verified payment). */
const feeInLedger = (s: Pick<Shipment, 'customerFeeCents' | 'paidReference'>): boolean => s.customerFeeCents > 0 && !!s.paidReference && !isManualPaymentReference(s.paidReference);

function lineSnapshot(lines: readonly { rentalId: string; quantity: number; startDate?: string; endDate?: string }[]): QuoteLineSnapshot[] {
  return lines.map((l) => ({ rentalId: l.rentalId, quantity: Math.max(1, Math.floor(l.quantity)), startDate: (l.startDate ?? '').slice(0, 10), endDate: (l.endDate ?? '').slice(0, 10) }));
}

/** Two line snapshots describe the same units on the same days (order does not matter). */
export function sameLineSnapshot(a: readonly QuoteLineSnapshot[], b: readonly QuoteLineSnapshot[]): boolean {
  const key = (l: QuoteLineSnapshot): string => `${l.rentalId}|${Math.max(1, Math.floor(l.quantity))}|${l.startDate.slice(0, 10)}|${l.endDate.slice(0, 10)}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function safeCall<T>(fn: () => Promise<ProviderCallResult<T>>): Promise<ProviderCallResult<T>> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : 'provider call failed' };
  }
}

function legNotices(p: { kind: RentalNoticeKind; userIds: readonly (string | null)[]; shipment: Pick<Shipment, 'id' | 'items'>; discriminator: string; data?: OutboxMessage['data'] }): OutboxMessage[] {
  const bookingIds = p.shipment.items.map((i) => i.bookingId);
  const out: OutboxMessage[] = [];
  for (const userId of new Set(p.userIds.filter((u): u is string => !!u))) {
    out.push(...buildNotices({ kind: p.kind, userId, bookingIds, discriminator: `${p.shipment.id}:${p.discriminator}`, data: p.data }));
  }
  return out;
}

function staffAlert(what: string, reference: string): OutboxMessage[] {
  return buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [], discriminator: `delivery:${what}:${reference}`, data: { what, reference } });
}

const ownerIds = (s: Pick<Shipment, 'items'>): (string | null)[] => s.items.map((i) => i.ownerId);

/**
 * Our stable reference for one dispatch attempt of one leg. A leg from our
 * site keeps the pre-Phase-8 form `tvd_{group}_{o|r}{attempt}`; a leg from an
 * owner's address adds `_{owner id without dashes}` (D-84), so two origins of
 * the same order never share a reference.
 */
export function merchantReferenceFor(bookingGroupId: string, leg: ShipmentLeg, attempt: number, originOwnerId: OriginOwnerId = null): string {
  return `tvd_${bookingGroupId.replace(/-/g, '')}_${leg === 'outbound' ? 'o' : 'r'}${attempt}${originReferenceSuffix(originOwnerId)}`;
}

/** `delivery-dispatch:{group}:{leg}[@{owner}]:{attempt}` (our site: unchanged from before Phase 8). */
export function dispatchIdempotencyKey(bookingGroupId: string, leg: ShipmentLeg, attempt: number, originOwnerId: OriginOwnerId = null): string {
  return `delivery-dispatch:${bookingGroupId}:${leg}${originDiscriminator(originOwnerId)}:${attempt}`;
}

/** The leg's fee becomes income: one journal per order, leg, origin and attempt (L.deliveryEarned). */
function earnedJournal(s: Pick<Shipment, 'bookingGroupId' | 'customerFeeCents' | 'leg' | 'attempt' | 'originOwnerId'>): L.Journal {
  return L.deliveryEarned({ bookingGroupId: s.bookingGroupId, deliveryCents: s.customerFeeCents, leg: s.leg, attempt: s.attempt, originOwnerId: s.originOwnerId ?? null });
}

/** Notices to the owner whose address the gear's end of this leg is (never for our site). */
function ownerOriginNotices(kind: 'owner_pickup_scheduled' | 'owner_pickup_collected' | 'owner_gear_returned', s: Pick<Shipment, 'id' | 'items' | 'leg' | 'originOwnerId'>, discriminator: string): OutboxMessage[] {
  if (!s.originOwnerId) return [];
  // Only the owner's own booking lines are named; the link goes to their listings, never the renter's booking.
  const own = { id: s.id, items: s.items.filter((i) => i.ownerId === s.originOwnerId) };
  return legNotices({ kind, userIds: [s.originOwnerId], shipment: own, discriminator, data: { leg: s.leg } });
}

/**
 * A leg from an owner's address (Phase 8): the owner-side address must be
 * that owner's ACTIVE pickup address and every listing on the leg must, today,
 * be collected from it (opted in, owner verified and active, address in the
 * service area). Fails closed when the server cannot tell (no origin port).
 */
async function ownerOriginHolds(
  deps: Pick<DeliveryDeps, 'origins' | 'addresses' | 'policy'>,
  originOwnerId: string,
  ownerAddressId: string,
  rentalIds: readonly string[],
): Promise<boolean> {
  if (!deps.origins || rentalIds.length === 0) return false;
  const point = await deps.addresses.getPoint(ownerAddressId);
  if (!point || point.userId !== originOwnerId || !inServiceArea(point, deps.policy)) return false;
  const decided = await deps.origins.originsFor(rentalIds);
  return rentalIds.every((r) => {
    const d = decided.get(r);
    return !!d && d.ok && d.ownerId === originOwnerId && d.addressId === ownerAddressId;
  });
}

export function deliveryFeeRefundKey(shipmentId: string): string {
  return refundObligationKey('cancellation', `delivery-${shipmentId}`);
}

function emptyTransition(s: Shipment, to: DeliveryState, event: ShipmentTransition['event']): ShipmentTransition {
  return { shipmentId: s.id, from: [s.status], to, patch: {}, event, custody: [], proofs: [], incidents: [], journals: [], notices: [], refund: null };
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export interface DeliveryLineInput extends OrderLineForTrust {
  rentalId: string;
  bookingId?: string;
  driverLabel: string;
  weightGrams: number | null;
  containsLithium: boolean;
}

/**
 * D01–D03, D05. The renter-side point is the destination on the way out and
 * the origin on the way back. For a return leg the gear is already held, so
 * exposure is not counted twice; the first-hire and high-value rules still
 * apply (gear that was collected in person is returned in person).
 */
export async function checkDeliveryEligibility(
  input: { renterId: string; leg: ShipmentLeg; renterAddressId: string; lines: readonly DeliveryLineInput[]; bookingGroupId?: string | null },
  deps: Pick<DeliveryDeps, 'trust' | 'addresses' | 'clock' | 'flags' | 'policy'>,
): Promise<ReturnType<typeof evaluateDeliveryEligibility> | Refusal<'address_not_found'>> {
  const point = await deps.addresses.getPoint(input.renterAddressId);
  if (!point || (point.userId !== null && point.userId !== input.renterId)) return refuse('address_not_found', 'Choose a saved, verified address.');
  const { facts, holdings } = await deps.trust.getTrustInputs(input.renterId, { excludeGroupId: input.bookingGroupId ?? null });
  return evaluateDeliveryEligibility({
    facts,
    currentExposureCents: 0,
    holdings: input.leg === 'outbound' ? holdings : [],
    lines: input.lines,
    destination: { province: point.province ?? null },
    courierFlagEnabled: deps.flags.courierEnabled,
    ownFleetEnabled: deps.flags.ownFleetEnabled,
    now: deps.clock.now(),
    policy: deps.policy,
  });
}

// ── Quote ───────────────────────────────────────────────────────────────────

export type QuoteDeliveryResult =
  | { ok: true; quotes: CustomerDeliveryQuote[]; excluded: { providerId: string; reasons: string[] }[] }
  | (Refusal<DeliveryIneligibleCode | 'address_not_found' | 'not_allowed' | 'no_provider' | 'origin_unavailable'> & { collectionOnly: true; excluded?: { providerId: string; reasons: string[] }[] });

/**
 * Quote a leg with every eligible provider and store an expiring quote per
 * option, best first (spec §4.6–4.7). The input has no price: a price only
 * ever comes from a provider through this function (D08). A provider that is
 * down is skipped and the rest are still offered (D20). Nothing eligible
 * means collection in person; the booking stays possible.
 */
export async function quoteDelivery(
  input: {
    caller: DeliveryCaller;
    renterId: string;
    bookingGroupId: string | null;
    leg: ShipmentLeg;
    originAddressId: string;
    destinationAddressId: string;
    lines: readonly DeliveryLineInput[];
    window: DeliveryWindow;
    /**
     * Phase 8: the owner whose pickup address is the gear's end of the leg
     * (outbound origin, return destination). Absent/null: our site.
     */
    originOwnerId?: OriginOwnerId;
    /**
     * false: an advisory quote for a leg of an existing order (staff by phone,
     * Ubunye, a renter's mid-hire request). It is stored WITHOUT the order
     * link, so it never joins the order's checkout payment (whose delivery
     * total must equal its linked quotes); it is tied to the order only when
     * its own payment is recorded. Default true (the checkout flow).
     */
    link?: boolean;
  },
  deps: DeliveryDeps,
): Promise<QuoteDeliveryResult> {
  if (!actsForRenter(input.caller, input.renterId)) return { ...refuse('not_allowed', 'You cannot quote for this booking.'), collectionOnly: true };
  const renterSide = input.leg === 'outbound' ? input.destinationAddressId : input.originAddressId;
  const elig = await checkDeliveryEligibility({ renterId: input.renterId, leg: input.leg, renterAddressId: renterSide, lines: input.lines, bookingGroupId: input.bookingGroupId }, deps);
  if (!elig.ok) return { ...elig, collectionOnly: true };

  const [from, to] = await Promise.all([deps.addresses.getPoint(input.originAddressId), deps.addresses.getPoint(input.destinationAddressId)]);
  if (!from || !to) return { ...refuse('address_not_found', 'Choose a saved, verified address.'), collectionOnly: true };
  const originOwnerId = input.originOwnerId ?? null;
  if (originOwnerId) {
    const ownerSide = input.leg === 'outbound' ? input.originAddressId : input.destinationAddressId;
    if (!(await ownerOriginHolds(deps, originOwnerId, ownerSide, input.lines.map((l) => l.rentalId)))) {
      return { ...refuse('origin_unavailable', 'This gear cannot be collected from its owner right now. It can go from our studio instead.'), collectionOnly: true };
    }
  }

  const now = deps.clock.now();
  const items: ParcelItem[] = input.lines.map((l) => ({
    rentalId: l.rentalId,
    bookingId: l.bookingId ?? '',
    driverLabel: l.driverLabel,
    replacementValueCents: l.unitReplacementValueCents * Math.max(1, l.quantity),
    quantity: Math.max(1, l.quantity),
    weightGrams: l.weightGrams,
    containsLithium: l.containsLithium,
  }));

  // D-93: the owner's end of the leg is priced from its coarse grid cell (the
  // renter reads every fee and could otherwise trilaterate the owner's home).
  // Our site's end, and the renter's, are priced exactly as before.
  const priceFrom = originOwnerId && input.leg === 'outbound' ? coarsePricingPoint(from) : from;
  const priceTo = originOwnerId && input.leg === 'return' ? coarsePricingPoint(to) : to;

  const candidates: EvaluatedCandidate[] = [];
  for (const port of deps.providers.list()) {
    const kind = port.kind ?? 'courier';
    const mode = kind === 'own_fleet' ? 'own_fleet' : 'courier';
    if (!elig.modes.includes(mode)) {
      const why = mode === 'courier' ? elig.courierBlockedBy.map((b) => `courier_${b}`) : ['own_fleet_disabled'];
      candidates.push({ provider: port, gate: { eligible: false, reasons: why }, serviceability: null, quote: null });
      continue;
    }
    const insurance: InsuranceAnswer | null = kind === 'courier' ? await deps.insurance.coverFor({ providerId: port.providerId, items, leg: input.leg }) : null;
    const gate = providerRiskGate({ provider: port, leg: input.leg, items, window: input.window, insurance, allowSandbox: deps.providers.allowSandbox, policy: deps.policy });
    if (!gate.eligible) {
      candidates.push({ provider: port, gate, serviceability: null, quote: null });
      continue;
    }
    const req = { from: priceFrom, to: priceTo, window: input.window, items };
    const serviceability = await safeCall(() => port.checkServiceability(req));
    const quote = serviceability.ok && serviceability.value.serviceable ? await safeCall(() => port.quote({ ...req, leg: input.leg })) : null;
    candidates.push({ provider: port, gate, serviceability, quote });
  }

  const selection = selectDeliveryProviders(candidates);
  if (selection.collectionOnly) {
    return { ...refuse('no_provider', 'No delivery option is available for this order right now. You can collect it in person.'), collectionOnly: true, excluded: selection.excluded };
  }

  const quotes: CustomerDeliveryQuote[] = [];
  for (const o of selection.options) {
    const price = priceDeliveryQuote({ providerQuote: o.quote, providerKind: o.kind, now });
    quotes.push(
      await deps.repo.saveQuote({
        renterId: input.renterId,
        bookingGroupId: input.link === false ? null : input.bookingGroupId,
        leg: input.leg,
        originOwnerId,
        providerId: o.providerId,
        providerKind: o.kind,
        providerQuoteRef: o.quote.providerQuoteRef,
        ...price,
        replacementValueCents: items.reduce((s, i) => s + i.replacementValueCents, 0),
        bookingIds: items.map((i) => i.bookingId).filter(Boolean),
        rentalIds: items.map((i) => i.rentalId),
        originAddressId: input.originAddressId,
        destinationAddressId: input.destinationAddressId,
        window: o.quote.window,
        status: 'active',
        paidReference: null,
        lines: lineSnapshot(input.lines),
        requestedAt: null,
      }),
    );
  }
  return { ok: true, quotes, excluded: selection.excluded };
}

// ── Checkout hooks ──────────────────────────────────────────────────────────

/**
 * What the checkout may charge for delivery: the sum of the stored quotes,
 * if they are live and belong to the renter (D07, D08). At most one quote per
 * leg. Call when creating the payment intent.
 */
export async function priceDeliveryForCheckout(
  input: { renterId: string; quoteIds: readonly string[]; browserAmountCents?: number | null },
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
): Promise<ChargeCheck | Refusal<'duplicate_leg'>> {
  const quotes = await Promise.all(input.quoteIds.map((id) => deps.repo.getQuote(id)));
  // One quote per trip: per leg AND origin (Phase 8: one leg per place the gear comes from).
  const legs = quotes.filter((q): q is CustomerDeliveryQuote => !!q).map((q) => `${q.leg}${originDiscriminator(q.originOwnerId)}`);
  if (new Set(legs).size !== legs.length) return refuse('duplicate_leg', 'Choose one delivery option per trip.');
  return checkQuotesForCharge({ quotes, renterId: input.renterId, now: deps.clock.now(), browserAmountCents: input.browserAmountCents });
}

/**
 * After the order's payment is VERIFIED (webhook or server lookup): mark the
 * quotes it paid for. The quote may have expired since checkout; the
 * customer's price is fixed by the payment, so that is fine. The paid
 * delivery amount must equal the stored quotes (D08); otherwise nothing is
 * marked and staff are alerted.
 *
 * Refused for an order whose every line is cancelled (review fix round 2,
 * finding 1): the cancellation settled its delivery money, and marking the
 * quotes paid now would let a payment replay refund the fee a second time.
 * The one exception is the cancellation's own settlement
 * (`forCancelledOrderRefund`), which marks them only to refund them at once.
 */
export async function markDeliveryQuotesPaid(
  input: { paymentReference: string; bookingGroupId: string; renterId: string; quoteIds: readonly string[]; paidDeliveryCents: number; forCancelledOrderRefund?: boolean },
  deps: Pick<DeliveryDeps, 'repo' | 'bookings'>,
): Promise<{ ok: true; marked: number } | Refusal<'amount_mismatch' | 'quote_not_found' | 'wrong_renter' | 'order_cancelled'>> {
  const group = await deps.bookings.getGroup(input.bookingGroupId);
  const allCancelled = !!group && group.lines.length > 0 && group.lines.every((l) => l.status === 'cancelled');
  if (allCancelled && !input.forCancelledOrderRefund) return refuse('order_cancelled', 'This order was cancelled; its delivery fee was settled with the cancellation.');
  const quotes = await Promise.all(input.quoteIds.map((id) => deps.repo.getQuote(id)));
  let total = 0;
  for (const q of quotes) {
    if (!q) return refuse('quote_not_found', 'A paid delivery quote is missing.');
    if (q.renterId !== input.renterId) return refuse('wrong_renter', 'A paid delivery quote belongs to someone else.');
    total += q.customerFeeCents;
  }
  if (total !== input.paidDeliveryCents) {
    await deps.repo.post([], staffAlert('delivery_amount_mismatch', input.paymentReference));
    return refuse('amount_mismatch', 'The delivery amount paid does not match the quotes.');
  }
  let marked = 0;
  for (const q of quotes as CustomerDeliveryQuote[]) {
    if (q.status === 'paid' && q.paidReference === input.paymentReference) continue;
    if (await deps.repo.setQuoteStatus(q.id, ['active', 'expired'], 'paid', { paidReference: input.paymentReference, bookingGroupId: input.bookingGroupId })) marked += 1;
  }
  return { ok: true, marked };
}

// ── Prepare ─────────────────────────────────────────────────────────────────

const OUTBOUND_LINE_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed'];
const RETURN_LINE_STATUSES: readonly BookingStatus[] = ['confirmed', 'active', 'overdue'];

export type PrepareResult =
  | { ok: true; shipment: Shipment; intent: DispatchIntent; created: boolean }
  | Refusal<
      | 'quote_not_found'
      | 'not_allowed'
      | 'booking_not_found'
      | 'items_mismatch'
      | 'booking_state'
      | 'quote_expired'
      | 'quote_not_active'
      | 'not_eligible'
      | 'provider_unavailable'
      | 'provider_excluded'
      | 'too_many_attempts'
      | 'dates_mismatch'
      | 'origin_unavailable'
    >;

/**
 * Whether the quote still describes this booking: the same listings, units
 * and hire days it was priced for (its line snapshot). The checkout derived
 * the quote's window from those same days (and its stale check compares the
 * window's day with the leg day), so a booking whose dates or quantities
 * changed since is never dispatched on the old quote. A quote made before the
 * snapshot existed is not refused on this ground.
 */
export function quoteFitsBooking(quote: Pick<CustomerDeliveryQuote, 'lines'>, lines: readonly Pick<DeliveryBookingLine, 'rentalId' | 'quantity' | 'startDate' | 'endDate'>[]): boolean {
  if (lines.length === 0) return false;
  return !(quote.lines && quote.lines.length > 0 && !sameLineSnapshot(quote.lines, lineSnapshot(lines)));
}

/**
 * PREPARE (spec §4.8): validate booking, renter, items, eligibility, provider
 * capabilities and cover against a stored quote; create the shipment leg and
 * its durable dispatch intent with a stable merchant reference. Idempotent:
 * a live shipment for the same order and leg is returned as it is.
 */
export async function prepareDelivery(input: { caller: DeliveryCaller; quoteId: string; bookingGroupId: string }, deps: DeliveryDeps): Promise<PrepareResult> {
  const now = deps.clock.now();
  const quote = await deps.repo.getQuote(input.quoteId);
  if (!quote) return refuse('quote_not_found', 'That delivery quote does not exist.');
  const group = await deps.bookings.getGroup(input.bookingGroupId);
  if (!group) return refuse('booking_not_found', 'Booking not found.');
  if (quote.renterId !== group.renterId || !actsForRenter(input.caller, group.renterId)) return refuse('not_allowed', 'You cannot arrange delivery for this booking.');
  if (quote.bookingGroupId && quote.bookingGroupId !== group.bookingGroupId) return refuse('items_mismatch', 'That quote is for a different booking.');

  const allowed = quote.leg === 'outbound' ? OUTBOUND_LINE_STATUSES : RETURN_LINE_STATUSES;
  const lines = quote.rentalIds.map((rid) => group.lines.find((l) => l.rentalId === rid && allowed.includes(l.status)));
  if (lines.some((l) => !l) || lines.length === 0) {
    const anyLine = quote.rentalIds.every((rid) => group.lines.some((l) => l.rentalId === rid));
    return anyLine ? refuse('booking_state', 'This booking cannot have that delivery now.') : refuse('items_mismatch', 'The quote does not match the booked items.');
  }
  const bookingLines = lines as NonNullable<(typeof lines)[number]>[];

  const existing = await deps.repo.listShipments(group.bookingGroupId);
  // One live leg per order, leg AND origin (Phase 8): each place the gear comes from has its own trip.
  const originOwnerId = quote.originOwnerId ?? null;
  const sameLeg = existing.filter((s) => s.leg === quote.leg && sameOrigin(s.originOwnerId, originOwnerId));
  const live = sameLeg.find((s) => !FINAL_DELIVERY_STATES.includes(s.status));
  if (live) {
    const intent = await deps.repo.getDispatchIntent(live.id);
    if (intent) return { ok: true, shipment: live, intent, created: false };
  }
  const attempt = sameLeg.reduce((m, s) => Math.max(m, s.attempt), 0) + 1;
  if (attempt > DELIVERY_POLICY.maxDispatchAttemptsPerLeg) return refuse('too_many_attempts', 'This delivery needs a member of staff to arrange it.');

  if (quote.status !== 'active' && quote.status !== 'paid') return refuse('quote_not_active', 'That delivery quote has already been used or replaced.');
  // A quote is dispatched at most once. A leg made from it that was cancelled or
  // failed had its fee refunded (or kept as a passed-on fee): a payment replay or
  // recovery run must never send attempt 2 on the same, already-settled fee. A
  // re-attempt needs a new quote and its own payment (staff: quote_leg, then
  // dispatch after payment).
  if (sameLeg.some((s) => s.quoteId === quote.id)) return refuse('quote_not_active', 'That delivery quote has already been used. A new delivery needs a new quote.');
  if (quote.status === 'active' && !quoteIsLive(quote, now)) return refuse('quote_expired', 'Your delivery quote has expired. Please get a new quote.');
  if (!quoteFitsBooking(quote, bookingLines)) return refuse('dates_mismatch', 'The booking dates or quantities changed since this delivery was quoted. Please get a new quote.');
  if (originOwnerId) {
    // From an owner's address: every line is that owner's, and the pickup still holds today
    // (opt-in, owner verified and active, the same active pickup address).
    const ownerSide = quote.leg === 'outbound' ? quote.originAddressId : quote.destinationAddressId;
    const allTheirs = bookingLines.every((l) => l.ownerId === originOwnerId);
    if (!allTheirs || !(await ownerOriginHolds(deps, originOwnerId, ownerSide, bookingLines.map((l) => l.rentalId)))) {
      return refuse('origin_unavailable', 'This gear can no longer be collected from its owner. Our team will arrange it from the studio.');
    }
  }

  const port = deps.providers.get(quote.providerId);
  if (!port) return refuse('provider_unavailable', 'That delivery option is no longer available. Please get a new quote.');

  // Eligibility again, on facts as they are now.
  const renterSide = quote.leg === 'outbound' ? quote.destinationAddressId : quote.originAddressId;
  const elig = await checkDeliveryEligibility(
    {
      renterId: group.renterId,
      leg: quote.leg,
      renterAddressId: renterSide,
      lines: bookingLines,
      bookingGroupId: group.bookingGroupId,
    },
    deps,
  );
  const kind = port.kind ?? 'courier';
  if (!elig.ok || !elig.modes.includes(kind === 'own_fleet' ? 'own_fleet' : 'courier')) {
    return refuse('not_eligible', elig.ok ? 'That delivery option is not available for this order.' : elig.message);
  }

  const items: ParcelItem[] = bookingLines.map((l) => ({
    rentalId: l.rentalId,
    bookingId: l.bookingId,
    driverLabel: l.driverLabel,
    replacementValueCents: l.unitReplacementValueCents * Math.max(1, l.quantity),
    quantity: Math.max(1, l.quantity),
    weightGrams: l.weightGrams,
    containsLithium: l.containsLithium,
  }));
  const insurance = kind === 'courier' ? await deps.insurance.coverFor({ providerId: port.providerId, items, leg: quote.leg }) : null;
  const gate = providerRiskGate({ provider: port, leg: quote.leg, items, window: quote.window, insurance, allowSandbox: deps.providers.allowSandbox, policy: deps.policy });
  if (!gate.eligible) return refuse('provider_excluded', `That delivery option cannot carry this order (${gate.reasons.join(', ')}).`);

  let created: Awaited<ReturnType<DeliveryDeps['repo']['createShipment']>>;
  try {
    created = await deps.repo.createShipment(
      {
        bookingGroupId: group.bookingGroupId,
        leg: quote.leg,
        attempt,
        originOwnerId,
        renterId: group.renterId,
        items: bookingLines.map((l) => ({ bookingId: l.bookingId, rentalId: l.rentalId, ownerId: l.ownerId, serialNumber: l.serialNumber })),
        providerId: port.providerId,
        providerKind: kind,
        quoteId: quote.id,
        merchantReference: merchantReferenceFor(group.bookingGroupId, quote.leg, attempt, originOwnerId),
        status: 'prepared',
        quoteAmountCents: quote.quoteAmountCents,
        customerFeeCents: quote.customerFeeCents,
        platformFeeCents: quote.platformFeeCents,
        replacementValueCents: items.reduce((s, i) => s + i.replacementValueCents, 0),
        coverageVerified: kind === 'courier' ? !!insurance?.covered : DELIVERY_POLICY.ownFleet.verifiedTransitCover,
        insuranceReference: insurance?.policyRef ?? null,
        originAddressId: quote.originAddressId,
        destinationAddressId: quote.destinationAddressId,
        window: quote.window,
        paidReference: quote.paidReference,
      },
      {
        merchantReference: merchantReferenceFor(group.bookingGroupId, quote.leg, attempt, originOwnerId),
        idempotencyKey: dispatchIdempotencyKey(group.bookingGroupId, quote.leg, attempt, originOwnerId),
        providerId: port.providerId,
      },
    );
  } catch (e) {
    // The owner replaced or removed the address between our check above and the insert (the
    // database re-checks under the per-owner lock): same answer as a pickup that no longer holds.
    if (e instanceof OriginAddressChangedError) return refuse('origin_unavailable', 'This gear can no longer be collected from its owner. Our team will arrange it from the studio.');
    throw e;
  }
  return { ok: true, ...created };
}

// ── Commit / dispatch ───────────────────────────────────────────────────────

/**
 * A claim older than this is presumed dead (worker crashed mid-call); reconcile
 * before reuse. One constant for the core, the daily reconcile job and the ops
 * queue: DELIVERY_OPS.staleClaimMinutes.
 */
export const CLAIM_STALE_MS = DELIVERY_OPS.staleClaimMinutes * 60_000;

export type CommitResult =
  | { ok: true; outcome: 'dispatched' | 'already_dispatched' | 'reconciled'; shipment: Shipment }
  | (Refusal<
      | 'not_found'
      | 'not_allowed'
      | 'agent_not_allowed'
      | 'shipment_closed'
      | 'payment_not_verified'
      | 'fee_not_paid'
      | 'booking_state'
      | 'provider_unavailable'
      | 'in_progress'
      | 'reconcile_pending'
      | 'dispatch_unknown'
      | 'dispatch_rejected'
    > & { refundDueCents?: number });

/**
 * COMMIT (spec §4.8). Verify payment and booking state, then dispatch through
 * the provider exactly once: claim the durable intent (compare-and-set), call
 * create with the stable merchant reference, record the result. An unknown
 * outcome is reconciled (findByMerchantReference) before any further create
 * (D09, D10). A refused create fails the leg and owes the delivery fee back
 * in the same transaction (D24); the hire itself is untouched (collection in
 * person remains possible).
 *
 * Only the server (`system`, after a verified payment) or staff commit.
 * An agent never commits a courier job (D26).
 */
export async function commitDelivery(input: { caller: DeliveryCaller; shipmentId: string }, deps: DeliveryDeps): Promise<CommitResult> {
  if (input.caller.kind === 'agent') return refuse('agent_not_allowed', 'Ubunye cannot book a courier. The delivery is booked after your payment is confirmed.');
  if (input.caller.kind !== 'system' && input.caller.kind !== 'staff') return refuse('not_allowed', 'Only the server or staff can dispatch a delivery.');
  const now = deps.clock.now();

  const shipment = await deps.repo.getShipment(input.shipmentId);
  if (!shipment) return refuse('not_found', 'Delivery not found.');
  const intent = await deps.repo.getDispatchIntent(shipment.id);
  if (!intent) return refuse('not_found', 'Delivery not found.');
  if (intent.state === 'succeeded') return { ok: true, outcome: 'already_dispatched', shipment };
  if (FINAL_DELIVERY_STATES.includes(shipment.status)) return refuse('shipment_closed', 'This delivery is closed.');
  if (intent.state === 'rejected') return refuse('dispatch_rejected', 'The provider refused this delivery.');

  const group = await deps.bookings.getGroup(shipment.bookingGroupId);
  if (!group) return refuse('not_found', 'Booking not found.');
  // The order's payment: verified by the provider, or (staff only) confirmed
  // through the manual-payment path, where a person recorded the EFT/cash
  // payment and marked this leg's fee paid with its reference (D-50).
  const paymentOk = group.paymentVerified || (input.caller.kind === 'staff' && !!group.manualPaymentReference);
  if (!paymentOk) return refuse('payment_not_verified', 'The payment for this order is not verified yet.');
  if (shipment.customerFeeCents > 0 && !shipment.paidReference) return refuse('fee_not_paid', 'The delivery fee has not been paid.');
  const wanted: readonly BookingStatus[] = shipment.leg === 'outbound' ? ['confirmed'] : ['confirmed', 'active', 'overdue'];
  const lineOk = shipment.items.every((i) => {
    const l = group.lines.find((x) => x.bookingId === i.bookingId);
    return !!l && wanted.includes(l.status);
  });
  if (!lineOk) return refuse('booking_state', 'The booking is not ready for this delivery.');

  const port = deps.providers.get(shipment.providerId);
  if (!port) return refuse('provider_unavailable', 'The delivery provider is not available. A member of staff will arrange another option.');

  // An earlier attempt may have reached the provider: ask before anything else (D10).
  const stale = intent.state === 'claimed' && (!intent.claimedAt || now.getTime() - new Date(intent.claimedAt).getTime() > CLAIM_STALE_MS);
  if (intent.state === 'claimed' && !stale) return refuse('in_progress', 'This delivery is being booked.');
  if (intent.state === 'unknown' || stale) {
    const found = await safeCall(() => port.findByMerchantReference(shipment.merchantReference));
    if (!found.ok) return refuse('reconcile_pending', 'We are checking with the provider whether this delivery was booked.');
    if (found.value) {
      const applied = await recordDispatchSuccess(shipment, intent, found.value, deps, now);
      return applied ? { ok: true, outcome: 'reconciled', shipment: (await deps.repo.getShipment(shipment.id)) ?? shipment } : refuse('in_progress', 'This delivery is being booked.');
    }
    // The provider has no job under our reference: creating again with the SAME reference is safe.
  }

  const claimed = await deps.repo.claimDispatch(intent.id, ['pending', 'unknown', 'claimed'], now.toISOString(), new Date(now.getTime() - CLAIM_STALE_MS).toISOString());
  if (!claimed) return refuse('in_progress', 'This delivery is being booked.');

  if (shipment.status === 'prepared') {
    const t = emptyTransition(shipment, 'booking', { source: 'system', actorId: actorId(input.caller), dedupeKey: `dispatch:${intent.id}:${intent.attempts + 1}`, providerState: null, occurredAt: now.toISOString(), note: null });
    const r = await deps.repo.transitionShipment(t);
    if (r === 'conflict') return refuse('in_progress', 'This delivery is being booked.');
    shipment.status = 'booking';
  }

  const [from, to] = await Promise.all([deps.addresses.getPoint(shipment.originAddressId), deps.addresses.getPoint(shipment.destinationAddressId)]);
  if (!from || !to) {
    await deps.repo.finishDispatch(intent.id, 'unknown', { lastError: 'address_missing' });
    await deps.repo.post([], staffAlert('delivery_address_missing', shipment.merchantReference));
    return refuse('dispatch_unknown', 'The delivery addresses could not be read. Staff have been alerted.');
  }
  const items: ParcelItem[] = shipment.items.map((i) => {
    const l = group.lines.find((x) => x.bookingId === i.bookingId);
    return {
      rentalId: i.rentalId,
      bookingId: i.bookingId,
      driverLabel: l?.driverLabel ?? 'equipment',
      replacementValueCents: (l?.unitReplacementValueCents ?? 0) * Math.max(1, l?.quantity ?? 1),
      quantity: Math.max(1, l?.quantity ?? 1),
      weightGrams: l?.weightGrams ?? null,
      containsLithium: l?.containsLithium ?? false,
    };
  });
  const quote: ProviderQuote = {
    providerId: shipment.providerId,
    providerQuoteRef: (await deps.repo.getQuote(shipment.quoteId))?.providerQuoteRef ?? null,
    providerCostCents: shipment.quoteAmountCents,
    expiresAt: now.toISOString(),
    window: shipment.window,
  };
  const req: CreateDeliveryRequest = {
    merchantReference: shipment.merchantReference,
    leg: shipment.leg,
    quote,
    from,
    to,
    items,
    window: shipment.window,
    requirements: {
      noLeaveAtDoor: DELIVERY_POLICY.requireHandToHand,
      recipientPin: null,
      declaredValueCents: port.capabilities.declaredValueSupport ? shipment.replacementValueCents : null,
    },
  };
  const res = await safeCall(() => port.createDelivery(req));

  if (res.ok) {
    await recordDispatchSuccess(shipment, intent, res.value, deps, now);
    return { ok: true, outcome: 'dispatched', shipment: (await deps.repo.getShipment(shipment.id)) ?? shipment };
  }
  if (res.kind === 'unknown') {
    // Do NOT retry here and do NOT fail the leg: the job may exist.
    await deps.repo.finishDispatch(intent.id, 'unknown', { lastError: res.message.slice(0, 500) });
    await deps.repo.post([], staffAlert('delivery_dispatch_unknown', shipment.merchantReference));
    return refuse('dispatch_unknown', 'We could not confirm the booking with the provider. We will check before trying again.');
  }

  // Refused: nothing was booked. Fail the leg and owe the fee back, atomically (D24).
  // The intent is closed only after that commits: if it does not, the claim goes
  // stale and the next attempt reconciles first.
  const t = emptyTransition(shipment, 'failed', { source: 'system', actorId: null, dedupeKey: `dispatch-rejected:${intent.id}`, providerState: null, occurredAt: now.toISOString(), note: res.message.slice(0, 500) });
  const refundCents = withFeeRefund(t, shipment, shipment.customerFeeCents);
  t.notices.push(...legNotices({ kind: 'delivery_cancelled', userIds: [shipment.renterId], shipment, discriminator: 'dispatch_rejected' }), ...staffAlert('delivery_dispatch_rejected', shipment.merchantReference));
  t.quoteStatus = { quoteId: shipment.quoteId, to: shipment.paidReference ? 'refunded' : 'consumed' };
  t.from = ['booking', 'prepared'];
  await deps.repo.transitionShipment(t);
  await deps.repo.finishDispatch(intent.id, 'rejected', { lastError: res.message.slice(0, 500) });
  return { ...refuse('dispatch_rejected', 'The provider could not take this delivery. Your delivery fee will be refunded; you can collect in person.'), refundDueCents: refundCents };
}

/**
 * Add the delivery-fee refund (journal, obligation, notice) to a transition.
 * Returns the refund in cents. The obligation is capped again in the
 * database at what is left of the original charge (076). A fee paid by hand
 * (manual reference) was never in the ledger and is not refunded through the
 * provider: staff are alerted to refund it.
 *
 * A fee already EARNED (`acceptedAt` set: every item accepted, deemed
 * accepted, confirmed by staff or received back, and `deliveryEarned` posted)
 * is no longer in unearned hire: its refund reverses the income
 * (`deliveryEarnedRefund`) instead of releasing unearned hire a second time
 * (review fix round 2, finding 4). Both journals share one key per shipment,
 * so a leg's fee is refunded in the ledger once.
 *
 * A fee NOT yet earned on a leg that stays open after the refund (delivered,
 * lost, damaged or under review: refundDeliveryFee) could still be earned
 * later (the renter accepts, deemed acceptance, staff close the review as
 * delivered, the owner receives a return). Its refund therefore posts the
 * earn journal first and reverses it (`deliveryEarned` + `deliveryEarnedRefund`):
 * the same net effect as `deliveryCancelled`, but any later `deliveryEarned`
 * for the leg dedupes on its key instead of debiting unearned hire a second
 * time (review fix round 3, finding 1). The earn sites also skip earning a
 * refunded fee (`feeRefunded`).
 */
function withFeeRefund(t: ShipmentTransition, s: Shipment, refundCents: number): number {
  if (s.customerFeeCents <= 0 || !s.paidReference) return 0;
  const refund = Math.max(0, Math.min(refundCents, s.customerFeeCents));
  if (!feeInLedger(s)) {
    if (refund > 0) {
      t.notices.push(...staffAlert('delivery_manual_fee_refund_due', `${s.merchantReference}:${refund}`));
      t.notices.push(...legNotices({ kind: 'delivery_fee_refund', userIds: [s.renterId], shipment: s, discriminator: 'fee_refund', data: { amountCents: refund } }));
    }
    return refund;
  }
  if (s.acceptedAt) {
    // Earned: only what goes back moves (income → refunds payable); what is kept stays income.
    if (refund > 0) t.journals.push(L.deliveryEarnedRefund({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, refundCents: refund }));
  } else if (refund > 0 && !FINAL_DELIVERY_STATES.includes(t.to)) {
    // Not earned yet, and the leg stays open: settle the earn key now so a later earn is a no-op.
    t.journals.push(
      earnedJournal(s),
      L.deliveryEarnedRefund({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, refundCents: refund }),
    );
  } else {
    t.journals.push(L.deliveryCancelled({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, customerFeeCents: s.customerFeeCents, refundCents: refund }));
  }
  if (refund > 0) {
    t.refund = { key: deliveryFeeRefundKey(s.id), amountCents: refund, paidReference: s.paidReference, userId: s.renterId, bookingIds: s.items.map((i) => i.bookingId) };
    t.notices.push(...legNotices({ kind: 'delivery_fee_refund', userIds: [s.renterId], shipment: s, discriminator: 'fee_refund', data: { amountCents: refund } }));
  }
  return refund;
}

/**
 * The leg's fee was refunded (its quote is `refunded`): it is never earned
 * afterwards (review fix round 3, finding 1). Belt and braces with the earn
 * key withFeeRefund settles.
 */
async function feeRefunded(s: Pick<Shipment, 'quoteId'>, repo: Pick<DeliveryDeps['repo'], 'getQuote'>): Promise<boolean> {
  return (await repo.getQuote(s.quoteId))?.status === 'refunded';
}

/**
 * Record a job the provider holds. The shipment change (with its cost journal
 * and notice) commits first; the intent is closed after it. If the shipment
 * write fails, the claim goes stale and the next attempt finds the job by
 * merchant reference instead of creating another.
 */
async function recordDispatchSuccess(shipment: Shipment, intent: DispatchIntent, job: ProviderDelivery, deps: DeliveryDeps, now: Date): Promise<boolean> {
  const current = (await deps.repo.getShipment(shipment.id)) ?? shipment;
  if (FINAL_DELIVERY_STATES.includes(current.status)) {
    // We gave up on this leg, but the provider holds a job for it: a person cancels it there.
    await deps.repo.finishDispatch(intent.id, 'succeeded', { providerReference: job.providerReference });
    await deps.repo.post([], staffAlert('delivery_orphan_provider_job', `${current.merchantReference}:${job.providerReference}`));
    return true;
  }
  const mapped = canonicalFromProvider(job.state);
  const dispatching = current.status === 'booking' || current.status === 'prepared';
  // Still booking: move to what the provider says (at least scheduled). Already moved on by a
  // provider update that arrived first: keep the state, fill in what the dispatch knows.
  const target: DeliveryState = !dispatching
    ? current.status
    : mapped && !['cancelled', 'failed'].includes(mapped) && checkDeliveryTransition('booking', mapped, 'system').ok
      ? mapped
      : 'scheduled';
  const t = emptyTransition(current, target, { source: 'system', actorId: null, dedupeKey: `dispatch-ok:${intent.id}`, providerState: job.state, occurredAt: now.toISOString(), note: null });
  t.patch = {
    providerReference: job.providerReference,
    trackingReference: job.providerReference,
    trackingUrl: job.trackingUrl ?? current.trackingUrl,
    courierName: job.courierName ?? current.courierName,
    scheduledAt: current.scheduledAt ?? now.toISOString(),
  };
  if (dispatching) t.patch.lastProviderStateAt = job.stateAt;
  // The job's cost is booked once (journal key is per shipment; accrued cost guards the column).
  if (current.providerKind === 'courier' && current.quoteAmountCents > 0 && current.accruedCostCents === 0) {
    t.journals.push(L.courierCost({ shipmentId: current.id, bookingGroupId: current.bookingGroupId, amountCents: current.quoteAmountCents, what: 'dispatch' }));
    t.patch.accruedCostCents = current.quoteAmountCents;
  }
  t.notices.push(...legNotices({ kind: 'delivery_booked', userIds: [current.renterId], shipment: current, discriminator: 'booked' }), ...ownerOriginNotices('owner_pickup_scheduled', current, 'owner_scheduled'));
  t.quoteStatus = { quoteId: current.quoteId, to: 'consumed' };
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return false;
  await deps.repo.finishDispatch(intent.id, 'succeeded', { providerReference: job.providerReference });
  return true;
}

// ── Return leg ──────────────────────────────────────────────────────────────

/**
 * Schedule the return pickup: a SEPARATE leg with its own quote, shipment,
 * state and custody (D18). Prepares the leg; dispatch follows through
 * commitDelivery once its fee is paid (or immediately for a prepaid quote).
 * An agent needs the renter's verified approval for the exact fee (D26).
 */
export async function scheduleReturnPickup(
  input: { caller: DeliveryCaller; bookingGroupId: string; quoteId: string },
  deps: DeliveryDeps,
): Promise<PrepareResult | CommitResult | Refusal<'not_return_quote' | 'approval_required'>> {
  const quote = await deps.repo.getQuote(input.quoteId);
  if (!quote) return refuse('quote_not_found', 'That delivery quote does not exist.');
  if (quote.leg !== 'return') return refuse('not_return_quote', 'That quote is not for a return pickup.');
  if (!agentApproved(input.caller, quote.renterId, quote.customerFeeCents)) {
    return refuse('approval_required', 'Please approve the return pickup and its price yourself.');
  }
  const prepared = await prepareDelivery({ caller: input.caller.kind === 'agent' ? { kind: 'renter', userId: input.caller.userId } : input.caller, quoteId: input.quoteId, bookingGroupId: input.bookingGroupId }, deps);
  if (!prepared.ok) return prepared;
  // A paid (or free) return leg is dispatched by the server straight away.
  if (prepared.shipment.paidReference || prepared.shipment.customerFeeCents === 0) {
    return commitDelivery({ caller: { kind: 'system' }, shipmentId: prepared.shipment.id }, deps);
  }
  return prepared;
}

// ── Provider events ─────────────────────────────────────────────────────────

export interface ProviderEventInput {
  providerId: string;
  /** Set by the webhook route ONLY after the signature check passed, or true for an authenticated poll. */
  verified: boolean;
  /** Unique per provider event (provider event id, or reference + state + time). */
  dedupeKey: string;
  merchantReference: string | null;
  providerReference: string | null;
  state: ProviderDeliveryState;
  stateAt: string | null;
  proof?: ProviderDelivery['proof'];
  trackingUrl?: string | null;
  courierName?: string | null;
  /** 'staff' only for our own fleet (advanceManualDelivery). */
  source: 'provider_webhook' | 'provider_poll' | 'staff';
}

export type ProviderEventOutcome =
  | 'rejected_unverified'
  | 'unknown_shipment'
  | 'provider_mismatch'
  | 'duplicate'
  | 'same_state'
  | 'stale'
  | 'not_allowed'
  | 'needs_reconcile'
  | 'conflict'
  | 'applied';

/**
 * Apply a provider update (from a VERIFIED webhook or a poll). Unverified
 * input is refused (D11). A replay is applied once (D12). An out-of-order
 * update never moves a leg backwards (D13). A courier "delivered" records the
 * courier's side only and asks the renter to confirm (spec §4.10). Loss,
 * damage and failed attempts open an incident (D16).
 */
export async function recordProviderEvent(input: ProviderEventInput, deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>): Promise<ProviderEventOutcome> {
  if (!input.verified) return 'rejected_unverified';
  const shipment = input.merchantReference
    ? await deps.repo.findShipment({ merchantReference: input.merchantReference })
    : input.providerReference
      ? await deps.repo.findShipment({ providerId: input.providerId, providerReference: input.providerReference })
      : null;
  if (!shipment) return 'unknown_shipment';
  if (shipment.providerId !== input.providerId) return 'provider_mismatch';
  if (await deps.repo.hasEvent(input.dedupeKey)) return 'duplicate';

  const decision = applyProviderState({ current: shipment.status, incoming: input.state, incomingAt: input.stateAt, lastAppliedAt: shipment.lastProviderStateAt });
  if (!decision.apply) {
    if (decision.reason === 'unknown_provider_state') return 'needs_reconcile';
    if (decision.reason === 'not_allowed') {
      await deps.repo.post([], staffAlert(`delivery_unexpected_${input.state}`, shipment.merchantReference));
    }
    return decision.reason;
  }

  const now = deps.clock.now();
  const at = input.stateAt ?? now.toISOString();
  const to = decision.to;
  const t = emptyTransition(shipment, to, { source: input.source, actorId: null, dedupeKey: input.dedupeKey, providerState: input.state, occurredAt: at, note: null });
  t.patch.lastProviderStateAt = input.stateAt ?? shipment.lastProviderStateAt;
  if (input.trackingUrl !== undefined && input.trackingUrl !== null) t.patch.trackingUrl = input.trackingUrl;
  if (input.courierName !== undefined && input.courierName !== null) t.patch.courierName = input.courierName;
  const proofRef = input.providerReference ?? shipment.providerReference ?? input.dedupeKey;
  for (const p of input.proof ?? []) {
    t.proofs.push({ shipmentId: shipment.id, bookingId: null, kind: p.kind, ref: p.ref, source: 'provider', capturedAt: at });
  }
  const courierEvidence: EvidenceRef[] = [{ kind: 'provider_confirmation', ref: proofRef }, ...(input.proof ?? []).map((p) => ({ kind: (p.kind === 'pin' ? 'pin_verified' : p.kind === 'signature' ? 'signature' : p.kind === 'scan' ? 'scan' : 'photo') as EvidenceRef['kind'], ref: p.ref }))];
  const courierCustody = (kind: CustodyEventKind): CustodyEvent[] =>
    shipment.items.map((i) => ({
      shipmentId: shipment.id,
      bookingGroupId: shipment.bookingGroupId,
      bookingId: i.bookingId,
      rentalId: i.rentalId,
      serialNumber: i.serialNumber,
      kind,
      actor: { kind: 'courier', id: shipment.providerId },
      occurredAt: at,
      evidence: courierEvidence,
      accessories: [],
      serialConfirmed: false,
      condition: null,
      discrepancies: [],
      incidentId: null,
      dedupeKey: `courier:${shipment.id}:${i.bookingId}:${i.rentalId}:${kind}`,
    }));
  const outbound = shipment.leg === 'outbound';
  const renter = [shipment.renterId];

  switch (to) {
    case 'courier_assigned':
      t.notices.push(...legNotices({ kind: outbound ? 'delivery_courier_assigned' : 'delivery_return_courier_assigned', userIds: renter, shipment, discriminator: to }));
      break;
    case 'courier_at_pickup':
      t.notices.push(...legNotices({ kind: 'delivery_courier_at_pickup', userIds: outbound ? ownerIds(shipment) : renter, shipment, discriminator: to }));
      break;
    case 'collected':
      t.patch.collectedAt = at;
      t.custody.push(...courierCustody('collected_by_courier'));
      t.notices.push(...legNotices({ kind: outbound ? 'delivery_collected' : 'delivery_return_collected', userIds: renter, shipment, discriminator: to }));
      if (outbound) t.notices.push(...ownerOriginNotices('owner_pickup_collected', shipment, 'owner_collected'));
      break;
    case 'courier_at_dropoff':
      // On the way back to an owner's address: the owner is asked to confirm receipt and condition.
      if (!outbound) t.notices.push(...ownerOriginNotices('owner_gear_returned', shipment, 'owner_returned'));
      break;
    case 'in_transit':
      if (outbound) t.notices.push(...legNotices({ kind: 'delivery_in_transit', userIds: renter, shipment, discriminator: to }));
      break;
    case 'delivered':
      t.patch.deliveredAt = at;
      if (outbound) {
        // The courier's side only: receipt is certified by the renter (or an exception).
        t.custody.push(...courierCustody('delivered_to_renter'));
        t.notices.push(...legNotices({ kind: 'delivery_delivered', userIds: renter, shipment, discriminator: to }));
      } else {
        t.notices.push(...staffAlert('delivery_return_awaiting_receipt', shipment.merchantReference), ...ownerOriginNotices('owner_gear_returned', shipment, 'owner_returned'));
      }
      break;
    case 'return_to_sender':
      t.notices.push(...staffAlert('delivery_return_to_sender', shipment.merchantReference));
      break;
    case 'cancelled':
    case 'failed':
      // The provider ended a job before the gear moved: the customer is refunded in full,
      // and the quote can never be dispatched again (a payment replay sends nothing).
      withFeeRefund(t, shipment, shipment.customerFeeCents);
      t.quoteStatus = { quoteId: shipment.quoteId, to: shipment.paidReference ? 'refunded' : 'consumed' };
      if (shipment.providerKind === 'courier' && shipment.accruedCostCents > 0) {
        t.journals.push(L.courierCostReduction({ shipmentId: shipment.id, bookingGroupId: shipment.bookingGroupId, amountCents: shipment.accruedCostCents, what: `provider-${to}` }));
        t.patch.accruedCostCents = 0;
      }
      t.notices.push(...legNotices({ kind: 'delivery_cancelled', userIds: renter, shipment, discriminator: to }), ...staffAlert(`delivery_provider_${to}`, shipment.merchantReference));
      break;
    default:
      break;
  }

  const incidentKind = incidentKindForProviderState(input.state);
  if (incidentKind) {
    t.incidents.push(
      newIncident({
        id: deps.newId(),
        shipmentId: shipment.id,
        bookingGroupId: shipment.bookingGroupId,
        bookingIds: shipment.items.map((i) => i.bookingId),
        leg: shipment.leg,
        kind: incidentKind,
        reportedBy: { kind: 'provider', id: shipment.providerId },
        description: `Provider reported ${input.state.replace(/_/g, ' ')}.`,
        evidence: (input.proof ?? []).map((p) => ({ kind: p.kind, ref: p.ref })),
        // Attribution from the provider's own event: it says it lost the parcel. Damage and a
        // failed attempt are not attributed until a person looks (an open incident holds settlement).
        providerCaused: incidentKind === 'lost' ? true : null,
        discriminator: incidentKind === 'failed_attempt' ? at : '',
        now,
      }),
    );
    t.notices.push(
      ...legNotices({ kind: incidentKind === 'failed_attempt' ? 'delivery_attempt_failed' : 'delivery_incident', userIds: renter, shipment, discriminator: `${to}:${at}` }),
      ...staffAlert(`delivery_incident_${incidentKind}`, shipment.merchantReference),
    );
  }

  const r = await deps.repo.transitionShipment(t);
  return r === 'applied' ? 'applied' : r;
}

// ── Custody: collection and handover ────────────────────────────────────────

export interface CustodyInput {
  caller: DeliveryCaller;
  shipmentId: string;
  bookingId: string;
  rentalId: string;
  evidence: EvidenceRef[];
  accessories?: AccessoryCheck[];
  serialConfirmed?: boolean;
  condition?: string | null;
  discrepancies?: string[];
  occurredAt?: string;
}

export type CustodyResult =
  | { ok: true; duplicate: boolean; shipment: Shipment; incidentId?: string | null }
  | Refusal<
      | 'not_found'
      | 'not_allowed'
      | 'not_dispatched'
      | 'shipment_closed'
      | 'wrong_shipment'
      | 'item_not_on_shipment'
      | 'wrong_leg'
      | 'actor_not_allowed'
      | 'wrong_recipient'
      | 'not_owner'
      | 'out_of_order'
      | 'evidence_required'
      | 'exception_needs_detail'
      | 'not_returned_yet'
      | 'conflict'
    >;

function custodyActor(caller: DeliveryCaller): CustodyActor | null {
  switch (caller.kind) {
    case 'staff':
      return { kind: 'thabangvision_staff', id: caller.userId };
    case 'renter':
      return { kind: 'renter', id: caller.userId };
    case 'owner':
      return { kind: 'owner', id: caller.userId };
    default:
      // The server and agents never vouch for a physical handover.
      return null;
  }
}

const DISPATCHED: readonly DeliveryState[] = ['scheduled', 'courier_assigned', 'courier_at_pickup', 'collected', 'in_transit', 'courier_at_dropoff', 'delivered', 'delivery_attempt_failed', 'incident_under_review'];

async function recordCustody(
  input: CustodyInput,
  kind: CustodyEventKind,
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
  build: (s: Shipment, e: CustodyEvent, chain: CustodyEvent[], t: ShipmentTransition) => void,
): Promise<CustodyResult> {
  const actor = custodyActor(input.caller);
  if (!actor) return refuse('not_allowed', 'A physical handover is confirmed by the people involved.');
  const shipment = await deps.repo.getShipment(input.shipmentId);
  if (!shipment) return refuse('not_found', 'Delivery not found.');
  if (FINAL_DELIVERY_STATES.includes(shipment.status)) return refuse('shipment_closed', 'This delivery is closed.');
  if (!DISPATCHED.includes(shipment.status)) return refuse('not_dispatched', 'This delivery has not been booked yet.');
  const now = deps.clock.now();
  const e: CustodyEvent = {
    shipmentId: shipment.id,
    bookingGroupId: shipment.bookingGroupId,
    bookingId: input.bookingId,
    rentalId: input.rentalId,
    serialNumber: shipment.items.find((i) => i.bookingId === input.bookingId && i.rentalId === input.rentalId)?.serialNumber ?? null,
    kind,
    actor,
    occurredAt: input.occurredAt ?? now.toISOString(),
    evidence: input.evidence,
    accessories: input.accessories ?? [],
    serialConfirmed: input.serialConfirmed ?? false,
    condition: input.condition ?? null,
    discrepancies: input.discrepancies ?? [],
    incidentId: null,
    dedupeKey: `${kind}:${shipment.id}:${input.bookingId}:${input.rentalId}`,
  };
  const chain = await deps.repo.listCustody(shipment.id);
  const check = checkCustodyEvent(e, { shipmentId: shipment.id, bookingGroupId: shipment.bookingGroupId, leg: shipment.leg, items: shipment.items, renterId: shipment.renterId, originOwnerId: shipment.originOwnerId ?? null }, chain);
  if (!check.ok) return check;
  if (check.duplicate) return { ok: true, duplicate: true, shipment };

  const t = emptyTransition(shipment, shipment.status, { source: actor.kind === 'renter' ? 'renter' : actor.kind === 'owner' ? 'owner' : 'staff', actorId: actor.id, dedupeKey: `custody:${e.dedupeKey}`, providerState: null, occurredAt: e.occurredAt, note: null });
  t.custody.push(e);
  for (const ev of e.evidence) {
    if (ev.kind === 'photo' || ev.kind === 'signature' || ev.kind === 'scan') {
      t.proofs.push({ shipmentId: shipment.id, bookingId: e.bookingId, kind: ev.kind, ref: ev.ref, source: actor.kind === 'thabangvision_staff' ? 'staff' : actor.kind === 'courier' ? 'provider' : actor.kind, capturedAt: e.occurredAt } as DeliveryProof);
    }
  }
  build(shipment, e, [...chain, e], t);
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return refuse('conflict', 'This delivery changed at the same time. Please try again.');
  return { ok: true, duplicate: r === 'duplicate', shipment: (await deps.repo.getShipment(shipment.id)) ?? shipment, incidentId: t.incidents[0]?.id ?? null };
}

/** Move the leg forward on a person's confirmation, when the move is allowed. */
function advance(t: ShipmentTransition, s: Shipment, to: DeliveryState, actor: 'staff' | 'system'): void {
  if (s.status === to) return;
  if (checkDeliveryTransition(s.status, to, actor).ok) t.to = to;
}

/**
 * The gear leaves the sender (spec §4.10, D14): on the way out the owner or
 * staff hand it to the courier; on the way back the renter (or staff) hand
 * it to the return courier. With our own fleet, the staff driver's photo is
 * the collection itself and moves the leg to `collected`.
 */
export async function confirmCollection(input: CustodyInput, deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>): Promise<CustodyResult> {
  const shipment = await deps.repo.getShipment(input.shipmentId);
  if (!shipment) return refuse('not_found', 'Delivery not found.');
  const ownFleetStaff = shipment.providerKind === 'own_fleet' && input.caller.kind === 'staff';
  const kind: CustodyEventKind = ownFleetStaff ? 'collected_by_courier' : shipment.leg === 'outbound' ? 'handed_to_courier' : 'handed_to_return_courier';
  return recordCustody(input, kind, deps, (s, _e, chain, t) => {
    if (!ownFleetStaff) return;
    const collected = s.items.every((i) => chain.some((c) => c.bookingId === i.bookingId && c.rentalId === i.rentalId && c.kind === 'collected_by_courier'));
    if (collected) {
      advance(t, s, 'collected', 'staff');
      if (t.to === 'collected') {
        t.patch.collectedAt = t.event.occurredAt;
        t.notices.push(...legNotices({ kind: s.leg === 'outbound' ? 'delivery_collected' : 'delivery_return_collected', userIds: [s.renterId], shipment: s, discriminator: 'collected' }));
        if (s.leg === 'outbound') t.notices.push(...ownerOriginNotices('owner_pickup_collected', s, 'owner_collected'));
      }
    }
  });
}

/**
 * The gear arrives (spec §4.10–4.11).
 *  - `delivered` (own fleet, staff driver): the staff side of the handover.
 *  - `accepted` (outbound): ONLY the booking's renter (D15). When every item is
 *    accepted, the outbound fee is earned (leg-keyed journal).
 *  - `exception` (outbound): renter or staff; opens an incident and puts the
 *    leg under review. No blame is assigned.
 *  - `received` (return): the item's owner or staff. When every item is back,
 *    the return fee is earned. The deposit still waits for inspection (D17).
 */
export async function confirmHandover(
  input: CustodyInput & { outcome: 'delivered' | 'accepted' | 'exception' | 'received'; exceptionKind?: Extract<IncidentKind, 'damaged' | 'lost'> },
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
): Promise<CustodyResult> {
  const kind: CustodyEventKind =
    input.outcome === 'delivered' ? 'delivered_to_renter' : input.outcome === 'accepted' ? 'renter_accepted' : input.outcome === 'exception' ? 'renter_reported_exception' : 'received_by_owner';
  if (input.outcome === 'delivered' && input.caller.kind !== 'staff') return refuse('not_allowed', 'Only our staff driver records a handover this way.');
  const now = deps.clock.now();
  // A fee refunded before receipt is never earned by it (round 3, finding 1).
  const leg = input.outcome === 'accepted' || input.outcome === 'received' ? await deps.repo.getShipment(input.shipmentId) : null;
  // An owner records a receipt only once the gear has left the renter (P2, D17); staff are trusted with it.
  if (leg && input.outcome === 'received' && input.caller.kind === 'owner' && !(await ownerReturnArrived(leg, input, deps.repo))) return NOT_RETURNED_YET;
  const refunded = leg ? await feeRefunded(leg, deps.repo) : false;
  return recordCustody(input, kind, deps, (s, e, chain, t) => {
    if (kind === 'delivered_to_renter') {
      const all = s.items.every((i) => chain.some((c) => c.bookingId === i.bookingId && c.rentalId === i.rentalId && c.kind === 'delivered_to_renter'));
      if (all) {
        advance(t, s, 'delivered', 'staff');
        if (t.to === 'delivered') {
          t.patch.deliveredAt = e.occurredAt;
          t.notices.push(...legNotices({ kind: 'delivery_delivered', userIds: [s.renterId], shipment: s, discriminator: 'delivered' }));
        }
      }
      return;
    }
    if (kind === 'renter_accepted') {
      // The renter has it: if the courier's update has not arrived, the leg is delivered.
      advance(t, s, 'delivered', 'system');
      if (t.to === 'delivered' && !s.deliveredAt) t.patch.deliveredAt = e.occurredAt;
      if (allAccepted(s.items, chain)) {
        t.patch.acceptedAt = e.occurredAt;
        if (feeInLedger(s) && !refunded) t.journals.push(earnedJournal(s));
      }
      return;
    }
    if (kind === 'renter_reported_exception') {
      const incident = newIncident({
        id: deps.newId(),
        shipmentId: s.id,
        bookingGroupId: s.bookingGroupId,
        bookingIds: [e.bookingId],
        leg: s.leg,
        kind: input.exceptionKind ?? 'damaged',
        reportedBy: { kind: e.actor.kind === 'renter' ? 'renter' : 'staff', id: e.actor.id },
        description: e.discrepancies.join('; '),
        evidence: e.evidence.map((x) => ({ kind: x.kind, ref: x.ref })),
        discriminator: `${e.bookingId}:${e.rentalId}`,
        now,
      });
      e.incidentId = incident.id;
      t.incidents.push(incident);
      advance(t, s, 'incident_under_review', 'system');
      t.notices.push(...legNotices({ kind: 'delivery_incident', userIds: [s.renterId, ...ownerIds(s)], shipment: s, discriminator: `exception:${e.bookingId}` }), ...staffAlert('delivery_renter_exception', s.merchantReference));
      return;
    }
    if (kind === 'received_by_owner') {
      receivedBack(s, e, chain, t, refunded);
      // Our driver recorded handing the gear back at the owner's door: the owner confirms condition.
      if (e.actor.kind === 'thabangvision_staff') t.notices.push(...ownerOriginNotices('owner_gear_returned', s, 'owner_returned'));
    }
  });
}

const NOT_RETURNED_YET = refuse('not_returned_yet', 'This item has not been collected from the renter yet. Confirm it once our driver brings it back to you.');

/** The owner's receipt gate (ownerMayConfirmReturn) for one item on this leg, from its recorded chain. */
async function ownerReturnArrived(s: Shipment, item: { bookingId: string; rentalId: string }, repo: Pick<DeliveryDeps['repo'], 'listCustody'>): Promise<boolean> {
  const chain = (await repo.listCustody(s.id)).filter((c) => c.bookingId === item.bookingId && c.rentalId === item.rentalId);
  return ownerMayConfirmReturn(s, chain);
}

/** Every item on the return leg is received back: the leg is delivered and its fee earned (once). */
function receivedBack(s: Shipment, e: CustodyEvent, chain: readonly CustodyEvent[], t: ShipmentTransition, refunded: boolean): void {
  const all = s.items.every((i) => chain.some((c) => c.bookingId === i.bookingId && c.rentalId === i.rentalId && c.kind === 'received_by_owner'));
  if (!all) return;
  advance(t, s, 'delivered', 'staff');
  if (!s.deliveredAt) t.patch.deliveredAt = e.occurredAt;
  t.patch.acceptedAt = e.occurredAt;
  if (feeInLedger(s) && !refunded) t.journals.push(earnedJournal(s));
  t.notices.push(...legNotices({ kind: 'delivery_returned_for_inspection', userIds: [s.renterId], shipment: s, discriminator: 'received' }));
}

/**
 * Phase 8 (D-87): gear returned to the OWNER's pickup address. The owner
 * confirms, per item, that it is back and in what condition (`received`), or
 * reports a problem (`problem`: damaged or missing). For `received` and a
 * damaged item their record is the receipt (`received_by_owner`, with a
 * photo) and the inspection (`inspected`, with the condition): the gear never
 * comes back to us, so the owner is the one who can look at it. A problem
 * also opens an incident (liability undetermined, nobody accused) that holds
 * settlement and the owner's payout for that line until staff resolve it
 * (D29). Only the owner the leg returns to, only for their own items; staff
 * can still record the receipt for them and inspect as before.
 *
 * Review fixes (Phase 8):
 *  - P2: a receipt is refused (`not_returned_yet`) until the gear has left
 *    the renter (ownerMayConfirmReturn: the leg is arriving or arrived, or
 *    the item's chain shows its collection). Otherwise an owner could mark a
 *    scheduled return received and inspected while the renter still has the
 *    gear: fee earned, payout and deposit released.
 *  - P3.1: a MISSING item (`lost`) is not a receipt. Only the incident is
 *    recorded (no `received_by_owner`, no `inspected`, nothing earned) and
 *    the leg goes under review where the state rules allow it.
 */
export async function confirmOwnerReturn(
  input: CustodyInput & { outcome: 'received' | 'problem'; problem?: { kind: Extract<IncidentKind, 'damaged' | 'lost'>; description: string } | null },
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
): Promise<CustodyResult> {
  const c = input.caller;
  if (c.kind !== 'owner') return refuse('not_allowed', 'Only the owner the gear is returned to confirms it this way.');
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  if (s.leg !== 'return' || !s.originOwnerId || s.originOwnerId !== c.userId) return refuse('not_allowed', 'Only the owner the gear is returned to confirms it this way.');
  const problem = input.outcome === 'problem';
  const detail = (input.problem?.description ?? '').trim().slice(0, 500);
  if (problem && detail.length < 3) return refuse('exception_needs_detail', 'Say what is wrong or missing.');
  const condition = problem ? `Problem reported by the owner: ${detail}` : (input.condition ?? '').trim().slice(0, 500);
  if (condition.length < 3) return refuse('evidence_required', 'Say what condition the gear is in.');
  const itemChain = (await deps.repo.listCustody(s.id)).filter((x) => x.bookingId === input.bookingId && x.rentalId === input.rentalId);
  const already = itemChain.some((x) => x.kind === 'received_by_owner');
  const now = deps.clock.now();

  // Before the gear has left the renter there is nothing to receive, and nothing to report missing either.
  if (!ownerMayConfirmReturn(s, itemChain)) return NOT_RETURNED_YET;
  if (problem && input.problem?.kind === 'lost' && !already) return ownerReportsMissing(s, { ...input, caller: c }, detail, deps);
  const refunded = await feeRefunded(s, deps.repo);

  const inspect = (sh: Shipment, e: CustodyEvent, chain: CustodyEvent[], t: ShipmentTransition): void => {
    let incidentId: string | null = null;
    if (problem && input.problem) {
      const incident = newIncident({
        id: deps.newId(),
        shipmentId: sh.id,
        bookingGroupId: sh.bookingGroupId,
        bookingIds: [e.bookingId],
        leg: sh.leg,
        kind: input.problem.kind,
        reportedBy: { kind: 'owner', id: c.userId },
        description: detail,
        evidence: e.evidence.map((x) => ({ kind: x.kind, ref: x.ref })),
        discriminator: `owner-return:${e.bookingId}:${e.rentalId}`,
        now,
      });
      incidentId = incident.id;
      t.incidents.push(incident);
      t.notices.push(
        ...buildNotices({ kind: 'delivery_incident', userId: sh.renterId, bookingIds: [e.bookingId], discriminator: `${sh.id}:incident:${incident.id}` }),
        ...staffAlert(`delivery_owner_return_${input.problem.kind}`, sh.merchantReference),
      );
    }
    const ins: CustodyEvent = {
      ...e,
      kind: 'inspected',
      condition,
      discrepancies: problem ? [detail] : [],
      incidentId,
      dedupeKey: `inspected:${sh.id}:${e.bookingId}:${e.rentalId}`,
    };
    if (e.kind === 'inspected') {
      Object.assign(e, { condition, discrepancies: ins.discrepancies, incidentId });
      return;
    }
    const ctx = { shipmentId: sh.id, bookingGroupId: sh.bookingGroupId, leg: sh.leg, items: sh.items, renterId: sh.renterId, originOwnerId: sh.originOwnerId ?? null };
    const ok = checkCustodyEvent(ins, ctx, chain);
    if (ok.ok && !ok.duplicate) t.custody.push(ins);
  };

  if (!already) {
    return recordCustody({ ...input, condition }, 'received_by_owner', deps, (sh, e, chain, t) => {
      receivedBack(sh, e, chain, t, refunded);
      inspect(sh, e, chain, t);
    });
  }
  return recordCustody({ ...input, condition }, 'inspected', deps, (sh, e, chain, t) => inspect(sh, e, chain, t));
}

/**
 * The owner says an item did not come back (P3.1). Not a receipt: the
 * incident alone, on the owner's own line, and the leg under review when the
 * state rules allow it (otherwise the incident is opened on its own). Nothing
 * is earned and nothing is inspected, so settlement and the payout stay held
 * (awaiting inspection, and the open incident) until staff decide.
 */
async function ownerReportsMissing(
  s: Shipment,
  input: CustodyInput & { caller: { kind: 'owner'; userId: string } },
  detail: string,
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
): Promise<CustodyResult> {
  if (FINAL_DELIVERY_STATES.includes(s.status)) return refuse('shipment_closed', 'This delivery is closed.');
  if (!DISPATCHED.includes(s.status)) return refuse('not_dispatched', 'This delivery has not been booked yet.');
  const item = s.items.find((i) => i.bookingId === input.bookingId && i.rentalId === input.rentalId);
  if (!item) return refuse('item_not_on_shipment', 'That item is not on this delivery.');
  if (item.ownerId !== input.caller.userId) return refuse('not_owner', 'Only the owner of this item can confirm this.');
  const now = deps.clock.now();
  const incident = newIncident({
    id: deps.newId(),
    shipmentId: s.id,
    bookingGroupId: s.bookingGroupId,
    bookingIds: [item.bookingId],
    leg: s.leg,
    kind: 'lost',
    reportedBy: { kind: 'owner', id: input.caller.userId },
    description: detail,
    evidence: input.evidence.map((x) => ({ kind: x.kind, ref: x.ref })),
    discriminator: `owner-return:${item.bookingId}:${item.rentalId}`,
    now,
  });
  const to: DeliveryState = checkDeliveryTransition(s.status, 'incident_under_review', 'system').ok ? 'incident_under_review' : s.status;
  const t = emptyTransition(s, to, {
    source: 'owner',
    actorId: input.caller.userId,
    dedupeKey: `owner-return-missing:${s.id}:${item.bookingId}:${item.rentalId}`,
    providerState: null,
    occurredAt: input.occurredAt ?? now.toISOString(),
    note: 'lost',
  });
  t.incidents.push(incident);
  t.notices.push(
    ...buildNotices({ kind: 'delivery_incident', userId: s.renterId, bookingIds: [item.bookingId], discriminator: `${s.id}:incident:${incident.id}` }),
    // One alert per missing ITEM: a second item missing from the same leg is its own alert.
    ...staffAlert('delivery_owner_return_lost', `${s.merchantReference}:${item.bookingId}:${item.rentalId}`),
  );
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return refuse('conflict', 'This delivery changed at the same time. Please try again.');
  return { ok: true, duplicate: r === 'duplicate', shipment: (await deps.repo.getShipment(s.id)) ?? s, incidentId: incident.id };
}

/** Staff record the inspection of a returned item (the existing take-back flow calls this too). */
export async function recordReturnInspection(input: CustodyInput, deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>): Promise<CustodyResult> {
  if (input.caller.kind !== 'staff') return refuse('not_allowed', 'Inspections are recorded by staff.');
  return recordCustody(input, 'inspected', deps, () => undefined);
}

// ── Settlement guard ────────────────────────────────────────────────────────

export interface SettlementCheck {
  /** The deposit (and owner payout) for this line may be settled now. */
  allowed: boolean;
  reasons: string[];
  /** A late fee may be charged automatically (false when a delay attributed to the provider explains it). */
  lateFeeAutoCharge: boolean;
  /**
   * When a return pickup took every unit of this line from the renter
   * (`collected_by_courier` or `handed_to_return_courier` on a live return
   * leg), or null. The renter handed the gear back at that moment: late fees
   * are counted to it, not to when the gear reached us (D-49). It never
   * releases the deposit (D17).
   */
  returnCollectedAt: string | null;
}

/**
 * Whether a booking line's rental may be settled (D17, D19, D29). Call before
 * deposit settlement and owner payout. A line with no delivery legs is not
 * affected. With a return leg, the item must be received and inspected; a
 * courier collecting it is never enough.
 */
export async function checkRentalSettlement(input: { bookingGroupId: string; bookingId: string }, deps: Pick<DeliveryDeps, 'repo'>): Promise<SettlementCheck> {
  const shipments = (await deps.repo.listShipments(input.bookingGroupId)).filter((s) => s.items.some((i) => i.bookingId === input.bookingId));
  const incidents = (await deps.repo.listIncidents(input.bookingGroupId)).filter((i) => i.bookingIds.length === 0 || i.bookingIds.includes(input.bookingId));
  const reasons: string[] = [];
  let returnCollectedAt: string | null = null;
  const ret = shipments.filter((s) => s.leg === 'return' && !FINAL_DELIVERY_STATES.includes(s.status));
  for (const s of ret) {
    const chain = (await deps.repo.listCustody(s.id)).filter((c) => c.bookingId === input.bookingId);
    const items = s.items.filter((i) => i.bookingId === input.bookingId);
    const verdict = depositSettlementAllowed({ everyItemInspected: allInspected(items, chain), incidents: [] });
    if (!verdict.allowed && verdict.reason) reasons.push(verdict.reason);
    // The moment the last unit of this line left the renter on this leg (a leg on
    // its way back to the renter, return_to_sender, does not count).
    if (s.status === 'return_to_sender' || items.length === 0) continue;
    // Only a courier's own confirmation or our staff end the renter's possession;
    // a renter's own "I handed it over" never stops the late fee (finding 8).
    const left = items.map((i) => chain.filter((c) => c.rentalId === i.rentalId && endsRenterPossession(c)).map((c) => c.occurredAt).sort()[0] ?? null);
    if (left.every((x): x is string => x !== null)) {
      const at = [...left].sort().reverse()[0];
      if (!returnCollectedAt || at < returnCollectedAt) returnCollectedAt = at;
    }
  }
  const blocked = settlementBlockedByIncidents(incidents, input.bookingId);
  if (blocked.blocked) reasons.push('open_delivery_incident');
  // Only a delay staff (or the provider itself) attributed to the provider waives the
  // automatic late fee; an unattributed one is held above while open (D19).
  const late = lateFeeAutoChargeAllowed(incidents);
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], lateFeeAutoCharge: late.allowed, returnCollectedAt };
}

export interface DeliveryStatusLeg {
  shipmentId: string;
  leg: ShipmentLeg;
  /** Phase 8: null = our site; an owner's id = that owner's pickup address (outbound origin, return destination). */
  originOwnerId?: string | null;
  status: DeliveryState;
  providerId: string;
  trackingUrl: string | null;
  courierName: string | null;
  scheduledAt: string | null;
  items: { bookingId: string; rentalId: string; receipt: string }[];
}

/** Where each item on an order is, for screens and Ubunye (read-only). */
export async function getDeliveryStatus(
  input: { caller: DeliveryCaller; bookingGroupId: string },
  deps: Pick<DeliveryDeps, 'repo' | 'bookings'>,
): Promise<{ ok: true; legs: DeliveryStatusLeg[]; openIncidents: number } | Refusal<'not_found' | 'not_allowed'>> {
  const group = await deps.bookings.getGroup(input.bookingGroupId);
  if (!group) return refuse('not_found', 'Booking not found.');
  const ownerId = input.caller.kind === 'owner' ? input.caller.userId : null;
  const isOwner = ownerId !== null && group.lines.some((l) => l.ownerId === ownerId);
  if (!actsForRenter(input.caller, group.renterId) && !isOwner) return refuse('not_allowed', 'You cannot see this delivery.');
  const shipments = await deps.repo.listShipments(input.bookingGroupId);
  const legs: DeliveryStatusLeg[] = [];
  for (const s of shipments) {
    if (isOwner && !s.items.some((i) => i.ownerId === ownerId)) continue;
    const chains = chainsByItem(await deps.repo.listCustody(s.id));
    legs.push({
      shipmentId: s.id,
      leg: s.leg,
      originOwnerId: s.originOwnerId ?? null,
      status: s.status,
      providerId: s.providerId,
      // Owners never see the renter-side tracking link (it reveals the renter's address);
      // the renter never sees it on a leg from or back to an OWNER's address (a courier's
      // tracking page shows the pickup or drop-off point, D-88). Staff see it.
      trackingUrl: isOwner || (!!s.originOwnerId && input.caller.kind !== 'staff') ? null : s.trackingUrl,
      courierName: s.courierName,
      scheduledAt: s.scheduledAt,
      items: s.items
        .filter((i) => !isOwner || i.ownerId === ownerId)
        .map((i) => {
          const chain = chains.get(`${i.bookingId}:${i.rentalId}`) ?? [];
          return { bookingId: i.bookingId, rentalId: i.rentalId, receipt: s.leg === 'outbound' ? outboundReceipt(chain) : returnProgress(chain) };
        }),
    });
  }
  const openIncidents = (await deps.repo.listIncidents(input.bookingGroupId)).filter(isOpen).length;
  return { ok: true, legs, openIncidents };
}

// ── Incidents ───────────────────────────────────────────────────────────────

/**
 * Report a problem (spec §4.13). Lost, damaged or stolen gear puts the leg
 * under review. Nobody is accused and no deposit is touched; a person decides.
 */
export async function reportIncident(
  input: {
    caller: DeliveryCaller;
    shipmentId: string;
    kind: IncidentKind;
    description: string;
    evidence?: { kind: string; ref: string }[];
    /** Staff (or the system, from a provider event) only; ignored for anyone else. */
    providerCaused?: boolean | null;
    /** Narrow the incident to these booking lines (each must be the reporter's own). */
    bookingIds?: string[];
  },
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
): Promise<{ ok: true; incidentId: string; duplicate: boolean } | Refusal<'not_found' | 'not_allowed' | 'description_required'>> {
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  const c = input.caller;
  const allowed =
    c.kind === 'system' || c.kind === 'staff' || ((c.kind === 'renter' || c.kind === 'agent') && c.userId === s.renterId) || (c.kind === 'owner' && s.items.some((i) => i.ownerId === c.userId));
  if (!allowed) return refuse('not_allowed', 'You cannot report on this delivery.');
  if (input.description.trim().length < 3) return refuse('description_required', 'Say what happened.');
  const now = deps.clock.now();
  const reporter = c.kind === 'agent' ? 'renter' : c.kind;
  // Only staff (or the system, for a provider's own event) say who caused it.
  // A renter, owner or agent report always starts unattributed: it holds
  // settlement for a person and never waives a late fee by itself (D19).
  const providerCaused = c.kind === 'staff' || c.kind === 'system' ? (input.providerCaused ?? null) : null;
  // The incident covers the reporter's own lines only: an owner reports on
  // their own items (never another owner's), the renter on the order's lines.
  // It then holds settlement only for those lines (D29) and is readable only
  // by the parties to them (076 policy).
  const mine = [...new Set((c.kind === 'owner' ? s.items.filter((i) => i.ownerId === c.userId) : s.items).map((i) => i.bookingId))];
  let bookingIds = mine;
  if (input.bookingIds && input.bookingIds.length > 0) {
    bookingIds = [...new Set(input.bookingIds.filter((b) => mine.includes(b)))];
    if (bookingIds.length === 0) return refuse('not_allowed', 'You cannot report on those items.');
  }
  const incident = newIncident({
    id: deps.newId(),
    shipmentId: s.id,
    bookingGroupId: s.bookingGroupId,
    bookingIds,
    leg: s.leg,
    kind: input.kind,
    reportedBy: { kind: reporter, id: actorId(c) },
    description: input.description,
    evidence: input.evidence,
    providerCaused,
    discriminator: now.toISOString(),
    now,
  });
  const notices = [
    ...buildNotices({ kind: 'delivery_incident', userId: s.renterId, bookingIds, discriminator: `${s.id}:incident:${incident.id}` }),
    ...staffAlert(`delivery_incident_${input.kind}`, s.merchantReference),
  ];
  const review = (input.kind === 'lost' || input.kind === 'damaged' || input.kind === 'stolen') && checkDeliveryTransition(s.status, 'incident_under_review', 'system').ok;
  if (review) {
    const t = emptyTransition(s, 'incident_under_review', { source: c.kind === 'renter' || c.kind === 'agent' ? 'renter' : c.kind === 'owner' ? 'owner' : c.kind === 'staff' ? 'staff' : 'system', actorId: actorId(c), dedupeKey: `incident:${incident.id}`, providerState: null, occurredAt: now.toISOString(), note: input.kind });
    t.incidents.push(incident);
    t.notices.push(...notices);
    const r = await deps.repo.transitionShipment(t);
    if (r !== 'conflict') return { ok: true, incidentId: incident.id, duplicate: r === 'duplicate' };
  }
  const r = await deps.repo.openIncident(incident, notices);
  return { ok: true, incidentId: incident.id, duplicate: r === 'duplicate' };
}

/** A person resolves an incident and records who caused it, if known. Money outcomes are separate decisions. */
export async function resolveIncident(
  input: { caller: DeliveryCaller; incidentId: string; resolution: string; providerCaused: boolean | null; liability: DeliveryIncident['liability'] },
  deps: Pick<DeliveryDeps, 'repo'>,
): Promise<{ ok: true } | Refusal<'not_allowed' | 'not_found' | 'reason_required' | 'already_closed'>> {
  if (input.caller.kind !== 'staff') return refuse('not_allowed', 'Only staff resolve incidents.');
  if (input.resolution.trim().length < 3) return refuse('reason_required', 'Record how it was resolved.');
  const i = await deps.repo.getIncident(input.incidentId);
  if (!i) return refuse('not_found', 'Incident not found.');
  const ok = await deps.repo.updateIncident(i.id, ['open', 'investigating'], { status: 'resolved', providerCaused: input.providerCaused, liability: input.liability, resolution: input.resolution, resolvedBy: input.caller.userId });
  return ok ? { ok: true } : refuse('already_closed', 'This incident is already resolved.');
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Compare a provider's invoice with what we booked for the shipment (D25).
 * A difference becomes an adjusting journal (cost and payable) and, when we
 * were over-charged, a staff alert. One record per shipment and invoice.
 */
export async function reconcileDelivery(
  input: { caller: DeliveryCaller; shipmentId: string; providerInvoiceRef: string; invoicedCents: number },
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
): Promise<{ ok: true; status: 'matched' | 'over' | 'under'; differenceCents: number; duplicate: boolean } | Refusal<'not_allowed' | 'not_found' | 'not_applicable' | 'invalid_amount'>> {
  if (input.caller.kind !== 'staff' && input.caller.kind !== 'system') return refuse('not_allowed', 'Only staff reconcile provider fees.');
  if (!Number.isSafeInteger(input.invoicedCents) || input.invoicedCents < 0) return refuse('invalid_amount', 'The invoiced amount must be whole cents.');
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  if (s.providerKind !== 'courier') return refuse('not_applicable', 'Our own deliveries have no provider invoice.');
  const diff = input.invoicedCents - s.accruedCostCents;
  const tol = DELIVERY_POLICY.reconciliationToleranceCents;
  const status: 'matched' | 'over' | 'under' = Math.abs(diff) <= tol ? 'matched' : diff > 0 ? 'over' : 'under';
  const journals: L.Journal[] = [];
  if (diff > 0) journals.push(L.courierCost({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, amountCents: diff, what: `invoice:${input.providerInvoiceRef}` }));
  if (diff < 0) journals.push(L.courierCostReduction({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, amountCents: -diff, what: `invoice:${input.providerInvoiceRef}` }));
  const notices = status === 'over' ? staffAlert('delivery_invoice_above_quote', `${s.merchantReference}:${input.providerInvoiceRef}`) : [];
  const r = await deps.repo.saveReconciliation(
    {
      shipmentId: s.id,
      providerId: s.providerId,
      providerInvoiceRef: input.providerInvoiceRef,
      quotedCents: s.quoteAmountCents,
      accruedCents: s.accruedCostCents,
      invoicedCents: input.invoicedCents,
      differenceCents: diff,
      status,
      checkedAt: deps.clock.now().toISOString(),
      checkedBy: actorId(input.caller),
    },
    journals,
    notices,
    { providerCostCents: input.invoicedCents, accruedCostCents: input.invoicedCents },
  );
  return { ok: true, status, differenceCents: diff, duplicate: r === 'duplicate' };
}

// ── Cancellation ────────────────────────────────────────────────────────────

export type CancelResult =
  | { ok: true; refundCents: number; providerFeeCents: number; duplicate: boolean }
  | Refusal<'not_found' | 'not_allowed' | 'approval_required' | 'too_late' | 'reconcile_pending' | 'provider_refused' | 'cancel_unknown' | 'conflict' | 'provider_unavailable'>;

/**
 * Cancel a leg that has not been collected (D23). A provider job is cancelled
 * at the provider first; an unclear answer changes nothing (reconcile first).
 * Money: the customer's fee is refunded in full, except that when the RENTER
 * cancels after a courier was booked, the provider's cancellation fee is
 * passed on at cost, capped at the fee paid (D-39). Our accrued courier cost
 * is replaced by the provider's cancellation fee.
 */
export async function cancelDelivery(
  input: { caller: DeliveryCaller; shipmentId: string; reason: string; initiatedBy?: 'renter' | 'platform' | 'provider' },
  deps: Pick<DeliveryDeps, 'repo' | 'providers' | 'clock'>,
): Promise<CancelResult> {
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  const c = input.caller;
  if (c.kind === 'owner') return refuse('not_allowed', 'Owners cannot cancel a delivery; contact us.');
  if (!actsForRenter(c, s.renterId)) return refuse('not_allowed', 'You cannot cancel this delivery.');
  if (!agentApproved(c, s.renterId, s.customerFeeCents)) return refuse('approval_required', 'Please confirm the cancellation yourself.');
  if (s.status === 'cancelled') return { ok: true, refundCents: 0, providerFeeCents: 0, duplicate: true };
  if (!CANCELLABLE_STATES.includes(s.status)) return refuse('too_late', 'The gear is already on its way. Report a problem instead.');
  const initiatedBy = c.kind === 'renter' || c.kind === 'agent' ? 'renter' : (input.initiatedBy ?? 'platform');
  const now = deps.clock.now();

  let providerFee = 0;
  const intent = await deps.repo.getDispatchIntent(s.id);
  // A create may be in flight right now: cancelling under it could leave a booked courier behind.
  const claimFresh = intent?.state === 'claimed' && !!intent.claimedAt && now.getTime() - new Date(intent.claimedAt).getTime() <= CLAIM_STALE_MS;
  if (claimFresh) return refuse('reconcile_pending', 'This delivery is being booked right now. Please try again in a few minutes.');
  const mayExist = !!s.providerReference || (intent && (intent.state === 'claimed' || intent.state === 'unknown' || intent.state === 'succeeded'));
  if (mayExist) {
    const port = deps.providers.get(s.providerId);
    if (!port) return refuse('provider_unavailable', 'The provider is not available to cancel. Staff have been alerted.');
    let ref = s.providerReference;
    if (!ref) {
      const found = await safeCall(() => port.findByMerchantReference(s.merchantReference));
      if (!found.ok) return refuse('reconcile_pending', 'We are checking with the provider first.');
      ref = found.value?.providerReference ?? null;
    }
    if (ref) {
      const res = await safeCall(() => port.cancelDelivery(ref as string, input.reason));
      if (!res.ok) {
        if (res.kind === 'unknown') {
          await deps.repo.post([], staffAlert('delivery_cancel_unknown', s.merchantReference));
          return refuse('cancel_unknown', 'We could not confirm the cancellation with the provider. We will check and update you.');
        }
        return refuse('provider_refused', 'The provider would not cancel this delivery.');
      }
      if (!res.value.cancelled) return refuse('provider_refused', 'The provider would not cancel this delivery.');
      providerFee = Math.max(0, res.value.feeCents);
    }
  }

  const t = emptyTransition(s, 'cancelled', { source: c.kind === 'staff' ? 'staff' : c.kind === 'system' ? 'system' : 'renter', actorId: actorId(c), dedupeKey: `cancel:${s.id}`, providerState: null, occurredAt: now.toISOString(), note: input.reason.slice(0, 500) });
  const passOn = initiatedBy === 'renter' && DELIVERY_POLICY.passOnProviderCancellationFee ? providerFee : 0;
  const refund = withFeeRefund(t, s, s.customerFeeCents - Math.min(passOn, s.customerFeeCents));
  if (s.providerKind === 'courier') {
    if (s.accruedCostCents > 0) {
      t.journals.push(L.courierCostReduction({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, amountCents: s.accruedCostCents, what: 'cancel-reverse' }));
    }
    if (providerFee > 0) t.journals.push(L.courierCost({ shipmentId: s.id, bookingGroupId: s.bookingGroupId, amountCents: providerFee, what: 'cancel-fee' }));
    t.patch.accruedCostCents = providerFee;
  }
  t.notices.push(...legNotices({ kind: 'delivery_cancelled', userIds: [s.renterId], shipment: s, discriminator: 'cancelled' }));
  // A paid quote is settled by this cancellation (refunded, or kept as a passed-on
  // fee): it can never be dispatched again, whatever replays later (a payment
  // webhook duplicate, missed-payment recovery).
  t.quoteStatus = { quoteId: s.quoteId, to: s.paidReference ? (refund > 0 ? 'refunded' : 'consumed') : 'superseded' };
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return refuse('conflict', 'This delivery changed at the same time. Please try again.');
  // Close the intent so no later commit can book a courier for a cancelled leg.
  if (intent && intent.state !== 'succeeded' && intent.state !== 'rejected') await deps.repo.finishDispatch(intent.id, 'rejected', { lastError: 'cancelled' });
  // A duplicate (a concurrent cancellation applied first) refunded nothing more.
  return r === 'duplicate' ? { ok: true, refundCents: 0, providerFeeCents: 0, duplicate: true } : { ok: true, refundCents: refund, providerFeeCents: providerFee, duplicate: false };
}

/** Staff move an own-fleet (manual) leg along, e.g. "driver assigned", "on the way". */
export async function advanceManualDelivery(
  input: { caller: DeliveryCaller; shipmentId: string; state: Extract<ProviderDeliveryState, 'courier_assigned' | 'courier_at_pickup' | 'in_transit' | 'courier_at_dropoff' | 'delivery_attempt_failed'> },
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'>,
): Promise<ProviderEventOutcome | 'not_allowed' | 'not_found'> {
  if (input.caller.kind !== 'staff') return 'not_allowed';
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return 'not_found';
  if (s.providerKind !== 'own_fleet') return 'not_allowed';
  const at = deps.clock.now().toISOString();
  return recordProviderEvent(
    {
      providerId: s.providerId,
      verified: true,
      dedupeKey: `staff:${s.id}:${input.state}:${at}`,
      merchantReference: s.merchantReference,
      providerReference: s.providerReference,
      state: input.state,
      stateAt: at,
      source: 'staff',
    },
    deps,
  );
}

// ── Deemed acceptance (D-48) ───────────────────────────────────────────────

export type DeemedAcceptanceOutcome = 'deemed' | 'reminded' | 'not_due' | 'not_applicable' | 'held' | 'duplicate' | 'conflict';

/**
 * A delivered outbound leg the renter neither accepted nor reported a problem
 * with (spec §4.10, D-48). Run daily by the system:
 *  1. from `deemedAcceptanceHours - deemedAcceptanceReminderLeadHours` after
 *     the recorded delivery, the renter is reminded once to confirm;
 *  2. from `deemedAcceptanceHours`, and only if that reminder went out on an
 *     EARLIER run, every item not yet accepted gets a system custody event
 *     `deemed_accepted`: the outbound fee is earned and `acceptedAt` is set
 *     (so the address can follow retention).
 * Never when the renter reported an exception or an incident on the leg is
 * open (a person decides), and never for a return leg: deemed acceptance is an
 * outbound event and the return still needs receipt and inspection (D17).
 */
export async function deemDeliveryAccepted(
  input: { caller: DeliveryCaller; shipmentId: string },
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'bookings'>,
): Promise<{ ok: true; outcome: DeemedAcceptanceOutcome } | Refusal<'not_allowed' | 'not_found'>> {
  if (input.caller.kind !== 'system') return refuse('not_allowed', 'Only the system records a deemed acceptance.');
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  if (s.leg !== 'outbound' || s.status !== 'delivered' || s.acceptedAt || !s.deliveredAt) return { ok: true, outcome: 'not_applicable' };
  // Round 3, finding 1: a leg whose fee was refunded, or whose booking lines are
  // all cancelled, is never deemed accepted (no reminder, no custody, no earning):
  // a person decides (the cancellation alerted staff when the gear is with the renter).
  if (await feeRefunded(s, deps.repo)) return { ok: true, outcome: 'not_applicable' };
  const group = await deps.bookings.getGroup(s.bookingGroupId);
  const legLines = group ? group.lines.filter((l) => s.items.some((i) => i.bookingId === l.bookingId)) : [];
  if (legLines.length === 0 || legLines.every((l) => l.status === 'cancelled')) return { ok: true, outcome: 'not_applicable' };
  const now = deps.clock.now();
  const age = now.getTime() - new Date(s.deliveredAt).getTime();
  const hour = 3_600_000;
  if (age < (DELIVERY_POLICY.deemedAcceptanceHours - DELIVERY_POLICY.deemedAcceptanceReminderLeadHours) * hour) return { ok: true, outcome: 'not_due' };

  const chain = await deps.repo.listCustody(s.id);
  if (chain.some((c) => c.kind === 'renter_reported_exception')) return { ok: true, outcome: 'held' };
  const open = (await deps.repo.listIncidents(s.bookingGroupId)).filter((i) => i.shipmentId === s.id && isOpen(i));
  if (open.length > 0) return { ok: true, outcome: 'held' };

  const deemAt = new Date(new Date(s.deliveredAt).getTime() + DELIVERY_POLICY.deemedAcceptanceHours * hour).toISOString();
  const reminderKey = `accept-reminder:${s.id}`;
  if (!(await deps.repo.hasEvent(reminderKey))) {
    const t = emptyTransition(s, s.status, { source: 'system', actorId: null, dedupeKey: reminderKey, providerState: null, occurredAt: now.toISOString(), note: 'renter reminded to confirm the delivery' });
    t.notices.push(...legNotices({ kind: 'delivery_delivered', userIds: [s.renterId], shipment: s, discriminator: 'accept_reminder', data: { reminder: true, deemedAcceptanceAt: deemAt } }));
    const r = await deps.repo.transitionShipment(t);
    return { ok: true, outcome: r === 'applied' ? 'reminded' : r };
  }
  if (age < DELIVERY_POLICY.deemedAcceptanceHours * hour) return { ok: true, outcome: 'not_due' };

  const chains = chainsByItem(chain);
  const pending = s.items.filter((i) => outboundReceipt(chains.get(`${i.bookingId}:${i.rentalId}`) ?? []) !== 'accepted');
  const t = emptyTransition(s, 'delivered', { source: 'system', actorId: null, dedupeKey: `deemed:${s.id}`, providerState: null, occurredAt: now.toISOString(), note: `deemed accepted ${DELIVERY_POLICY.deemedAcceptanceHours} hours after delivery` });
  const sofar = [...chain];
  for (const i of pending) {
    const e: CustodyEvent = {
      shipmentId: s.id,
      bookingGroupId: s.bookingGroupId,
      bookingId: i.bookingId,
      rentalId: i.rentalId,
      serialNumber: i.serialNumber,
      kind: 'deemed_accepted',
      actor: { kind: 'system', id: null },
      occurredAt: now.toISOString(),
      evidence: [],
      accessories: [],
      serialConfirmed: false,
      condition: null,
      discrepancies: [],
      incidentId: null,
      dedupeKey: `deemed_accepted:${s.id}:${i.bookingId}:${i.rentalId}`,
    };
    const check = checkCustodyEvent(e, { shipmentId: s.id, bookingGroupId: s.bookingGroupId, leg: s.leg, items: s.items, renterId: s.renterId }, sofar);
    // An item with no recorded delivery to the renter is not deemed received: a person looks.
    if (!check.ok) return { ok: true, outcome: 'held' };
    if (!check.duplicate) {
      t.custody.push(e);
      sofar.push(e);
    }
  }
  t.patch.acceptedAt = now.toISOString();
  if (feeInLedger(s)) t.journals.push(earnedJournal(s));
  const r = await deps.repo.transitionShipment(t);
  return { ok: true, outcome: r === 'applied' ? 'deemed' : r };
}

// ── A paid quote whose leg never ran (R-50, item 6) ─────────────────────────

export type UnusedQuoteRefundResult =
  | { ok: true; outcome: 'refunded' | 'already_refunded'; refundCents: number }
  | Refusal<'not_allowed' | 'approval_required' | 'not_found' | 'not_paid' | 'in_use'>;

/**
 * The renter paid for a leg that was never made: after payment it could not
 * be prepared (no longer eligible, provider gone, the booking changed), or
 * the order is cancelled before it was made. The fee is owed back in full at
 * once: journal, refund obligation (capped in the database at what is left
 * of the charge) and notices, atomically with the quote moving paid →
 * refunded. Refused while a live leg uses the quote (cancel that leg
 * instead). A fee paid by hand is refunded by a person (staff alert).
 */
export async function refundUnusedDeliveryQuote(
  input: { caller: DeliveryCaller; quoteId: string; reason: string },
  deps: Pick<DeliveryDeps, 'repo'>,
): Promise<UnusedQuoteRefundResult> {
  const q = await deps.repo.getQuote(input.quoteId);
  if (!q) return refuse('not_found', 'That delivery quote does not exist.');
  const c = input.caller;
  if (c.kind === 'owner' || !actsForRenter(c, q.renterId)) return refuse('not_allowed', 'You cannot refund this delivery.');
  if (!agentApproved(c, q.renterId, q.customerFeeCents)) return refuse('approval_required', 'Please confirm this yourself.');
  if (q.status === 'refunded') return { ok: true, outcome: 'already_refunded', refundCents: 0 };
  if (q.status !== 'paid' || !q.paidReference || !q.bookingGroupId) return refuse('not_paid', 'That delivery quote was not paid.');
  const made = (await deps.repo.listShipments(q.bookingGroupId)).filter((s) => s.quoteId === q.id);
  // A leg made from it settles its own fee (cancelDelivery, a refused dispatch, a provider cancellation).
  if (made.length > 0) return refuse('in_use', 'A delivery was made from this quote; cancel that delivery instead.');
  const fee = q.customerFeeCents;
  const ref = `quote-${q.id}`;
  const manual = isManualPaymentReference(q.paidReference);
  const notices: OutboxMessage[] = [];
  if (fee > 0) {
    notices.push(...buildNotices({ kind: 'delivery_fee_refund', userId: q.renterId, bookingIds: q.bookingIds, discriminator: `${ref}:fee_refund`, data: { amountCents: fee } }));
    // An owner trip is keyed per QUOTE (P3.2): two owners' trips on one order with the same leg and fee
    // (both at the minimum) are two refunds, and the second alert must not be dropped as a duplicate.
    // Our site's key is unchanged.
    notices.push(...staffAlert(manual ? 'delivery_manual_fee_refund_due' : 'delivery_unused_quote_refunded', `${q.bookingGroupId}:${q.leg}${originDiscriminator(q.originOwnerId)}:${fee}${q.originOwnerId ? `:${q.id}` : ''}`));
  }
  const r = await deps.repo.refundUnusedQuote({
    quoteId: q.id,
    bookingGroupId: q.bookingGroupId,
    journals: fee > 0 && !manual ? [L.deliveryCancelled({ shipmentId: ref, bookingGroupId: q.bookingGroupId, customerFeeCents: fee, refundCents: fee })] : [],
    notices,
    refund: fee > 0 && !manual ? { key: deliveryFeeRefundKey(ref), amountCents: fee, paidReference: q.paidReference, userId: q.renterId, bookingIds: q.bookingIds } : null,
  });
  if (r === 'conflict') {
    const now = await deps.repo.getQuote(q.id);
    return now?.status === 'refunded' ? { ok: true, outcome: 'already_refunded', refundCents: 0 } : refuse('in_use', 'This delivery changed at the same time. Please try again.');
  }
  return { ok: true, outcome: 'refunded', refundCents: fee };
}

// ── Closing a review (item 10) ──────────────────────────────────────────────

const REVIEW_STATES: readonly DeliveryState[] = ['incident_under_review', 'lost', 'damaged', 'return_to_sender'];

/**
 * Staff close a leg that is under review, lost, damaged or returning to the
 * sender, to a final state, with a recorded reason (the core transition
 * rules: staff only, reason required). Moves no money unless staff ask for
 * the delivery fee to be refunded on a leg that failed (capped at the fee).
 * Incidents are resolved separately (resolveIncident).
 *
 * Closing an OUTBOUND leg as `delivered` is a staff decision that the renter
 * has the gear (review fix round 2, finding 5): it needs `confirmReceived`,
 * records `staff_confirmed_received` (with the reason) for every item not yet
 * accepted, sets `acceptedAt` and earns the outbound fee once. Without that
 * decision the leg would sit delivered-but-unaccepted for ever (deemed
 * acceptance never runs over the renter's exception). If the renter does not
 * have the gear, staff close the leg as lost, damaged or failed instead.
 *
 * A fee that was earned and is then refunded is reversed out of delivery
 * income (withFeeRefund, finding 4); a fee already refunded (its quote
 * `refunded`) is never refunded again.
 */
export async function closeDeliveryReview(
  input: { caller: DeliveryCaller; shipmentId: string; to: Extract<DeliveryState, 'delivered' | 'lost' | 'damaged' | 'failed'>; reason: string; refundFee?: boolean; confirmReceived?: boolean },
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
): Promise<
  | { ok: true; outcome: 'closed' | 'duplicate'; refundCents: number }
  | Refusal<'not_allowed' | 'not_found' | 'reason_required' | 'not_under_review' | 'transition_not_allowed' | 'decision_required' | 'conflict'>
> {
  if (input.caller.kind !== 'staff') return refuse('not_allowed', 'Only staff close a delivery review.');
  const reason = input.reason.trim();
  if (reason.length < 3) return refuse('reason_required', 'Record why the review is closed.');
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  if (!REVIEW_STATES.includes(s.status)) return refuse('not_under_review', 'This delivery is not under review.');
  const check = checkDeliveryTransition(s.status, input.to, 'staff', reason);
  if (!check.ok) return refuse('transition_not_allowed', check.message);
  const receivedDecision = input.to === 'delivered' && s.leg === 'outbound';
  if (receivedDecision && input.confirmReceived !== true) {
    return refuse('decision_required', 'Confirm that the renter has the gear, or close the delivery as lost, damaged or failed.');
  }
  const now = deps.clock.now().toISOString();
  const t = emptyTransition(s, input.to, { source: 'staff', actorId: input.caller.userId, dedupeKey: `review-close:${s.id}:${s.status}:${input.to}`, providerState: null, occurredAt: now, note: reason.slice(0, 500) });
  let refundCents = 0;
  if (receivedDecision) {
    // A fee refunded while the leg was under review is never earned by closing it (round 3, finding 1).
    const refunded = await feeRefunded(s, deps.repo);
    const chains = chainsByItem(await deps.repo.listCustody(s.id));
    for (const i of s.items) {
      if (outboundReceipt(chains.get(`${i.bookingId}:${i.rentalId}`) ?? []) === 'accepted') continue;
      t.custody.push({
        shipmentId: s.id,
        bookingGroupId: s.bookingGroupId,
        bookingId: i.bookingId,
        rentalId: i.rentalId,
        serialNumber: i.serialNumber,
        kind: 'staff_confirmed_received',
        actor: { kind: 'thabangvision_staff', id: input.caller.userId },
        occurredAt: now,
        evidence: [],
        accessories: [],
        serialConfirmed: false,
        condition: reason.slice(0, 500),
        discrepancies: [],
        incidentId: null,
        dedupeKey: `staff_confirmed_received:${s.id}:${i.bookingId}:${i.rentalId}`,
      });
    }
    if (!s.acceptedAt) {
      t.patch.acceptedAt = now;
      if (!s.deliveredAt) t.patch.deliveredAt = now;
      // Earned once: the journal is keyed per order, leg and attempt.
      if (feeInLedger(s) && !refunded) t.journals.push(earnedJournal(s));
    }
  }
  if (input.to === 'failed' && input.refundFee) {
    const quote = await deps.repo.getQuote(s.quoteId);
    if (quote?.status !== 'refunded') {
      refundCents = withFeeRefund(t, s, s.customerFeeCents);
      if (s.paidReference) t.quoteStatus = { quoteId: s.quoteId, to: refundCents > 0 ? 'refunded' : 'consumed' };
    }
  }
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return refuse('conflict', 'This delivery changed at the same time. Please reload.');
  return { ok: true, outcome: r === 'duplicate' ? 'duplicate' : 'closed', refundCents: r === 'duplicate' ? 0 : refundCents };
}

// ── Refunding the fee of a leg a cancellation leaves alone (finding 3) ──────

/** Legs a staff cancellation leaves as they are: the gear reached the renter, or a person is reviewing the leg. */
export const SETTLED_ELSEWHERE_STATES: readonly DeliveryState[] = ['delivered', 'lost', 'damaged', 'incident_under_review'];

/**
 * Staff explicitly refund the delivery fee of a leg that a cancellation does
 * not touch: it was delivered, or it is lost, damaged or under review
 * (D-39/D-52: an outbound leg that reached the renter keeps its fee unless
 * staff decide otherwise, D-53). The leg's state does not change. One refund
 * per leg: the quote moves to `refunded`, the journal and the obligation are
 * keyed per shipment, and an earned fee is reversed out of income (finding 4).
 */
export async function refundDeliveryFee(
  input: { caller: DeliveryCaller; shipmentId: string; reason: string },
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
): Promise<{ ok: true; outcome: 'refunded' | 'already_refunded'; refundCents: number } | Refusal<'not_allowed' | 'not_found' | 'reason_required' | 'not_applicable' | 'conflict'>> {
  if (input.caller.kind !== 'staff') return refuse('not_allowed', 'Only staff refund a delivery fee this way.');
  const reason = input.reason.trim();
  if (reason.length < 3) return refuse('reason_required', 'Record why the delivery fee is refunded.');
  const s = await deps.repo.getShipment(input.shipmentId);
  if (!s) return refuse('not_found', 'Delivery not found.');
  if (!SETTLED_ELSEWHERE_STATES.includes(s.status)) return refuse('not_applicable', 'Cancel this delivery instead: the cancellation settles its fee.');
  const quote = await deps.repo.getQuote(s.quoteId);
  if (quote?.status === 'refunded') return { ok: true, outcome: 'already_refunded', refundCents: 0 };
  const t = emptyTransition(s, s.status, { source: 'staff', actorId: input.caller.userId, dedupeKey: `fee-refund:${s.id}`, providerState: null, occurredAt: deps.clock.now().toISOString(), note: reason.slice(0, 500) });
  const refundCents = withFeeRefund(t, s, s.customerFeeCents);
  if (refundCents > 0 && s.paidReference) t.quoteStatus = { quoteId: s.quoteId, to: 'refunded' };
  const r = await deps.repo.transitionShipment(t);
  if (r === 'conflict') return refuse('conflict', 'This delivery changed at the same time. Please reload.');
  return r === 'duplicate' ? { ok: true, outcome: 'already_refunded', refundCents: 0 } : { ok: true, outcome: 'refunded', refundCents };
}

// ── Payment taken by hand (F-2, F-3, D-50) ──────────────────────────────────

/**
 * Staff record that a delivery fee was paid by hand (EFT, cash, card link)
 * and mark those quotes paid with the manual reference, so the legs can be
 * prepared and dispatched by STAFF (commitDelivery accepts a staff caller on
 * an order confirmed through the manual-payment path). Nothing here takes or
 * moves money. Refused unless:
 *  - the caller is staff and the reference is a manual-payment reference;
 *  - the order is confirmed (provider-verified, or confirmed by hand);
 *  - every quote belongs to this renter and this order's lines, is still
 *    payable (active or expired), and the total equals what was received.
 */
export async function markDeliveryQuotesPaidByStaff(
  input: { caller: DeliveryCaller; bookingGroupId: string; quoteIds: readonly string[]; reference: string; receivedCents: number },
  deps: Pick<DeliveryDeps, 'repo' | 'bookings'>,
): Promise<
  | { ok: true; marked: number }
  | Refusal<'not_allowed' | 'not_manual' | 'not_found' | 'payment_not_confirmed' | 'quote_not_found' | 'wrong_renter' | 'items_mismatch' | 'quote_not_active' | 'amount_mismatch'>
> {
  if (input.caller.kind !== 'staff') return refuse('not_allowed', 'Only staff record a payment taken by hand.');
  if (!isManualPaymentReference(input.reference)) return refuse('not_manual', 'Record how it was paid (EFT, cash or card link) and its reference.');
  if (!Number.isSafeInteger(input.receivedCents) || input.receivedCents < 0) return refuse('amount_mismatch', 'Enter the amount received in cents.');
  if (input.quoteIds.length === 0) return refuse('quote_not_found', 'Choose the delivery quote that was paid.');
  const group = await deps.bookings.getGroup(input.bookingGroupId);
  if (!group) return refuse('not_found', 'Booking not found.');
  if (!group.paymentVerified && !group.manualPaymentReference) return refuse('payment_not_confirmed', 'The order itself is not paid yet. Record its payment first (Mark paid).');
  const onOrder = new Set(group.lines.map((l) => l.bookingId));
  const rentals = new Set(group.lines.map((l) => l.rentalId));
  const quotes: CustomerDeliveryQuote[] = [];
  for (const id of new Set(input.quoteIds)) {
    const q = await deps.repo.getQuote(id);
    if (!q) return refuse('quote_not_found', 'A delivery quote is missing.');
    if (q.renterId !== group.renterId) return refuse('wrong_renter', 'That quote belongs to someone else.');
    if ((q.bookingGroupId && q.bookingGroupId !== group.bookingGroupId) || q.bookingIds.some((b) => !onOrder.has(b)) || q.rentalIds.some((r) => !rentals.has(r))) {
      return refuse('items_mismatch', 'That quote is for a different booking.');
    }
    if (q.status !== 'active' && q.status !== 'expired') return refuse('quote_not_active', 'That quote was already paid, used or replaced.');
    quotes.push(q);
  }
  const total = quotes.reduce((n, q) => n + q.customerFeeCents, 0);
  if (total !== input.receivedCents) return refuse('amount_mismatch', `The delivery total is ${total} cents; the amount received must match it.`);
  let marked = 0;
  for (const q of quotes) {
    if (await deps.repo.setQuoteStatus(q.id, ['active', 'expired'], 'paid', { paidReference: input.reference, bookingGroupId: group.bookingGroupId })) marked += 1;
  }
  return { ok: true, marked };
}
