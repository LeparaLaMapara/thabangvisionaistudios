import { DELIVERY_OPS, DELIVERY_POLICY } from '@/lib/constants';
import type { ProviderCallResult } from '@/lib/core/ports';
import type { ProviderDelivery } from '@/lib/core/delivery/port';
import type { DeliveryDeps, Shipment } from '@/lib/core/delivery/repository';
import { FINAL_DELIVERY_STATES, type DeliveryState } from '@/lib/core/delivery/state';
import { commitDelivery, deemDeliveryAccepted, recordProviderEvent, type ProviderEventOutcome } from '@/lib/core/delivery/use-cases';
import { buildNotices, type OutboxMessage } from '@/lib/core/rental/notifications';
import { isMissingPipeline } from '@/lib/rental/repos';
import type { createAdminClient } from '@/lib/supabase/server';
import { deliveryEventDedupeKey } from './inbox';

/**
 * Daily delivery jobs (spec Phase 4 §4.15, §4.19; R-41, R-43). Webhooks are
 * the real-time source; these run once a day from the rental pipeline as the
 * safety net (CLAUDE.md: daily crons only). Every job is bounded (a batch
 * per run), isolated (a failing shipment never stops the others) and
 * idempotent (running it twice changes nothing more than running it once).
 *
 *  - reconcileUncertainDispatches: a dispatch whose outcome is unknown (or
 *    whose claim went stale) is looked up at the provider by OUR merchant
 *    reference. Found → recorded through commitDelivery (which reconciles
 *    before anything else and never books a second courier, D10). Not found →
 *    staff are alerted; the job never re-creates a courier job on its own.
 *  - pollTrackedShipments: courier legs on the move are read from the
 *    provider and applied through recordProviderEvent (forward only, D13;
 *    same dedupe key as the webhook, so a missed webhook is applied once).
 *  - remindReturnPickups: `delivery_return_reminder` once per return leg
 *    whose pickup window starts soon.
 *  - deemDeliveryAcceptances: a delivered outbound leg the renter has not
 *    confirmed is reminded once, then deemed accepted after
 *    DELIVERY_POLICY.deemedAcceptanceHours (D-48), never over an exception
 *    or an open incident.
 *  - purgeDeliveryAddresses: purpose-based retention of delivery addresses
 *    (D-46); addresses of open shipments are never touched (re-checked in
 *    the database at the moment of writing).
 *
 * Each job takes an optional `deadline` (epoch ms): it stops taking new rows
 * once the pipeline's delivery time budget is spent; the rest wait for the
 * next pass.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

export interface DeliveryJobQueries {
  /** Dispatch intents in state 'unknown', or 'claimed' with a claim older than `staleBefore`. */
  listUncertainDispatches(staleBefore: string, limit: number): Promise<{ shipmentId: string }[]>;
  /** Courier legs on the move that the provider knows (provider reference set). */
  listTrackableShipments(limit: number): Promise<Pick<Shipment, 'id' | 'providerId' | 'providerReference' | 'merchantReference'>[]>;
  /** Return legs scheduled to be picked up between `from` and `to`. */
  listUpcomingReturnPickups(from: string, to: string, limit: number): Promise<Pick<Shipment, 'id' | 'renterId' | 'items'>[]>;
  /** Outbound legs delivered before `deliveredBefore` and not yet accepted. */
  listAwaitingAcceptance(deliveredBefore: string, limit: number): Promise<{ shipmentId: string }[]>;
}

const pastDeadline = (deadline?: number): boolean => deadline !== undefined && Date.now() > deadline;

const TRACKABLE: readonly DeliveryState[] = ['scheduled', 'courier_assigned', 'courier_at_pickup', 'collected', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed'];

async function safe<T>(fn: () => Promise<ProviderCallResult<T>>): Promise<ProviderCallResult<T>> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : 'provider call failed' };
  }
}

const bump = (o: Record<string, number>, k: string): void => {
  o[k] = (o[k] ?? 0) + 1;
};

