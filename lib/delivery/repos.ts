import { createAdminClient } from '@/lib/supabase/server';
import { DELIVERY_POLICY, RENTAL_POLICY } from '@/lib/constants';
import type { CustodyEvent } from '@/lib/core/delivery/custody';
import type { DeliveryIncident, IncidentStatus } from '@/lib/core/delivery/incidents';
import type { DeliveryPoint, ProviderDeliveryState } from '@/lib/core/delivery/port';
import type { CustomerDeliveryQuote, QuoteStatus } from '@/lib/core/delivery/quote';
import type {
  DeliveryAddressStore,
  DeliveryBookingPort,
  DeliveryBookingView,
  DeliveryRepository,
  DispatchIntent,
  DispatchIntentState,
  NewShipment,
  ReconciliationRecord,
  RenterTrustPort,
  Shipment,
  ShipmentItem,
  ShipmentPatch,
  ShipmentTransition,
  TransitionResult,
  UnusedQuoteRefund,
} from '@/lib/core/delivery/repository';
import type { DeliveryState } from '@/lib/core/delivery/state';
import type { Journal } from '@/lib/core/rental/ledger';
import type { OutboxMessage } from '@/lib/core/rental/notifications';
import type { BookingStatus } from '@/lib/core/rental/state';
import { isManualPaymentReference } from '@/lib/core/delivery/use-cases';
import { OriginAddressChangedError } from '@/lib/core/delivery/repository';
import { loadRenterFacts } from '@/lib/rental/eligibility-server';
import { isMissingPipeline } from '@/lib/rental/repos';
import type { DeliveryInboxStore, StoredDeliveryEvent } from './inbox';
import type { ManualTask, ManualTaskStore } from './manual';

