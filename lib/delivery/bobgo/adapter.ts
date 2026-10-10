import type { ProviderCallResult } from '@/lib/core/ports';
import type {
  CreateDeliveryRequest,
  DeliveryPoint,
  DeliveryPort,
  DeliveryQuoteRequest,
  ParcelItem,
  ProviderDelivery,
  ProviderQuote,
  ServiceabilityRequest,
  ServiceabilityResult,
  TrackingResult,
} from '@/lib/core/delivery/port';
import {
  CircuitBreaker,
  asIsoTime,
  asObject,
  asString,
  breakerFor,
  deliveryHttp,
  notConfigured,
  validCoords,
  type FetchLike,
  type HttpResult,
  type Json,
} from '../http';
import { BOBGO_CAPABILITIES, BOBGO_CONTRACT, BOBGO_PROVIDER_ID, mapBobgoStatus } from './api-contract';

/**
 * Bob Go adapter (courier aggregator: The Courier Guy, RAM, Skynet, Fastway,
 * WumDrop, Pargo). Server only. Built against an UNVERIFIED contract
 * (api-contract.ts); every provider detail comes from there.
 *
 * - Auth: the merchant API key (header form assumed).
 * - Quote: the rates endpoint; only service levels on the approved list
 *   (empty until verified) are considered, so the adapter never books a
 *   courier that breaks custody just because it is cheapest.
 * - Create: POST /orders with our merchant reference. A refusal (4xx other
 *   than 401/403) is checked by a lookup before it is called a refusal: if an
 *   order under our reference exists (an earlier attempt got through), that
 *   order is returned. No second courier.
 * - findByMerchantReference: an ASSUMED lookup. An order that echoes our
 *   reference exactly is returned; an empty or unreadable answer is
 *   "unknown", never "none" (the core then asks a person, never re-creates).
 * - No webhooks: status comes from reading the order (webhook.ts is closed).
 * - Nothing here retries a create; every call has a timeout and goes through
 *   a per-provider circuit breaker (lib/delivery/http.ts).
 */

type Env = Record<string, string | undefined>;
type Mode = 'sandbox' | 'production';
const C = BOBGO_CONTRACT;
const F = C.fields;

export interface BobgoConfig {
  mode: Mode;
  apiKey: string | null;
  /** Service levels we may book. Defaults to the contract's list (empty until verified). */
  approvedServiceLevelCodes?: readonly string[];
  /** Whether lithium batteries may be sent. Defaults to the contract (false until verified). */
  lithiumAccepted?: boolean;
  fetchImpl?: FetchLike;
  now?: () => Date;
  breaker?: CircuitBreaker;
  timeoutsMs?: Partial<Record<keyof typeof BOBGO_CONTRACT.timeoutsMs, number>>;
}

/** Key per mode: BOBGO_SANDBOX_API_KEY (sandbox) or BOBGO_API_KEY (production). Never the other mode's key. */
export function bobgoConfigFromEnv(env: Env, mode: Mode): BobgoConfig {
  const key = (mode === 'sandbox' ? env.BOBGO_SANDBOX_API_KEY : env.BOBGO_API_KEY)?.trim() || null;
  return { mode, apiKey: key };
}

/** Rands (number or decimal string) to integer cents, without float drift. Null if not a price. */
export function bobgoRandsToCents(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    const c = Math.round(v * 100);
    return Number.isSafeInteger(c) ? c : null;
  }
  if (typeof v === 'string') {
    const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(v);
    if (!m) return null;
    const c = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
    return Number.isSafeInteger(c) ? c : null;
  }
  return null;
}

const unknownMsg = (message: string): { ok: false; kind: 'unknown'; message: string } => ({ ok: false, kind: 'unknown', message });
const refused = (message: string): { ok: false; kind: 'rejected'; message: string } => ({ ok: false, kind: 'rejected', message });