function staffAlert(what: string, reference: string): OutboxMessage[] {
  return buildNotices({ kind: 'staff_alert', userId: 'staff', bookingIds: [], discriminator: `delivery:${what}:${reference}`, data: { what, reference } });
}

export async function reconcileUncertainDispatches(
  deps: DeliveryDeps,
  q: Pick<DeliveryJobQueries, 'listUncertainDispatches'>,
  limit: number = DELIVERY_OPS.jobBatchSize,
  deadline?: number,
): Promise<{ checked: number; outcomes: Record<string, number> }> {
  const now = deps.clock.now();
  const staleBefore = new Date(now.getTime() - DELIVERY_OPS.staleClaimMinutes * 60_000).toISOString();
  const rows = await q.listUncertainDispatches(staleBefore, limit);
  const outcomes: Record<string, number> = {};
  for (const { shipmentId } of rows) {
    if (pastDeadline(deadline)) {
      bump(outcomes, 'deferred');
      continue;
    }
    try {
      const s = await deps.repo.getShipment(shipmentId);
      if (!s || FINAL_DELIVERY_STATES.includes(s.status)) {
        bump(outcomes, 'closed');
        continue;
      }
      const port = deps.providers.get(s.providerId);
      if (!port) {
        await deps.repo.post([], staffAlert('delivery_provider_unavailable', s.merchantReference));
        bump(outcomes, 'provider_unavailable');
        continue;
      }
      const found = await safe(() => port.findByMerchantReference(s.merchantReference));
      if (!found.ok) {
        bump(outcomes, 'unreachable');
        continue;
      }
      if (!found.value) {
        // Nothing was booked under our reference. Re-dispatching is a person's decision (admin: retry dispatch).
        await deps.repo.post([], staffAlert('delivery_dispatch_not_at_provider', s.merchantReference));
        bump(outcomes, 'not_at_provider');
        continue;
      }
      const r = await commitDelivery({ caller: { kind: 'system' }, shipmentId: s.id }, deps);
      bump(outcomes, r.ok ? r.outcome : r.code);
    } catch {
      bump(outcomes, 'error');
    }
  }
  return { checked: rows.length, outcomes };
}

export async function pollTrackedShipments(
  deps: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId' | 'providers'>,
  q: Pick<DeliveryJobQueries, 'listTrackableShipments'>,
  limit: number = DELIVERY_OPS.jobBatchSize,
  deadline?: number,
): Promise<{ checked: number; outcomes: Record<string, ProviderEventOutcome | number> }> {
  const rows = await q.listTrackableShipments(limit);
  const outcomes: Record<string, number> = {};
  for (const s of rows) {
    if (pastDeadline(deadline)) {
      bump(outcomes, 'deferred');
      continue;
    }
    try {
      const port = deps.providers.get(s.providerId);
      if (!port || (port.kind ?? 'courier') !== 'courier' || !s.providerReference) {
        bump(outcomes, 'skipped');
        continue;
      }
      const ref = s.providerReference;
      const job = await safe<ProviderDelivery>(() => port.getDelivery(ref));
      if (!job.ok) {
        bump(outcomes, 'unreachable');
        continue;
      }
      if (job.value.state === 'unknown') {
        bump(outcomes, 'unknown_state');
        continue;
      }
      const outcome = await recordProviderEvent(
        {
          providerId: s.providerId,
          // An authenticated read of the provider's API, not caller input.
          verified: true,
          dedupeKey: deliveryEventDedupeKey(s.providerId, { eventId: null, merchantReference: s.merchantReference, providerReference: ref, state: job.value.state, stateAt: job.value.stateAt }),
          merchantReference: s.merchantReference,
          providerReference: ref,
          state: job.value.state,
          stateAt: job.value.stateAt,
          proof: job.value.proof,
          trackingUrl: job.value.trackingUrl,
          courierName: job.value.courierName,
          source: 'provider_poll',
        },
        deps,
      );
      bump(outcomes, outcome);
    } catch {
      bump(outcomes, 'error');
    }
  }
  return { checked: rows.length, outcomes };
}