/**
 * Supabase adapters for the delivery ports (migration 076). Service role only:
 * every state change goes through a SECURITY DEFINER function, so the change,
 * its journals, notices, custody, incidents and any refund obligation commit
 * together or not at all. Never import this from a client component.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

function dbError(name: string, error: { message?: string; code?: string }): Error {
  const e = new Error(`${name} failed: ${error.message ?? 'unknown'}`);
  (e as Error & { code?: string }).code = error.code;
  return e;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0);

const QUOTE_COLS =
  'id, renter_id, booking_group_id, leg, provider, provider_kind, provider_quote_ref, quote_amount_cents, provider_cost_cents, platform_fee_cents, customer_fee_cents, replacement_value_cents, booking_ids, rental_ids, origin_owner_id, origin_address_id, destination_address_id, window_start, window_end, expires_at, status, paid_reference, line_snapshot, requested_at, created_at';

function toQuote(r: Row): CustomerDeliveryQuote {
  return {
    id: String(r.id),
    renterId: String(r.renter_id),
    bookingGroupId: str(r.booking_group_id),
    leg: r.leg as CustomerDeliveryQuote['leg'],
    providerId: String(r.provider),
    providerKind: r.provider_kind as CustomerDeliveryQuote['providerKind'],
    providerQuoteRef: str(r.provider_quote_ref),
    quoteAmountCents: num(r.quote_amount_cents),
    providerCostCents: num(r.provider_cost_cents),
    platformFeeCents: num(r.platform_fee_cents),
    customerFeeCents: num(r.customer_fee_cents),
    replacementValueCents: num(r.replacement_value_cents),
    bookingIds: (r.booking_ids as string[] | null) ?? [],
    rentalIds: (r.rental_ids as string[] | null) ?? [],
    originOwnerId: str(r.origin_owner_id),
    originAddressId: String(r.origin_address_id),
    destinationAddressId: String(r.destination_address_id),
    window: { start: str(r.window_start), end: str(r.window_end) },
    expiresAt: String(r.expires_at),
    status: r.status as QuoteStatus,
    paidReference: str(r.paid_reference),
    lines: Array.isArray(r.line_snapshot) ? (r.line_snapshot as CustomerDeliveryQuote['lines']) : [],
    requestedAt: str(r.requested_at),
    createdAt: String(r.created_at),
  };
}

const SHIPMENT_COLS =
  'id, booking_group_id, leg, attempt, origin_owner_id, renter_id, items, provider, provider_kind, quote_id, merchant_reference, provider_reference, status, quote_amount_cents, customer_fee_cents, platform_fee_cents, accrued_cost_cents, provider_cost_cents, replacement_value_cents, coverage_verified, insurance_reference, tracking_reference, tracking_url, courier_name, recipient_pin, origin_address_id, destination_address_id, window_start, window_end, scheduled_at, collected_at, delivered_at, accepted_at, last_provider_state_at, paid_reference, created_at';

function toShipment(r: Row): Shipment {
  return {
    id: String(r.id),
    bookingGroupId: String(r.booking_group_id),
    leg: r.leg as Shipment['leg'],
    attempt: num(r.attempt),
    originOwnerId: str(r.origin_owner_id),
    renterId: String(r.renter_id),
    items: ((r.items as ShipmentItem[] | null) ?? []).map((i) => ({ bookingId: i.bookingId, rentalId: i.rentalId, ownerId: i.ownerId ?? null, serialNumber: i.serialNumber ?? null })),
    providerId: String(r.provider),
    providerKind: r.provider_kind as Shipment['providerKind'],
    quoteId: String(r.quote_id),
    merchantReference: String(r.merchant_reference),
    providerReference: str(r.provider_reference),
    status: r.status as DeliveryState,
    quoteAmountCents: num(r.quote_amount_cents),
    customerFeeCents: num(r.customer_fee_cents),
    platformFeeCents: num(r.platform_fee_cents),
    accruedCostCents: num(r.accrued_cost_cents),
    providerCostCents: r.provider_cost_cents === null || r.provider_cost_cents === undefined ? null : num(r.provider_cost_cents),
    replacementValueCents: num(r.replacement_value_cents),
    coverageVerified: r.coverage_verified === true,
    insuranceReference: str(r.insurance_reference),
    trackingReference: str(r.tracking_reference),
    trackingUrl: str(r.tracking_url),
    courierName: str(r.courier_name),
    recipientPin: str(r.recipient_pin),
    originAddressId: String(r.origin_address_id),
    destinationAddressId: String(r.destination_address_id),
    window: { start: str(r.window_start), end: str(r.window_end) },
    scheduledAt: str(r.scheduled_at),
    collectedAt: str(r.collected_at),
    deliveredAt: str(r.delivered_at),
    acceptedAt: str(r.accepted_at),
    lastProviderStateAt: str(r.last_provider_state_at),
    paidReference: str(r.paid_reference),
    createdAt: String(r.created_at),
  };
}

function toIntent(r: Row): DispatchIntent {
  return {
    id: String(r.id),
    shipmentId: String(r.shipment_id),
    merchantReference: String(r.merchant_reference),
    idempotencyKey: String(r.idempotency_key),
    providerId: String(r.provider),
    state: r.state as DispatchIntentState,
    attempts: num(r.attempts),
    claimedAt: str(r.claimed_at),
    lastError: str(r.last_error),
    providerReference: str(r.provider_reference),
  };
}

function toCustody(r: Row): CustodyEvent {
  return {
    shipmentId: String(r.shipment_id),
    bookingGroupId: String(r.booking_group_id),
    bookingId: String(r.booking_id),
    rentalId: String(r.rental_id),
    serialNumber: str(r.serial_number),
    kind: r.kind as CustodyEvent['kind'],
    actor: { kind: r.actor_kind as CustodyEvent['actor']['kind'], id: str(r.actor_id) },
    occurredAt: String(r.occurred_at),
    evidence: (r.evidence as CustodyEvent['evidence']) ?? [],
    accessories: (r.accessories as CustodyEvent['accessories']) ?? [],
    serialConfirmed: r.serial_confirmed === true,
    condition: str(r.condition),
    discrepancies: (r.discrepancies as string[]) ?? [],
    incidentId: str(r.incident_id),
    dedupeKey: String(r.dedupe_key),
  };
}

function toIncident(r: Row): DeliveryIncident {
  return {
    id: String(r.id),
    shipmentId: String(r.shipment_id),
    bookingGroupId: String(r.booking_group_id),
    bookingIds: (r.booking_ids as string[] | null) ?? [],
    leg: r.leg as DeliveryIncident['leg'],
    kind: r.kind as DeliveryIncident['kind'],
    status: r.status as IncidentStatus,
    providerCaused: r.provider_caused === null || r.provider_caused === undefined ? null : r.provider_caused === true,
    liability: r.liability as DeliveryIncident['liability'],
    reportedBy: { kind: r.reported_by_kind as DeliveryIncident['reportedBy']['kind'], id: str(r.reported_by_id) },
    description: String(r.description ?? ''),
    evidence: (r.evidence as DeliveryIncident['evidence']) ?? [],
    dedupeKey: String(r.dedupe_key),
    createdAt: String(r.created_at),
  };
}

export class SupabaseDeliveryRepository implements DeliveryRepository {
  constructor(private db: Admin = createAdminClient()) {}

  async saveQuote(q: Omit<CustomerDeliveryQuote, 'id' | 'createdAt'>): Promise<CustomerDeliveryQuote> {
    const { data, error } = await this.db
      .from('delivery_quotes')
      .insert({
        renter_id: q.renterId,
        booking_group_id: q.bookingGroupId,
        leg: q.leg,
        provider: q.providerId,
        provider_kind: q.providerKind,
        provider_quote_ref: q.providerQuoteRef,
        quote_amount_cents: q.quoteAmountCents,
        provider_cost_cents: q.providerCostCents,
        platform_fee_cents: q.platformFeeCents,
        customer_fee_cents: q.customerFeeCents,
        replacement_value_cents: q.replacementValueCents,
        booking_ids: q.bookingIds,
        rental_ids: q.rentalIds,
        origin_owner_id: q.originOwnerId ?? null,
        origin_address_id: q.originAddressId,
        destination_address_id: q.destinationAddressId,
        window_start: q.window.start,
        window_end: q.window.end,
        expires_at: q.expiresAt,
        status: q.status,
        paid_reference: q.paidReference,
        line_snapshot: q.lines ?? [],
        requested_at: q.requestedAt ?? null,
      })
      .select(QUOTE_COLS)
      .single();
    if (error) throw dbError('saveQuote', error);
    return toQuote(data as Row);
  }

  async getQuote(id: string): Promise<CustomerDeliveryQuote | null> {
    const { data, error } = await this.db.from('delivery_quotes').select(QUOTE_COLS).eq('id', id).maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw dbError('getQuote', error);
    }
    return data ? toQuote(data as Row) : null;
  }

  async setQuoteStatus(id: string, from: readonly QuoteStatus[], to: QuoteStatus, patch: { paidReference?: string; bookingGroupId?: string } = {}): Promise<boolean> {
    const { data, error } = await this.db.rpc('delivery_mark_quote_paid', {
      p_quote: id,
      p_from: [...from],
      p_to: to,
      p_paid_reference: patch.paidReference ?? null,
      p_booking_group: patch.bookingGroupId ?? null,
    });
    if (error) throw dbError('delivery_mark_quote_paid', error);
    return data === true;
  }

  async getShipment(id: string): Promise<Shipment | null> {
    const { data, error } = await this.db.from('delivery_shipments').select(SHIPMENT_COLS).eq('id', id).maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw dbError('getShipment', error);
    }
    return data ? toShipment(data as Row) : null;
  }

  async findShipment(by: { merchantReference: string } | { providerId: string; providerReference: string }): Promise<Shipment | null> {
    let q = this.db.from('delivery_shipments').select(SHIPMENT_COLS);
    q = 'merchantReference' in by ? q.eq('merchant_reference', by.merchantReference) : q.eq('provider', by.providerId).eq('provider_reference', by.providerReference);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw dbError('findShipment', error);
    }
    return data ? toShipment(data as Row) : null;
  }

  async listShipments(bookingGroupId: string): Promise<Shipment[]> {
    const { data, error } = await this.db.from('delivery_shipments').select(SHIPMENT_COLS).eq('booking_group_id', bookingGroupId).order('created_at');
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw dbError('listShipments', error);
    }
    return ((data ?? []) as Row[]).map(toShipment);
  }

  async createShipment(
    s: NewShipment,
    intent: Omit<DispatchIntent, 'id' | 'shipmentId' | 'attempts' | 'claimedAt' | 'lastError' | 'providerReference' | 'state'>,
  ): Promise<{ shipment: Shipment; intent: DispatchIntent; created: boolean }> {
    const { data, error } = await this.db.rpc('delivery_create_shipment', { p_shipment: s, p_intent: intent });
    if (error?.message?.includes('delivery_origin_address_changed')) throw new OriginAddressChangedError();
    if (error) throw dbError('delivery_create_shipment', error);
    const res = data as { shipment_id: string; created: boolean };
    const [shipment, di] = await Promise.all([this.getShipment(res.shipment_id), this.getDispatchIntent(res.shipment_id)]);
    if (!shipment || !di) throw new Error('delivery_create_shipment: row not readable after insert');
    return { shipment, intent: di, created: res.created };
  }

  async getDispatchIntent(shipmentId: string): Promise<DispatchIntent | null> {
    const { data, error } = await this.db.from('delivery_dispatch_intents').select('*').eq('shipment_id', shipmentId).maybeSingle();
    if (error) throw dbError('getDispatchIntent', error);
    return data ? toIntent(data as Row) : null;
  }

  async claimDispatch(intentId: string, from: readonly DispatchIntentState[], now: string, staleBefore: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('delivery_claim_dispatch', { p_intent: intentId, p_from: [...from], p_now: now, p_stale_before: staleBefore });
    if (error) throw dbError('delivery_claim_dispatch', error);
    return data === true;
  }

  async finishDispatch(intentId: string, to: 'succeeded' | 'unknown' | 'rejected', patch: { providerReference?: string | null; lastError?: string | null }): Promise<void> {
    const update: Row = { state: to, updated_at: new Date().toISOString() };
    if (patch.providerReference !== undefined) update.provider_reference = patch.providerReference;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    const { error } = await this.db.from('delivery_dispatch_intents').update(update).eq('id', intentId);
    if (error) throw dbError('finishDispatch', error);
  }

  async saveRecipientPin(shipmentId: string, pin: string): Promise<void> {
    if (!/^[0-9]{4,8}$/.test(pin)) return;
    const { error } = await this.db.from('delivery_shipments').update({ recipient_pin: pin }).eq('id', shipmentId);
    if (error) throw dbError('saveRecipientPin', error);
  }

  async transitionShipment(t: ShipmentTransition): Promise<TransitionResult> {
    const { data, error } = await this.db.rpc('delivery_apply_transition', { p: t });
    if (error) throw dbError('delivery_apply_transition', error);
    return data as TransitionResult;
  }

  async hasEvent(dedupeKey: string): Promise<boolean> {
    const { data, error } = await this.db.from('delivery_events').select('id').eq('dedupe_key', dedupeKey).limit(1);
    if (error) throw dbError('hasEvent', error);
    return (data ?? []).length > 0;
  }

  async listCustody(shipmentId: string): Promise<CustodyEvent[]> {
    const { data, error } = await this.db.from('delivery_custody_events').select('*').eq('shipment_id', shipmentId).order('id');
    if (error) throw dbError('listCustody', error);
    return ((data ?? []) as Row[]).map(toCustody);
  }

  async listIncidents(bookingGroupId: string): Promise<DeliveryIncident[]> {
    const { data, error } = await this.db.from('delivery_incidents').select('*').eq('booking_group_id', bookingGroupId).order('created_at');
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw dbError('listIncidents', error);
    }
    return ((data ?? []) as Row[]).map(toIncident);
  }

  async getIncident(id: string): Promise<DeliveryIncident | null> {
    const { data, error } = await this.db.from('delivery_incidents').select('*').eq('id', id).maybeSingle();
    if (error) throw dbError('getIncident', error);
    return data ? toIncident(data as Row) : null;
  }

  async openIncident(i: DeliveryIncident, notices: OutboxMessage[]): Promise<'inserted' | 'duplicate'> {
    const { data, error } = await this.db.rpc('delivery_open_incident', { p_incident: i, p_notices: notices });
    if (error) throw dbError('delivery_open_incident', error);
    return data === true ? 'inserted' : 'duplicate';
  }

  async updateIncident(
    id: string,
    from: readonly IncidentStatus[],
    patch: Partial<Pick<DeliveryIncident, 'status' | 'providerCaused' | 'liability'>> & { resolution?: string; resolvedBy?: string | null },
  ): Promise<boolean> {
    const update: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.providerCaused !== undefined) update.provider_caused = patch.providerCaused;
    if (patch.liability !== undefined) update.liability = patch.liability;
    if (patch.resolution !== undefined) update.resolution = patch.resolution;
    if (patch.resolvedBy !== undefined) update.resolved_by = patch.resolvedBy;
    if (patch.status === 'resolved' || patch.status === 'closed') update.resolved_at = new Date().toISOString();
    const { data, error } = await this.db.from('delivery_incidents').update(update).eq('id', id).in('status', [...from]).select('id');
    if (error) throw dbError('updateIncident', error);
    return (data ?? []).length > 0;
  }

  async saveReconciliation(r: ReconciliationRecord, journals: Journal[], notices: OutboxMessage[], _patch: ShipmentPatch): Promise<'inserted' | 'duplicate'> {
    // The function sets the shipment's provider and accrued cost to the invoiced amount (the patch the core sends).
    void _patch;
    const { data, error } = await this.db.rpc('delivery_save_reconciliation', { p_record: r, p_journals: journals, p_notices: notices });
    if (error) throw dbError('delivery_save_reconciliation', error);
    return data === true ? 'inserted' : 'duplicate';
  }

  async post(journals: Journal[], notices: OutboxMessage[]): Promise<void> {
    if (journals.length === 0 && notices.length === 0) return;
    const { error } = await this.db.rpc('delivery_post', { p_journals: journals, p_notices: notices });
    if (error) throw dbError('delivery_post', error);
  }

  async refundUnusedQuote(r: UnusedQuoteRefund): Promise<'applied' | 'conflict'> {
    const { data, error } = await this.db.rpc('delivery_refund_quote', { p: r });
    if (error) throw dbError('delivery_refund_quote', error);
    return data === 'applied' ? 'applied' : 'conflict';
  }
}

/** Verified addresses. Service role; the result never goes to an owner or another user. */
export class SupabaseDeliveryAddresses implements DeliveryAddressStore {
  constructor(private db: Admin = createAdminClient()) {}
  async getPoint(addressId: string): Promise<(DeliveryPoint & { userId: string | null }) | null> {
    const { data, error } = await this.db
      .from('delivery_addresses')
      .select('id, user_id, formatted_address, suburb, city, province, postal_code, lat, lng, contact_name, contact_phone, instructions, redacted_at')
      .eq('id', addressId)
      .maybeSingle();
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw dbError('getPoint', error);
    }
    const r = data as Row | null;
    if (!r || r.redacted_at) return null;
    return {
      placeId: String(r.id),
      userId: str(r.user_id),
      lat: num(r.lat),
      lng: num(r.lng),
      formattedAddress: String(r.formatted_address),
      suburb: str(r.suburb),
      city: str(r.city),
      province: str(r.province),
      postalCode: str(r.postal_code),
      contactName: String(r.contact_name),
      contactPhone: String(r.contact_phone),
      instructions: str(r.instructions),
    };
  }
}

