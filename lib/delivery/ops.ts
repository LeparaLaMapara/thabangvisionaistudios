import { DELIVERY_OPS } from '@/lib/constants';
import type { EvidenceRef } from '@/lib/core/delivery/custody';
import type { DeliveryDeps, Shipment } from '@/lib/core/delivery/repository';
import type { DeliveryState, ShipmentLeg } from '@/lib/core/delivery/state';
import type { DeliveryLineInput } from '@/lib/core/delivery/use-cases';
import type { CustomerDeliveryQuote } from '@/lib/core/delivery/quote';
import { buildNotices, type OutboxMessage } from '@/lib/core/rental/notifications';
import { isMissingPipeline } from '@/lib/rental/repos';
import type { createAdminClient } from '@/lib/supabase/server';

/**
 * Delivery operations helpers (spec Phase 4 §4.18): the admin dashboard's
 * queues, a shipment's evidence, and the inputs both staff and Ubunye need to
 * quote a leg of an existing order. Reads only; every change goes through the
 * delivery use cases.
 *
 * Addresses (D21): the queue and detail payloads carry NO address, address
 * id, contact detail or tracking link (a tracking page shows where the renter
 * is). Staff reveal one on purpose, per shipment and side, and that reveal is
 * logged by the route.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

/** Columns staff see in lists. Deliberately no origin/destination ids, tracking_url or insurance details. */
export const OPS_SHIPMENT_COLUMNS =
  'id, booking_group_id, leg, attempt, renter_id, items, provider, provider_kind, status, merchant_reference, provider_reference, window_start, window_end, scheduled_at, collected_at, delivered_at, accepted_at, quote_amount_cents, customer_fee_cents, accrued_cost_cents, provider_cost_cents, coverage_verified, created_at, updated_at';

export interface OpsShipment {
  id: string;
  bookingGroupId: string;
  leg: ShipmentLeg;
  attempt: number;
  renterId: string;
  ownerIds: string[];
  items: { bookingId: string; rentalId: string; serialNumber: string | null }[];
  providerId: string;
  providerKind: 'courier' | 'own_fleet';
  status: DeliveryState;
  merchantReference: string;
  providerReference: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  scheduledAt: string | null;
  collectedAt: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  quoteAmountCents: number;
  customerFeeCents: number;
  accruedCostCents: number;
  providerCostCents: number | null;
  coverageVerified: boolean;
  createdAt: string;
  updatedAt: string;
  intent: { state: string; attempts: number; lastError: string | null } | null;
}

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function toOpsShipment(r: Row, intent: OpsShipment['intent'] = null): OpsShipment {
  const items = ((r.items as { bookingId: string; rentalId: string; ownerId?: string | null; serialNumber?: string | null }[] | null) ?? []);
  return {
    id: String(r.id),
    bookingGroupId: String(r.booking_group_id),
    leg: r.leg as ShipmentLeg,
    attempt: Number(r.attempt ?? 1),
    renterId: String(r.renter_id),
    ownerIds: [...new Set(items.map((i) => i.ownerId).filter((x): x is string => !!x))],
    items: items.map((i) => ({ bookingId: i.bookingId, rentalId: i.rentalId, serialNumber: i.serialNumber ?? null })),
    providerId: String(r.provider),
    providerKind: r.provider_kind as OpsShipment['providerKind'],
    status: r.status as DeliveryState,
    merchantReference: String(r.merchant_reference),
    providerReference: s(r.provider_reference),
    windowStart: s(r.window_start),
    windowEnd: s(r.window_end),
    scheduledAt: s(r.scheduled_at),
    collectedAt: s(r.collected_at),
    deliveredAt: s(r.delivered_at),
    acceptedAt: s(r.accepted_at),
    quoteAmountCents: Number(r.quote_amount_cents ?? 0),
    customerFeeCents: Number(r.customer_fee_cents ?? 0),
    accruedCostCents: Number(r.accrued_cost_cents ?? 0),
    providerCostCents: r.provider_cost_cents === null || r.provider_cost_cents === undefined ? null : Number(r.provider_cost_cents),
    coverageVerified: r.coverage_verified === true,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at ?? r.created_at),
    intent,
  };
}

export const OPS_QUEUES = [
  'awaiting_dispatch',
  'scheduled',
  'couriers_assigned',
  'in_transit',
  'delivered_awaiting_acceptance',
  'return_pickups',
  'failed',
  'missing_damaged',
] as const;
export type OpsQueue = (typeof OPS_QUEUES)[number];