export async function remindReturnPickups(
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
  q: Pick<DeliveryJobQueries, 'listUpcomingReturnPickups'>,
  limit: number = DELIVERY_OPS.jobBatchSize,
): Promise<{ reminded: number }> {
  const now = deps.clock.now();
  const to = new Date(now.getTime() + DELIVERY_OPS.returnReminderLeadHours * 3_600_000);
  const rows = await q.listUpcomingReturnPickups(now.toISOString(), to.toISOString(), limit);
  const notices: OutboxMessage[] = [];
  for (const s of rows) {
    // Dedupe key per shipment: one reminder per return leg, however often this runs.
    notices.push(...buildNotices({ kind: 'delivery_return_reminder', userId: s.renterId, bookingIds: s.items.map((i) => i.bookingId), discriminator: `${s.id}:return_reminder` }));
  }
  if (notices.length > 0) await deps.repo.post([], notices);
  return { reminded: rows.length };
}

/**
 * D-48: remind, then deem accepted, the delivered outbound legs the renter has
 * not confirmed. Bounded and idempotent (the reminder and the deemed
 * acceptance each have one dedupe key per leg).
 */
export async function deemDeliveryAcceptances(
  deps: Pick<DeliveryDeps, 'repo' | 'clock'>,
  q: Pick<DeliveryJobQueries, 'listAwaitingAcceptance'>,
  limit: number = DELIVERY_OPS.jobBatchSize,
  deadline?: number,
): Promise<{ checked: number; outcomes: Record<string, number> }> {
  const now = deps.clock.now();
  const remindAfterMs = (DELIVERY_POLICY.deemedAcceptanceHours - DELIVERY_POLICY.deemedAcceptanceReminderLeadHours) * 3_600_000;
  const rows = await q.listAwaitingAcceptance(new Date(now.getTime() - remindAfterMs).toISOString(), limit);
  const outcomes: Record<string, number> = {};
  for (const { shipmentId } of rows) {
    if (pastDeadline(deadline)) {
      bump(outcomes, 'deferred');
      continue;
    }
    try {
      const r = await deemDeliveryAccepted({ caller: { kind: 'system' }, shipmentId }, deps);
      bump(outcomes, r.ok ? r.outcome : r.code);
    } catch {
      bump(outcomes, 'error');
    }
  }
  return { checked: rows.length, outcomes };
}

// ── Address retention (R-41, D-46) ───────────────────────────────────────────

export interface RetentionAddress {
  id: string;
  createdAt: string;
  retainUntil: string | null;
  lat: number;
  lng: number;
  suburb: string | null;
  city: string | null;
  province: string | null;
}

export type AddressReference =
  | { addressId: string; kind: 'shipment'; shipmentId: string; quoteId: string; status: DeliveryState; acceptedAt: string | null; updatedAt: string; openIncident: boolean }
  | { addressId: string; kind: 'quote'; quoteId: string; status: string; createdAt: string; expiresAt: string };

export type PurgeDecision = { purge: true } | { purge: false; reason: 'open_shipment' | 'open_incident' | 'live_quote' | 'paid_quote' | 'recent_activity'; retainUntil: string };

/** A leg is closed when nothing more can happen to it that needs the address. */
export function shipmentClosedForRetention(r: { status: DeliveryState; acceptedAt: string | null }): boolean {
  if (r.status === 'cancelled' || r.status === 'failed') return true;
  return r.status === 'delivered' && r.acceptedAt !== null;
}

/**
 * Whether an address may be reduced to suburb level now. Never while any
 * shipment using it is open (including delivered-but-not-accepted, lost,
 * damaged or under review), while it has an open incident, or while a quote
 * using it can still be paid or dispatched. Otherwise it is kept until
 * `retentionDays` after the last activity (leg closed, quote made).
 */