/** The provider-side state of an own-fleet task, read from its shipment (staff move the shipment). */
export function manualStateFor(status: DeliveryState | null, taskState: string): ProviderDeliveryState {
  if (taskState === 'cancelled') return 'cancelled';
  switch (status) {
    case null:
    case 'prepared':
    case 'booking':
    case 'scheduled':
      return 'pending';
    case 'courier_assigned':
    case 'courier_at_pickup':
    case 'collected':
    case 'in_transit':
    case 'courier_at_dropoff':
    case 'delivered':
    case 'cancelled':
    case 'failed':
    case 'delivery_attempt_failed':
    case 'return_to_sender':
    case 'lost':
    case 'damaged':
      return status;
    default:
      return 'unknown';
  }
}

export class SupabaseManualTaskStore implements ManualTaskStore {
  constructor(private db: Admin = createAdminClient()) {}

  private async read(column: 'merchant_reference' | 'provider_reference', value: string): Promise<ManualTask | null> {
    const { data, error } = await this.db.from('delivery_manual_tasks').select('*').eq(column, value).maybeSingle();
    if (error) throw dbError('manual task read', error);
    const r = data as Row | null;
    if (!r) return null;
    const { data: s } = await this.db.from('delivery_shipments').select('status').eq('merchant_reference', String(r.merchant_reference)).maybeSingle();
    return {
      merchantReference: String(r.merchant_reference),
      providerReference: String(r.provider_reference),
      leg: r.leg as ManualTask['leg'],
      state: manualStateFor(((s as Row | null)?.status as DeliveryState | undefined) ?? null, String(r.state)),
      windowStart: str(r.window_start),
      windowEnd: str(r.window_end),
      itemCount: num(r.item_count),
      createdAt: String(r.created_at),
    };
  }

