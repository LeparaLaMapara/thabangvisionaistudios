import type { ProviderDelivery, ProviderDeliveryState } from '@/lib/core/delivery/port';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import { recordProviderEvent, type ProviderEventOutcome } from '@/lib/core/delivery/use-cases';

/**
 * Durable inbox for delivery-provider webhooks (spec Phase 4 §4.15–4.16),
 * modelled on the payment inbox (lib/rental/inbox.ts):
 *
 *   verify signature → parse → STORE (minimal payload, unique dedupe key)
 *     → acknowledge → process → mark processed / failed with back-off → dead
 *
 * The provider's payload is kept apart from our canonical delivery state:
 * this table holds what the provider said; delivery_shipments/delivery_events
 * hold what we concluded. Nothing unverified is ever stored (D11), and a
 * replayed webhook is stored once and applied once (D12).
 *
 * Provider specifics (signature scheme, payload shape) live in each courier
 * adapter's DeliveryWebhookParser. The route only wires request → here.
 */

type Json = Record<string, unknown>;

export interface ParsedDeliveryEvent {
  /** The provider's own event id, when it sends one. */
  eventId: string | null;
  merchantReference: string | null;
  providerReference: string | null;
  state: ProviderDeliveryState;
  stateAt: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  proof: ProviderDelivery['proof'];
  /** Minimal copy to store: ids, state, timestamps. No addresses, names, phone numbers or photos. */
  minimal: Json;
}

export interface DeliveryWebhookParser {
  readonly providerId: string;
  /** Constant-time check of the provider's signature over the RAW body. */
  verify(rawBody: string, headers: Readonly<Record<string, string>>): boolean | Promise<boolean>;
  /** Null when the payload is not a delivery status event we use. */
  parse(rawBody: string): ParsedDeliveryEvent | null;
}

export interface StoredDeliveryEvent {
  id: string;
  providerId: string;
  payload: Json;
  retryCount: number;
}

export interface DeliveryInboxStore {
  /** Insert with signature_verified = true. Duplicate dedupe key → not stored. Throws if the database is down. */
  store(row: { providerId: string; eventId: string | null; dedupeKey: string; eventType: string; merchantReference: string | null; providerReference: string | null; payload: Json }): Promise<{ stored: true; id: string } | { stored: false; duplicate: true }>;
  markDone(id: string, status: 'processed' | 'ignored', outcome: string): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: string): Promise<void>;
  /** Claim due rows (SKIP LOCKED); rows past maxRetries become dead letters. */
  claim(limit: number, maxRetries: number): Promise<StoredDeliveryEvent[]>;
}

export function deliveryEventDedupeKey(providerId: string, e: Pick<ParsedDeliveryEvent, 'eventId' | 'merchantReference' | 'providerReference' | 'state' | 'stateAt'>): string {
  if (e.eventId) return `${providerId}:event:${e.eventId}`;
  return `${providerId}:${e.providerReference ?? e.merchantReference ?? 'none'}:${e.state}:${e.stateAt ?? ''}`;
}

/** The stored payload is the parsed event itself (already minimal), so a retry needs no re-parse of a raw body. */
function toStored(p: ParsedDeliveryEvent): Json {
  return {
    eventId: p.eventId,
    merchantReference: p.merchantReference,
    providerReference: p.providerReference,
    state: p.state,
    stateAt: p.stateAt,
    trackingUrl: p.trackingUrl,
    courierName: p.courierName,
    proof: p.proof,
    minimal: p.minimal,
  };
}

function fromStored(j: Json): ParsedDeliveryEvent {
  return {
    eventId: (j.eventId as string | null) ?? null,
    merchantReference: (j.merchantReference as string | null) ?? null,
    providerReference: (j.providerReference as string | null) ?? null,
    state: j.state as ProviderDeliveryState,
    stateAt: (j.stateAt as string | null) ?? null,
    trackingUrl: (j.trackingUrl as string | null) ?? null,
    courierName: (j.courierName as string | null) ?? null,
    proof: Array.isArray(j.proof) ? (j.proof as ProviderDelivery['proof']) : [],
    minimal: (j.minimal as Json) ?? {},
  };
}

/** Outcomes that will never succeed on retry: stored as ignored. */
const TERMINAL_IGNORED = new Set<ProviderEventOutcome>(['unknown_shipment', 'provider_mismatch', 'duplicate', 'same_state', 'stale', 'not_allowed', 'needs_reconcile']);

export type InboxDeps = { store: DeliveryInboxStore; useCases: Pick<DeliveryDeps, 'repo' | 'clock' | 'newId'> };