export function addressPurgeDecision(a: RetentionAddress, refs: readonly AddressReference[], now: Date, retentionDays: number = DELIVERY_POLICY.addressRetentionDays): PurgeDecision {
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
  let last = new Date(a.createdAt).getTime();
  for (const r of refs) {
    if (r.kind === 'shipment') {
      if (!shipmentClosedForRetention(r)) return { purge: false, reason: 'open_shipment', retainUntil: tomorrow };
      if (r.openIncident) return { purge: false, reason: 'open_incident', retainUntil: tomorrow };
      last = Math.max(last, new Date(r.updatedAt).getTime());
    } else {
      if (r.status === 'active' && new Date(r.expiresAt).getTime() > now.getTime()) return { purge: false, reason: 'live_quote', retainUntil: tomorrow };
      if (r.status === 'paid') {
        // Paid, and no leg was ever made from it: it is still to be dispatched.
        const leg = refs.some((x) => x.kind === 'shipment' && x.quoteId === r.quoteId);
        if (!leg) return { purge: false, reason: 'paid_quote', retainUntil: tomorrow };
      }
      last = Math.max(last, new Date(r.createdAt).getTime());
    }
  }
  const until = last + retentionDays * 86_400_000;
  if (until > now.getTime()) return { purge: false, reason: 'recent_activity', retainUntil: new Date(until).toISOString() };
  return { purge: true };
}

export interface AddressRetentionStore {
  /** Unredacted renter and owner addresses due for a decision (never our own sites). */
  listDue(now: string, createdBefore: string, limit: number): Promise<RetentionAddress[]>;
  references(addressIds: readonly string[]): Promise<AddressReference[]>;
  /** Reduce to suburb level; only if still unredacted. True when this call redacted it. */
  redact(a: RetentionAddress, now: string): Promise<boolean>;
  /** Re-check no earlier than this. */
  setRetainUntil(addressId: string, retainUntil: string): Promise<void>;
}

export async function purgeDeliveryAddresses(
  store: AddressRetentionStore,
  now: Date,
  opts: { retentionDays?: number; limit?: number } = {},
): Promise<{ checked: number; purged: number; kept: Record<string, number> }> {
  const retentionDays = opts.retentionDays ?? DELIVERY_POLICY.addressRetentionDays;
  const createdBefore = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const due = await store.listDue(now.toISOString(), createdBefore, opts.limit ?? DELIVERY_OPS.addressPurgeBatchSize);
  const kept: Record<string, number> = {};
  let purged = 0;
  if (due.length === 0) return { checked: 0, purged, kept };
  const refs = await store.references(due.map((a) => a.id));
  for (const a of due) {
    const d = addressPurgeDecision(
      a,
      refs.filter((r) => r.addressId === a.id),
      now,
      retentionDays,
    );
    if (d.purge) {
      if (await store.redact(a, now.toISOString())) purged += 1;
    } else {
      bump(kept, d.reason);
      await store.setRetainUntil(a.id, d.retainUntil);
    }
  }
  return { checked: due.length, purged, kept };
}

/** Coordinates at suburb level (about 1 km). */
export function coarse(n: number): number {
  const f = 10 ** DELIVERY_OPS.purgedCoordinateDecimals;
  return Math.round(n * f) / f;
}

/** What a purged address keeps: the area, never the street, the person or the phone number. */
export function redactedAddressFields(a: RetentionAddress, now: string): Row {
  const area = [a.suburb, a.city].filter((x): x is string => !!x && x.trim().length > 0).join(', ') || a.province || 'Address removed';
  return { formatted_address: area, contact_name: '', contact_phone: '', instructions: null, lat: coarse(a.lat), lng: coarse(a.lng), redacted_at: now };
}

// ── Supabase adapters ────────────────────────────────────────────────────────