  async create(task: ManualTask): Promise<{ task: ManualTask; created: boolean }> {
    const { data, error } = await this.db
      .from('delivery_manual_tasks')
      .upsert(
        {
          merchant_reference: task.merchantReference,
          provider_reference: task.providerReference,
          leg: task.leg,
          state: 'pending',
          window_start: task.windowStart,
          window_end: task.windowEnd,
          item_count: task.itemCount,
        },
        { onConflict: 'merchant_reference', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw dbError('manual task create', error);
    const created = (data ?? []).length > 0;
    const stored = await this.read('merchant_reference', task.merchantReference);
    if (!stored) throw new Error('manual task not readable after create');
    return { task: stored, created };
  }

  findByMerchantReference(merchantReference: string): Promise<ManualTask | null> {
    return this.read('merchant_reference', merchantReference);
  }

  get(providerReference: string): Promise<ManualTask | null> {
    return this.read('provider_reference', providerReference);
  }

  async cancel(providerReference: string, reason: string): Promise<ManualTask | null> {
    const t = await this.read('provider_reference', providerReference);
    if (!t) return null;
    if (!['pending', 'courier_assigned', 'courier_at_pickup', 'cancelled'].includes(t.state)) return null;
    const { error } = await this.db
      .from('delivery_manual_tasks')
      .update({ state: 'cancelled', cancel_reason: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('provider_reference', providerReference);
    if (error) throw dbError('manual task cancel', error);
    return { ...t, state: 'cancelled' };
  }
}

export class SupabaseDeliveryInbox implements DeliveryInboxStore {
  constructor(private db: Admin = createAdminClient()) {}

  async store(row: Parameters<DeliveryInboxStore['store']>[0]): Promise<{ stored: true; id: string } | { stored: false; duplicate: true }> {
    const { data, error } = await this.db
      .from('delivery_provider_events')
      .upsert(
        {
          provider: row.providerId,
          provider_event_id: row.eventId,
          dedupe_key: row.dedupeKey,
          event_type: row.eventType,
          merchant_reference: row.merchantReference,
          provider_reference: row.providerReference,
          payload: row.payload,
          // Only ever called after the route verified the signature (receiveDeliveryWebhook).
          signature_verified: true,
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw dbError('delivery_provider_events insert', error);
    if (!data || data.length === 0) return { stored: false, duplicate: true };
    return { stored: true, id: String((data[0] as Row).id) };
  }

  async markDone(id: string, status: 'processed' | 'ignored', outcome: string): Promise<void> {
    const { error } = await this.db
      .from('delivery_provider_events')
      .update({ processing_status: status, processed_at: new Date().toISOString(), outcome, last_error: null })
      .eq('id', id);
    if (error) throw dbError('delivery inbox markDone', error);
  }

  async markFailed(id: string, message: string, nextAttemptAt: string): Promise<void> {
    const { error } = await this.db
      .from('delivery_provider_events')
      .update({ processing_status: 'failed', last_error: message, next_attempt_at: nextAttemptAt })
      .eq('id', id);
    if (error) throw dbError('delivery inbox markFailed', error);
  }

  async claim(limit: number, maxRetries: number): Promise<StoredDeliveryEvent[]> {
    const { data, error } = await this.db.rpc('claim_delivery_provider_events', { p_limit: limit, p_max_retries: maxRetries });
    if (error) {
      if (isMissingPipeline(error)) return [];
      throw dbError('claim_delivery_provider_events', error);
    }
    return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), providerId: String(r.provider), payload: (r.payload as Row) ?? {}, retryCount: num(r.retry_count) }));
  }
}

const CONFIRMED_BY_HAND: readonly string[] = ['confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'completed', 'disputed'];

/**
 * The manual-payment reference when every live line of the order was confirmed
 * through confirm_manual_payment (070): each carries the same `manual:`
 * reference (payfast_payment_id) and is past `pending`. Otherwise null.
 */
export function manualPaymentOf(rows: readonly Row[]): string | null {
  const live = rows.filter((r) => r.status !== 'cancelled');
  if (live.length === 0) return null;
  const refs = new Set(live.map((r) => str(r.payfast_payment_id)));
  if (refs.size !== 1) return null;
  const ref = [...refs][0];
  if (!ref || !isManualPaymentReference(ref)) return null;
  return live.every((r) => CONFIRMED_BY_HAND.includes(String(r.status))) ? ref : null;
}

/** What delivery needs from the hire: lines, owners, values and whether payment was verified. */
export class SupabaseDeliveryBookings implements DeliveryBookingPort {
  constructor(private db: Admin = createAdminClient()) {}

  async getGroup(bookingGroupId: string): Promise<DeliveryBookingView | null> {
    const [lines, intent] = await Promise.all([
      this.db
        .from('equipment_bookings')
        .select('id, user_id, rental_id, owner_id, status, quantity, start_date, end_date, unit_replacement_value_cents, payfast_payment_id, smart_rentals(serial_number, replacement_value, owner_id)')
        .eq('checkout_group_id', bookingGroupId)
        .order('created_at'),
      this.db.from('rental_payment_intents').select('reference, state').eq('checkout_group_id', bookingGroupId).maybeSingle(),
    ]);
    if (lines.error) throw dbError('delivery bookings', lines.error);
    const rows = (lines.data ?? []) as Row[];
    if (rows.length === 0) return null;
    const pi = intent.error ? null : (intent.data as Row | null);
    return {
      bookingGroupId,
      renterId: String(rows[0].user_id),
      paymentVerified: pi?.state === 'paid',
      paymentReference: str(pi?.reference),
      manualPaymentReference: manualPaymentOf(rows),
      lines: rows.map((r) => {
        const rental = (Array.isArray(r.smart_rentals) ? r.smart_rentals[0] : r.smart_rentals) as Row | null;
        const unit =
          r.unit_replacement_value_cents !== null && r.unit_replacement_value_cents !== undefined
            ? num(r.unit_replacement_value_cents)
            : rental?.replacement_value !== null && rental?.replacement_value !== undefined
              ? Math.round(num(rental.replacement_value) * 100)
              : // Unknown value: treat as above the collection threshold (fail closed).
                RENTAL_POLICY.highValueCollectionThresholdCents + 1;
        return {
          bookingId: String(r.id),
          rentalId: String(r.rental_id),
          ownerId: str(r.owner_id) ?? str(rental?.owner_id),
          serialNumber: str(rental?.serial_number),
          status: r.status as BookingStatus,
          unitReplacementValueCents: unit,
          quantity: Math.max(1, num(r.quantity)),
          startDate: String(r.start_date),
          endDate: String(r.end_date),
          driverLabel: DELIVERY_POLICY.driverLabel,
          weightGrams: null,
          containsLithium: DELIVERY_POLICY.assumeLithiumBatteries,
        };
      }),
    };
  }
}

/** The same renter facts as checkout eligibility (lib/rental/eligibility-server.ts). */
export class SupabaseRenterTrust implements RenterTrustPort {
  constructor(private db: Admin = createAdminClient()) {}
  async getTrustInputs(renterId: string, opts: { excludeGroupId?: string | null } = {}): ReturnType<RenterTrustPort['getTrustInputs']> {
    const { data, error } = await this.db.auth.admin.getUserById(renterId);
    if (error || !data?.user) throw new Error('could not load renter');
    const { facts, holdings } = await loadRenterFacts(this.db, { id: renterId, email_confirmed_at: data.user.email_confirmed_at ?? null }, new Date(), {
      excludeGroupId: opts.excludeGroupId ?? undefined,
    });
    return { facts, holdings };
  }
}