/** Process one stored event. Never throws. */
export async function processStoredDeliveryEvent(id: string, providerId: string, parsed: ParsedDeliveryEvent, retryCount: number, deps: InboxDeps): Promise<ProviderEventOutcome | 'failed'> {
  try {
    const outcome = await recordProviderEvent(
      {
        providerId,
        // Stored only after verification (the table refuses anything else).
        verified: true,
        dedupeKey: deliveryEventDedupeKey(providerId, parsed),
        merchantReference: parsed.merchantReference,
        providerReference: parsed.providerReference,
        state: parsed.state,
        stateAt: parsed.stateAt,
        proof: parsed.proof,
        trackingUrl: parsed.trackingUrl,
        courierName: parsed.courierName,
        source: 'provider_webhook',
      },
      deps.useCases,
    );
    if (outcome === 'conflict') throw new Error('shipment changed concurrently');
    await deps.store.markDone(id, TERMINAL_IGNORED.has(outcome) ? 'ignored' : 'processed', outcome);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
    // Back off 1, 2, 4 … minutes, capped at an hour.
    const delayMs = Math.min(60, 2 ** retryCount) * 60_000;
    try {
      await deps.store.markFailed(id, message, new Date(deps.useCases.clock.now().getTime() + delayMs).toISOString());
    } catch {
      // The claim times out and the row is retried anyway.
    }
    return 'failed';
  }
}

export type WebhookReceipt = { status: 200 | 400 | 401 | 500; outcome: string };

/**
 * Handle one webhook request. 401 when the signature does not verify
 * (nothing stored, nothing applied: D11). 200 once the event is stored, or
 * when it is a duplicate (D12). 500 only when it could not be stored, so the
 * provider retries.
 */
export async function receiveDeliveryWebhook(p: { rawBody: string; headers: Readonly<Record<string, string>>; parser: DeliveryWebhookParser; deps: InboxDeps }): Promise<WebhookReceipt> {
  let verified = false;
  try {
    verified = await p.parser.verify(p.rawBody, p.headers);
  } catch {
    verified = false;
  }
  if (!verified) return { status: 401, outcome: 'invalid_signature' };
  const parsed = p.parser.parse(p.rawBody);
  if (!parsed) return { status: 200, outcome: 'ignored' };
  let stored: Awaited<ReturnType<DeliveryInboxStore['store']>>;
  try {
    stored = await p.deps.store.store({
      providerId: p.parser.providerId,
      eventId: parsed.eventId,
      dedupeKey: deliveryEventDedupeKey(p.parser.providerId, parsed),
      eventType: parsed.state,
      merchantReference: parsed.merchantReference,
      providerReference: parsed.providerReference,
      payload: toStored(parsed),
    });
  } catch {
    return { status: 500, outcome: 'store_failed' };
  }
  if (!stored.stored) return { status: 200, outcome: 'duplicate' };
  // Acknowledged once stored; processing failures are retried by drainDeliveryInbox.
  const outcome = await processStoredDeliveryEvent(stored.id, p.parser.providerId, parsed, 0, p.deps);
  return { status: 200, outcome };
}

/** Retry stored events that are due (called by a daily job or "run now" in the admin console). */
export async function drainDeliveryInbox(deps: InboxDeps, limit = 50, maxRetries = 8): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const rows = await deps.store.claim(limit, maxRetries);
  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    const outcome = await processStoredDeliveryEvent(row.id, row.providerId, fromStored(row.payload), row.retryCount, deps);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { claimed: rows.length, outcomes };
}

/** In-memory inbox (tests). Mirrors the unique dedupe key and the dead-letter rule. */
export class InMemoryDeliveryInbox implements DeliveryInboxStore {
  rows: (StoredDeliveryEvent & { dedupeKey: string; status: string; outcome: string | null; nextAttemptAt: string; lastError: string | null })[] = [];
  constructor(private now: () => Date = () => new Date()) {}
  async store(row: Parameters<DeliveryInboxStore['store']>[0]): Promise<{ stored: true; id: string } | { stored: false; duplicate: true }> {
    if (this.rows.some((r) => r.dedupeKey === row.dedupeKey)) return { stored: false, duplicate: true };
    const id = `evt-${this.rows.length + 1}`;
    this.rows.push({ id, providerId: row.providerId, payload: row.payload, retryCount: 0, dedupeKey: row.dedupeKey, status: 'received', outcome: null, nextAttemptAt: this.now().toISOString(), lastError: null });
    return { stored: true, id };
  }
  async markDone(id: string, status: 'processed' | 'ignored', outcome: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { status, outcome, lastError: null });
  }
  async markFailed(id: string, error: string, nextAttemptAt: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { status: 'failed', lastError: error, nextAttemptAt });
  }
  async claim(limit: number, maxRetries: number): Promise<StoredDeliveryEvent[]> {
    for (const r of this.rows) if ((r.status === 'failed' || r.status === 'processing') && r.retryCount >= maxRetries) r.status = 'dead';
    const now = this.now().toISOString();
    const due = this.rows.filter((r) => ['received', 'failed', 'processing'].includes(r.status) && r.nextAttemptAt <= now).slice(0, limit);
    for (const r of due) {
      r.status = 'processing';
      r.retryCount += 1;
      r.nextAttemptAt = new Date(this.now().getTime() + 10 * 60_000).toISOString();
    }
    return due.map((r) => ({ id: r.id, providerId: r.providerId, payload: r.payload, retryCount: r.retryCount }));
  }
}