function fail(name: string, error: { message?: string; code?: string }): Error {
  return new Error(`${name} failed: ${error.message ?? 'unknown'}`);
}

export class SupabaseDeliveryJobQueries implements DeliveryJobQueries {
  constructor(private db: Admin) {}

  async listUncertainDispatches(staleBefore: string, limit: number): Promise<{ shipmentId: string }[]> {
    const [unknown, stale] = await Promise.all([
      this.db.from('delivery_dispatch_intents').select('shipment_id').eq('state', 'unknown').order('updated_at').limit(limit),
      this.db.from('delivery_dispatch_intents').select('shipment_id').eq('state', 'claimed').lt('claimed_at', staleBefore).order('claimed_at').limit(limit),
    ]);
    for (const r of [unknown, stale]) {
      if (r.error) {
        if (isMissingPipeline(r.error)) return [];
        throw fail('listUncertainDispatches', r.error);
      }
    }
    const ids = [...new Set([...(unknown.data ?? []), ...(stale.data ?? [])].map((r) => String((r as Row).shipment_id)))];
    return ids.slice(0, limit).map((shipmentId) => ({ shipmentId }));
  }

  async listTrackableShipments(limit: number): Promise<Pick<Shipment, 'id' | 'providerId' | 'providerReference' | 'merchantReference'>[]> {
    const { data, error } = await this.db
      .from('delivery_shipments')
      .select('id, provider, provider_reference, merchant_reference')
      .eq('provider_kind', 'courier')
      .in('status', [...TRACKABLE])
      .not('provider_reference', 'is', null)
      .order('updated_at')
      .limit(limit);
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw fail('listTrackableShipments', error);
    }
    return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), providerId: String(r.provider), providerReference: r.provider_reference === null ? null : String(r.provider_reference), merchantReference: String(r.merchant_reference) }));
  }

  async listUpcomingReturnPickups(from: string, to: string, limit: number): Promise<Pick<Shipment, 'id' | 'renterId' | 'items'>[]> {
    const { data, error } = await this.db
      .from('delivery_shipments')
      .select('id, renter_id, items')
      .eq('leg', 'return')
      .in('status', ['scheduled', 'courier_assigned'])
      .gte('window_start', from)
      .lte('window_start', to)
      .order('window_start')
      .limit(limit);
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw fail('listUpcomingReturnPickups', error);
    }
    return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), renterId: String(r.renter_id), items: (r.items as Shipment['items'] | null) ?? [] }));
  }

  async listAwaitingAcceptance(deliveredBefore: string, limit: number): Promise<{ shipmentId: string }[]> {
    const { data, error } = await this.db
      .from('delivery_shipments')
      .select('id')
      .eq('leg', 'outbound')
      .eq('status', 'delivered')
      .is('accepted_at', null)
      .lt('delivered_at', deliveredBefore)
      .order('delivered_at')
      .limit(limit);
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw fail('listAwaitingAcceptance', error);
    }
    return ((data ?? []) as Row[]).map((r) => ({ shipmentId: String(r.id) }));
  }
}

const ADDRESS_COLS = 'id, created_at, retain_until, lat, lng, suburb, city, province';

function toRetention(r: Row): RetentionAddress {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    retainUntil: r.retain_until === null || r.retain_until === undefined ? null : String(r.retain_until),
    lat: Number(r.lat),
    lng: Number(r.lng),
    suburb: (r.suburb as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    province: (r.province as string | null) ?? null,
  };
}

export class SupabaseAddressRetention implements AddressRetentionStore {
  constructor(private db: Admin) {}