/** Reads an order defensively (field names assumed). Null when there is no order id. */
export function bobgoDelivery(raw: unknown, fallbackRef: string | null): ProviderDelivery | null {
  const top = asObject(raw);
  const wrapped = F.orderWrappers.map((k) => asObject(top?.[k])).find((x) => x !== null) ?? null;
  const o = wrapped ?? top;
  const id = asString(o?.[F.orderId]);
  if (!o || !id) return null;
  const shipments = o[F.shipments];
  const shipment = Array.isArray(shipments) ? asObject(shipments[0]) : null;
  // The courier-side status is the more specific one; the order's own status otherwise.
  const shipmentState = mapBobgoStatus(shipment?.[F.shipmentStatus]);
  const state = shipmentState !== 'unknown' ? shipmentState : mapBobgoStatus(o[F.orderStatus]);
  return {
    providerReference: id,
    merchantReference: asString(o[F.merchantReference]) ?? fallbackRef ?? '',
    state,
    stateAt: asIsoTime(o[F.updatedAt]) ?? asIsoTime(o[F.createdAt]),
    trackingUrl: asString(shipment?.[F.shipmentTrackingUrl]),
    // Driver names are not in the contract: none is stored.
    courierName: null,
    // Proof of delivery through the API is unknown: none is claimed.
    proof: [],
  };
}

function address(p: Pick<DeliveryPoint, 'lat' | 'lng' | 'suburb' | 'city' | 'postalCode' | 'province'> & { formattedAddress?: string }): Json {
  const a = F.address;
  return {
    ...(p.formattedAddress ? { [a.street]: p.formattedAddress } : {}),
    [a.suburb]: p.suburb ?? '',
    [a.city]: p.city ?? '',
    [a.province]: p.province ?? '',
    [a.postalCode]: p.postalCode ?? '',
    [a.country]: C.countryCode,
    [a.lat]: p.lat,
    [a.lng]: p.lng,
  };
}

/** Parcels: a generic label, quantity and weight only. Never a brand, model or value. */
function parcels(items: readonly ParcelItem[]): Json[] {
  const f = F.parcel;
  return items.map((i) => ({
    [f.description]: i.driverLabel,
    [f.quantity]: Math.max(1, Math.floor(i.quantity ?? 1)),
    ...(i.weightGrams ? { [f.weightKg]: Math.round(i.weightGrams) / 1000 } : {}),
  }));
}

type Lookup = { kind: 'found'; delivery: ProviderDelivery } | { kind: 'no_match'; message: string } | { kind: 'failed'; result: ProviderCallResult<never> };