/** Which queues a leg appears in. Pure. A return leg also shows under return pickups. */
export function queuesFor(sh: Pick<OpsShipment, 'status' | 'leg' | 'acceptedAt' | 'intent'>): OpsQueue[] {
  const out: OpsQueue[] = [];
  switch (sh.status) {
    case 'requested':
    case 'quoted':
    case 'prepared':
    case 'booking':
      out.push('awaiting_dispatch');
      break;
    case 'scheduled':
      out.push('scheduled');
      break;
    case 'courier_assigned':
    case 'courier_at_pickup':
      out.push('couriers_assigned');
      break;
    case 'collected':
    case 'in_transit':
    case 'courier_at_dropoff':
      out.push('in_transit');
      break;
    case 'delivered':
      if (!sh.acceptedAt) out.push('delivered_awaiting_acceptance');
      break;
    case 'failed':
    case 'delivery_attempt_failed':
    case 'return_to_sender':
      out.push('failed');
      break;
    case 'lost':
    case 'damaged':
    case 'incident_under_review':
      out.push('missing_damaged');
      break;
    default:
      break;
  }
  if (sh.intent && (sh.intent.state === 'unknown' || sh.intent.state === 'rejected') && !out.includes('failed') && sh.status !== 'cancelled') out.push('failed');
  const done = sh.status === 'cancelled' || sh.status === 'failed' || (sh.status === 'delivered' && !!sh.acceptedAt);
  if (sh.leg === 'return' && !done) out.push('return_pickups');
  return out;
}

export function bucketShipments(rows: readonly OpsShipment[]): Record<OpsQueue, OpsShipment[]> {
  const out = Object.fromEntries(OPS_QUEUES.map((q) => [q, [] as OpsShipment[]])) as Record<OpsQueue, OpsShipment[]>;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    for (const q of queuesFor(r)) out[q].push(r);
  }
  return out;
}

export interface OpsPayload {
  pipeline: true;
  queues: Record<OpsQueue, OpsShipment[]>;
  incidents: Row[];
  providerFailures: { events: Row[]; dispatches: { shipmentId: string; state: string; attempts: number; lastError: string | null; updatedAt: string | null }[] };
  reconciliation: { awaitingInvoice: OpsShipment[]; recent: Row[] };
}

/** Everything the dashboard lists. Service role; addresses never selected. */
export async function loadDeliveryOpsQueues(db: Admin, now: Date): Promise<OpsPayload | { pipeline: false; message: string }> {
  const probe = await db.from('delivery_shipments').select('id', { head: true, count: 'exact' });
  if (probe.error && isMissingPipeline(probe.error)) return { pipeline: false, message: 'Migration 076 (delivery) is not applied on this database yet.' };

  const since = new Date(now.getTime() - DELIVERY_OPS.failedLookbackDays * 86_400_000).toISOString();
  const [open, failed, intents, events, incidents, awaiting, recon] = await Promise.all([
    db.from('delivery_shipments').select(OPS_SHIPMENT_COLUMNS).not('status', 'in', '(cancelled,failed)').order('created_at').limit(500),
    db.from('delivery_shipments').select(OPS_SHIPMENT_COLUMNS).eq('status', 'failed').gte('updated_at', since).order('updated_at', { ascending: false }).limit(100),
    db.from('delivery_dispatch_intents').select('shipment_id, state, attempts, last_error, updated_at').in('state', ['unknown', 'rejected', 'claimed', 'pending']).limit(500),
    db
      .from('delivery_provider_events')
      .select('id, provider, event_type, merchant_reference, provider_reference, processing_status, retry_count, last_error, received_at, outcome')
      .in('processing_status', ['failed', 'dead'])
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(100),
    db
      .from('delivery_incidents')
      .select('id, shipment_id, booking_group_id, booking_ids, leg, kind, status, provider_caused, liability, reported_by_kind, description, evidence, created_at')
      .in('status', ['open', 'investigating'])
      .order('created_at')
      .limit(200),
    db.from('delivery_shipments').select(OPS_SHIPMENT_COLUMNS).eq('provider_kind', 'courier').is('provider_cost_cents', null).in('status', ['delivered', 'cancelled']).gt('accrued_cost_cents', 0).order('updated_at').limit(100),
    db.from('delivery_reconciliation').select('id, shipment_id, provider, provider_invoice_ref, quoted_cents, accrued_cents, invoiced_cents, difference_cents, status, checked_at, checked_by').order('checked_at', { ascending: false }).limit(50),
  ]);
  for (const r of [open, failed, intents, events, incidents, awaiting, recon]) if (r.error) throw new Error(`delivery ops queues: ${r.error.message}`);

  const byShipment = new Map<string, OpsShipment['intent']>();
  for (const i of (intents.data ?? []) as Row[]) byShipment.set(String(i.shipment_id), { state: String(i.state), attempts: Number(i.attempts ?? 0), lastError: s(i.last_error) });
  const ships = [...((open.data ?? []) as Row[]), ...((failed.data ?? []) as Row[])].map((r) => toOpsShipment(r, byShipment.get(String(r.id)) ?? null));

  return {
    pipeline: true,
    queues: bucketShipments(ships),
    incidents: (incidents.data ?? []) as Row[],
    providerFailures: {
      events: (events.data ?? []) as Row[],
      dispatches: ((intents.data ?? []) as Row[])
        .filter((i) => i.state === 'unknown' || i.state === 'rejected')
        .map((i) => ({ shipmentId: String(i.shipment_id), state: String(i.state), attempts: Number(i.attempts ?? 0), lastError: s(i.last_error), updatedAt: s(i.updated_at) })),
    },
    reconciliation: { awaitingInvoice: ((awaiting.data ?? []) as Row[]).map((r) => toOpsShipment(r)), recent: (recon.data ?? []) as Row[] },
  };
}