  async listDue(now: string, createdBefore: string, limit: number): Promise<RetentionAddress[]> {
    const base = () => this.db.from('delivery_addresses').select(ADDRESS_COLS).is('redacted_at', null).in('purpose', ['renter_address', 'owner_handover']);
    const [fresh, recheck] = await Promise.all([
      base().is('retain_until', null).lt('created_at', createdBefore).order('created_at').limit(limit),
      base().lt('retain_until', now).order('retain_until').limit(limit),
    ]);
    for (const r of [fresh, recheck]) {
      if (r.error) {
        if (isMissingPipeline(r.error)) return [];
        throw fail('delivery address retention list', r.error);
      }
    }
    const seen = new Set<string>();
    const out: RetentionAddress[] = [];
    for (const row of [...((recheck.data ?? []) as Row[]), ...((fresh.data ?? []) as Row[])]) {
      const a = toRetention(row);
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
    return out.slice(0, limit);
  }

  async references(addressIds: readonly string[]): Promise<AddressReference[]> {
    const ids = [...addressIds];
    const shipCols = 'id, quote_id, status, accepted_at, updated_at, origin_address_id, destination_address_id';
    const quoteCols = 'id, status, created_at, expires_at, origin_address_id, destination_address_id';
    const [so, sd, qo, qd] = await Promise.all([
      this.db.from('delivery_shipments').select(shipCols).in('origin_address_id', ids),
      this.db.from('delivery_shipments').select(shipCols).in('destination_address_id', ids),
      this.db.from('delivery_quotes').select(quoteCols).in('origin_address_id', ids),
      this.db.from('delivery_quotes').select(quoteCols).in('destination_address_id', ids),
    ]);
    for (const r of [so, sd, qo, qd]) if (r.error) throw fail('delivery address references', r.error);
    const shipments = new Map<string, Row>();
    for (const r of [...((so.data ?? []) as Row[]), ...((sd.data ?? []) as Row[])]) shipments.set(String(r.id), r);
    const shipmentIds = [...shipments.keys()];
    const open = new Set<string>();
    if (shipmentIds.length > 0) {
      const inc = await this.db.from('delivery_incidents').select('shipment_id').in('shipment_id', shipmentIds).in('status', ['open', 'investigating']);
      if (inc.error) throw fail('delivery address incidents', inc.error);
      for (const r of (inc.data ?? []) as Row[]) open.add(String(r.shipment_id));
    }
    const wanted = new Set(ids);
    const out: AddressReference[] = [];
    for (const r of shipments.values()) {
      for (const col of ['origin_address_id', 'destination_address_id'] as const) {
        const addressId = String(r[col]);
        if (!wanted.has(addressId)) continue;
        out.push({ addressId, kind: 'shipment', shipmentId: String(r.id), quoteId: String(r.quote_id), status: r.status as DeliveryState, acceptedAt: (r.accepted_at as string | null) ?? null, updatedAt: String(r.updated_at), openIncident: open.has(String(r.id)) });
      }
    }
    const quotes = new Map<string, Row>();
    for (const r of [...((qo.data ?? []) as Row[]), ...((qd.data ?? []) as Row[])]) quotes.set(String(r.id), r);
    for (const r of quotes.values()) {
      for (const col of ['origin_address_id', 'destination_address_id'] as const) {
        const addressId = String(r[col]);
        if (!wanted.has(addressId)) continue;
        out.push({ addressId, kind: 'quote', quoteId: String(r.id), status: String(r.status), createdAt: String(r.created_at), expiresAt: String(r.expires_at) });
      }
    }
    return out;
  }

  async redact(a: RetentionAddress, now: string): Promise<boolean> {
    // The database re-checks, in the same UPDATE, that no live shipment, open
    // incident, live quote or undispatched paid quote uses the address (a leg
    // made after the decision above keeps it).
    const { data, error } = await this.db.rpc('delivery_redact_address', { p_address: a.id, p_fields: redactedAddressFields(a, now), p_now: now });
    if (error) throw fail('delivery address redact', error);
    return data === true;
  }

  async setRetainUntil(addressId: string, retainUntil: string): Promise<void> {
    const { error } = await this.db.from('delivery_addresses').update({ retain_until: retainUntil }).eq('id', addressId).is('redacted_at', null);
    if (error) throw fail('delivery address retain_until', error);
  }
}