export function createBobgoAdapter(config: BobgoConfig): DeliveryPort {
  const now = config.now ?? (() => new Date());
  const breaker = config.breaker ?? breakerFor(`${BOBGO_PROVIDER_ID}:${config.mode}`);
  const timeouts = { ...C.timeoutsMs, ...config.timeoutsMs };
  const base = C.baseUrl[config.mode];
  const approved = new Set(config.approvedServiceLevelCodes ?? C.approvedServiceLevelCodes);
  const lithiumAccepted = config.lithiumAccepted ?? C.lithiumAccepted;

  async function api(method: 'GET' | 'POST' | 'PATCH', path: string, body: Json | undefined, timeoutMs: number): Promise<HttpResult> {
    if (!config.apiKey) return notConfigured('Bob Go');
    return deliveryHttp({
      method,
      url: `${base}${path}`,
      headers: { [C.auth.header]: C.auth.value(config.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
      fetchImpl: config.fetchImpl,
      breaker,
    });
  }

  /** Local refusals that need no call: lithium, and no approved service level. */
  function localRefusal(items: readonly ParcelItem[]): string | null {
    if (!lithiumAccepted && items.some((i) => i.containsLithium)) return 'lithium_not_confirmed';
    if (approved.size === 0) return 'no_approved_service_level';
    return null;
  }

  async function lookup(merchantReference: string): Promise<Lookup> {
    const res = await api('GET', C.paths.findByReference(merchantReference), undefined, timeouts.read);
    if (!res.ok) {
      // Not sent (not configured): pass the refusal through unchanged.
      if (res.kind === 'rejected' && res.status === undefined) return { kind: 'failed', result: res };
      // The lookup itself is assumed: no refusal (404 included) proves "none".
      return { kind: 'failed', result: res.kind === 'rejected' ? unknownMsg(`Bob Go lookup by reference failed: ${res.message}`) : res };
    }
    const top = asObject(res.value.body);
    const list = Array.isArray(res.value.body) ? res.value.body : Array.isArray(top?.[F.orderList]) ? (top?.[F.orderList] as unknown[]) : top ? [top] : [];
    // Only an order that echoes our reference EXACTLY is ours (a filter Bob Go
    // ignores would otherwise hand us someone else's order).
    const mine = list.map((x) => bobgoDelivery(x, null)).filter((d): d is ProviderDelivery => !!d && d.merchantReference === merchantReference);
    if (mine.length === 1) return { kind: 'found', delivery: mine[0] };
    if (mine.length > 1) return { kind: 'failed', result: unknownMsg('Bob Go returned more than one order under our reference: check the Bob Go dashboard') };
    return { kind: 'no_match', message: 'Bob Go lookup returned no order under our reference (the lookup is unverified, so this is not proof there is none)' };
  }

  async function findByMerchantReference(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
    const l = await lookup(merchantReference);
    if (l.kind === 'found') return { ok: true, value: l.delivery };
    if (l.kind === 'failed') return l.result;
    // Never "none": that would let the core book a second courier.
    return unknownMsg(`${l.message}: check the Bob Go dashboard before any retry`);
  }

  async function readOrder(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>> {
    const res = await api('GET', C.paths.getOrder(providerReference), undefined, timeouts.read);
    if (!res.ok) return res;
    const d = bobgoDelivery(res.value.body, null);
    return d ? { ok: true, value: d } : unknownMsg('Bob Go returned an unreadable order');
  }

  return {
    providerId: BOBGO_PROVIDER_ID,
    kind: 'courier',
    mode: config.mode,
    capabilities: BOBGO_CAPABILITIES,

    /** No serviceability endpoint is known: local checks only; the rates are the real answer. */
    async checkServiceability(r: ServiceabilityRequest): Promise<ProviderCallResult<ServiceabilityResult>> {
      if (!config.apiKey) return notConfigured('Bob Go');
      if (!validCoords(r.from) || !validCoords(r.to)) return { ok: true, value: { serviceable: false, reason: 'invalid_location' } };
      const local = localRefusal(r.items);
      if (local) return { ok: true, value: { serviceable: false, reason: local === 'lithium_not_confirmed' ? 'item_refused' : local } };
      return { ok: true, value: { serviceable: true, reason: null } };
    },

    async quote(r: DeliveryQuoteRequest): Promise<ProviderCallResult<ProviderQuote>> {
      if (!config.apiKey) return notConfigured('Bob Go');
      if (!validCoords(r.from) || !validCoords(r.to)) return refused('invalid coordinates');
      const local = localRefusal(r.items);
      if (local) return refused(`Bob Go: ${local}; nothing was sent`);
      const res = await api(
        'POST',
        C.paths.rates,
        { [F.collectionAddress]: address(r.from), [F.deliveryAddress]: address(r.to), [F.parcels]: parcels(r.items) },
        timeouts.read,
      );
      if (!res.ok) return res;
      const top = asObject(res.value.body);
      const rates = Array.isArray(top?.[F.rates]) ? (top?.[F.rates] as unknown[]) : Array.isArray(res.value.body) ? (res.value.body as unknown[]) : null;
      if (!rates) return unknownMsg('Bob Go rates response had no list of rates');
      let best: { code: string; cents: number } | null = null;
      for (const raw of rates) {
        const rate = asObject(raw);
        const code = asString(rate?.[F.rateServiceLevelCode]);
        if (!rate || !code || !approved.has(code)) continue;
        const currency = asString(rate[F.rateCurrency]);
        if (currency && currency.toUpperCase() !== C.currency) continue;
        const cents = bobgoRandsToCents(rate[F.ratePrice]);
        if (cents === null) continue;
        // Among APPROVED service levels only, the cheapest.
        if (!best || cents < best.cents) best = { code, cents };
      }
      // Bob Go answered, but with nothing we may book: a definite "not for us".
      if (!best) return refused('Bob Go offered no approved service level for this parcel');
      const expiresAt = new Date(now().getTime() + C.quoteValidityMinutes * 60_000).toISOString();
      // The chosen service level travels as the quote reference so create books exactly it.
      return { ok: true, value: { providerId: BOBGO_PROVIDER_ID, providerQuoteRef: best.code, providerCostCents: best.cents, expiresAt, window: r.window } };
    },

    async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
      if (!config.apiKey) return notConfigured('Bob Go');
      const code = r.quote.providerQuoteRef;
      // Never book a service level we have not approved (custody), whatever the quote says.
      if (!code || !approved.has(code)) return refused('Bob Go: the quote is not for an approved service level; nothing was sent');
      const local = localRefusal(r.items);
      if (local) return refused(`Bob Go: ${local}; nothing was sent`);
      const contact = (p: DeliveryPoint): Json => ({ [F.contact.name]: p.contactName, [F.contact.phone]: p.contactPhone });
      const body: Json = {
        // Our stable reference: the same on every attempt of the same leg.
        [F.merchantReference]: r.merchantReference,
        [F.serviceLevelCode]: code,
        [F.collectionAddress]: address(r.from),
        [F.collectionContact]: contact(r.from),
        [F.deliveryAddress]: address(r.to),
        [F.deliveryContact]: contact(r.to),
        [F.parcels]: parcels(r.items),
        ...(r.from.instructions ? { [F.collectionInstructions]: r.from.instructions } : {}),
        ...(r.to.instructions ? { [F.deliveryInstructions]: r.to.instructions } : {}),
        // Declared value is not sent: declaredValueSupport is not verified, and
        // values never travel to a courier on an unverified field.
      };
      const res = await api('POST', C.paths.createOrder, body, timeouts.create);
      if (res.ok) {
        const d = bobgoDelivery(res.value.body, r.merchantReference);
        // 2xx without an id: something may exist. The core reconciles by reference.
        if (!d) return unknownMsg('Bob Go accepted the request but returned no order id');
        return { ok: true, value: { ...d, merchantReference: r.merchantReference } };
      }
      if (res.kind === 'unknown') return res;
      // Not sent, or credentials refused: nothing was created, and a lookup would be refused too.
      if (res.status === undefined || res.status === 401 || res.status === 403) return res;
      // Any other refusal may be "duplicate reference": look before calling it a refusal.
      const l = await lookup(r.merchantReference);
      if (l.kind === 'found') return { ok: true, value: { ...l.delivery, merchantReference: r.merchantReference } };
      if (l.kind === 'failed') return unknownMsg(`create refused (${res.message}) and the lookup by reference did not answer`);
      // Bob Go refused THIS request and its lookup shows no order of ours: the refusal stands.
      return res;
    },

    findByMerchantReference,

    getDelivery: readOrder,

    async cancelDelivery(providerReference: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
      // [assumed] PATCH on the order (api-contract.ts cancelOrder / cancelBody).
      const res = await api('PATCH', C.paths.cancelOrder(providerReference), { ...C.cancelBody }, timeouts.cancel);
      if (!res.ok) return res;
      // Only an answer that says "cancelled" is a cancellation. An empty 2xx or
      // any other status proves nothing either way: staff check (no refund on a guess).
      const d = bobgoDelivery(res.value.body, null);
      if (!d || d.state !== 'cancelled') return unknownMsg('Bob Go answered the cancel without a cancelled status');
      // Cancellation fees are unknown; any fee is picked up from the invoice (reconcileDelivery).
      return { ok: true, value: { cancelled: true, feeCents: 0 } };
    },

    async getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>> {
      const d = await readOrder(providerReference);
      if (!d.ok) return d;
      // No verified ETA or location: never invented.
      return { ok: true, value: { state: d.value.state, etaAt: null, location: null, trackingUrl: d.value.trackingUrl } };
    },
  };
}