/** One shipment's history and evidence for staff. Still no address or tracking link. */
export async function loadShipmentDetail(db: Admin, shipmentId: string): Promise<Row | null> {
  const ship = await db.from('delivery_shipments').select(OPS_SHIPMENT_COLUMNS).eq('id', shipmentId).maybeSingle();
  if (ship.error) {
    if (isMissingPipeline(ship.error)) return null;
    throw new Error(`delivery shipment: ${ship.error.message}`);
  }
  if (!ship.data) return null;
  const row = ship.data as Row;
  const [intent, events, custody, proofs, incidents, recon, task] = await Promise.all([
    db.from('delivery_dispatch_intents').select('state, attempts, last_error, claimed_at, updated_at').eq('shipment_id', shipmentId).maybeSingle(),
    db.from('delivery_events').select('id, from_status, to_status, source, actor_id, provider_state, occurred_at, recorded_at, note').eq('shipment_id', shipmentId).order('id'),
    db
      .from('delivery_custody_events')
      .select('id, booking_id, rental_id, serial_number, kind, actor_kind, actor_id, occurred_at, evidence, accessories, serial_confirmed, condition, discrepancies, incident_id')
      .eq('shipment_id', shipmentId)
      .order('id'),
    db.from('delivery_proofs').select('id, booking_id, kind, ref, source, captured_at').eq('shipment_id', shipmentId).order('id'),
    db.from('delivery_incidents').select('id, kind, status, provider_caused, liability, reported_by_kind, description, evidence, resolution, resolved_at, created_at').eq('shipment_id', shipmentId).order('created_at'),
    db.from('delivery_reconciliation').select('provider_invoice_ref, quoted_cents, accrued_cents, invoiced_cents, difference_cents, status, checked_at').eq('shipment_id', shipmentId).order('checked_at'),
    db.from('delivery_manual_tasks').select('state, window_start, window_end, assigned_to, updated_at').eq('merchant_reference', String(row.merchant_reference)).maybeSingle(),
  ]);
  const i = intent.data as Row | null;
  return {
    shipment: toOpsShipment(row, i ? { state: String(i.state), attempts: Number(i.attempts ?? 0), lastError: s(i.last_error) } : null),
    events: events.data ?? [],
    custody: custody.data ?? [],
    proofs: proofs.data ?? [],
    incidents: incidents.data ?? [],
    reconciliation: recon.data ?? [],
    manualTask: task.data ?? null,
  };
}

/**
 * The address (and driver contact, and tracking link) for one side of one
 * shipment, for dispatch. The caller must be staff and must log the reveal.
 */
export async function revealShipmentAddress(db: Admin, shipmentId: string, side: 'origin' | 'destination'): Promise<{ addressId: string; address: Row; trackingUrl: string | null } | null> {
  const ship = await db.from('delivery_shipments').select('origin_address_id, destination_address_id, tracking_url').eq('id', shipmentId).maybeSingle();
  if (ship.error || !ship.data) return null;
  const sh = ship.data as Row;
  const addressId = String(side === 'origin' ? sh.origin_address_id : sh.destination_address_id);
  const addr = await db
    .from('delivery_addresses')
    .select('formatted_address, suburb, city, province, postal_code, contact_name, contact_phone, instructions, redacted_at')
    .eq('id', addressId)
    .maybeSingle();
  if (addr.error || !addr.data) return null;
  return { addressId, address: addr.data as Row, trackingUrl: s(sh.tracking_url) };
}

// ── Evidence ─────────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

/**
 * Evidence photos must be https links to OUR storage (the signed Cloudinary
 * upload, or Supabase storage), never an arbitrary URL.
 */
export function isOwnStorageUrl(url: unknown, env: Env = process.env): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.hostname === 'res.cloudinary.com') {
    const cloud = env.CLOUDINARY_CLOUD_NAME ?? env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    return !cloud || u.pathname.startsWith(`/${cloud}/`);
  }
  const supa = env.NEXT_PUBLIC_SUPABASE_URL;
  if (supa) {
    try {
      if (u.hostname === new URL(supa).hostname && u.pathname.startsWith('/storage/v1/')) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function photoEvidence(urls: unknown, env: Env = process.env): { ok: true; evidence: EvidenceRef[] } | { ok: false; message: string } {
  if (!Array.isArray(urls)) return { ok: true, evidence: [] };
  if (urls.length > 20) return { ok: false, message: 'At most 20 photos per record.' };
  const evidence: EvidenceRef[] = [];
  for (const u of urls) {
    if (!isOwnStorageUrl(u, env)) return { ok: false, message: 'Photos must be uploaded through the app (https links to our storage).' };
    evidence.push({ kind: 'photo', ref: u });
  }
  return { ok: true, evidence };
}

// ── Quoting a leg of an existing order (staff and Ubunye) ───────────────────

/** A whole South African day (UTC+2, no daylight saving) as a delivery window. */
export function sastDayWindow(date: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00+02:00`);
  if (Number.isNaN(start.getTime())) return null;
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000 - 1000).toISOString() };
}

export type LegInputs =
  | { ok: true; renterId: string; lines: DeliveryLineInput[]; originAddressId: string; destinationAddressId: string; defaultDate: string; existing: Shipment | null }
  | { ok: false; code: 'not_found' | 'no_known_addresses'; message: string };

/**
 * What a quote for one leg of an existing order needs, from the order itself:
 * the return leg goes back the way the outbound leg came (renter's address
 * to the gear's origin); a new outbound attempt reuses the outbound leg's
 * addresses. With no delivery on the order yet, there is nothing to reuse:
 * the customer chooses an address at checkout.
 */
export async function legInputsFor(deps: Pick<DeliveryDeps, 'repo' | 'bookings'>, bookingGroupId: string, leg: ShipmentLeg): Promise<LegInputs> {
  const group = await deps.bookings.getGroup(bookingGroupId);
  if (!group) return { ok: false, code: 'not_found', message: 'Booking not found.' };
  const shipments = await deps.repo.listShipments(bookingGroupId);
  const newest = (l: ShipmentLeg): Shipment | null => {
    const ofLeg = shipments.filter((x) => x.leg === l);
    const live = ofLeg.filter((x) => x.status !== 'cancelled' && x.status !== 'failed');
    const pick = (live.length ? live : ofLeg).sort((a, b) => b.attempt - a.attempt)[0];
    return pick ?? null;
  };
  const outbound = newest('outbound');
  const existing = newest(leg);
  const basis = existing ?? outbound;
  if (!basis) return { ok: false, code: 'no_known_addresses', message: 'This booking has no delivery yet, so there is no address on record. Delivery is chosen at checkout.' };
  const reverse = leg === 'return' && !existing;
  const onLeg = new Set(basis.items.map((i) => i.bookingId));
  const lines = group.lines
    .filter((l) => onLeg.has(l.bookingId))
    .map((l) => ({
      rentalId: l.rentalId,
      bookingId: l.bookingId,
      driverLabel: l.driverLabel,
      weightGrams: l.weightGrams,
      containsLithium: l.containsLithium,
      unitReplacementValueCents: l.unitReplacementValueCents,
      quantity: l.quantity,
      startDate: l.startDate,
      endDate: l.endDate,
    }));
  if (lines.length === 0) return { ok: false, code: 'not_found', message: 'Booking not found.' };
  const dates = lines.map((l) => (leg === 'return' ? l.endDate : l.startDate)).sort();
  return {
    ok: true,
    renterId: group.renterId,
    lines,
    originAddressId: reverse ? basis.destinationAddressId : basis.originAddressId,
    destinationAddressId: reverse ? basis.originAddressId : basis.destinationAddressId,
    defaultDate: leg === 'return' ? dates[dates.length - 1] : dates[0],
    existing,
  };
}

/**
 * `delivery_quote_ready`: sent when a quote was obtained for the renter while
 * they were not looking at it (staff quoted a leg for them). Amount only, no
 * address; one notice per quote (dedupe key).
 */
export function quoteReadyNotices(renterId: string, quote: Pick<CustomerDeliveryQuote, 'id' | 'bookingIds' | 'customerFeeCents'>): OutboxMessage[] {
  return buildNotices({ kind: 'delivery_quote_ready', userId: renterId, bookingIds: quote.bookingIds, discriminator: `quote:${quote.id}`, data: { amountCents: quote.customerFeeCents } });
}
