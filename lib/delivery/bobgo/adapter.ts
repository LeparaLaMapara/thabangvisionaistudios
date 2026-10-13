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
import {
  BOBGO_CAPABILITIES,
  BOBGO_CONTRACT,
  BOBGO_PROVIDER_ID,
  bobgoServiceLevelKey,
  mapBobgoStatus,
  parseBobgoServiceLevelKey,
} from './api-contract';

/**
 * Bob Go adapter (courier aggregator: The Courier Guy, RAM, Skynet, Fastway,
 * WumDrop, Pargo). Server only. Every provider detail comes from
 * api-contract.ts (checked against the Bob Go sandbox).
 *
 * - Auth: the merchant API key as a bearer token.
 * - Quote: POST /rates; only couriers and service levels on the approved list
 *   (empty until approved) are considered, so the adapter never books a
 *   courier that breaks custody just because it is cheapest.
 * - Create: POST /shipments with our reference as the custom tracking
 *   reference. Bob Go does NOT refuse a duplicate reference (two creates = two
 *   couriers), so a create is never retried here. A refusal (4xx other than
 *   401/403) is checked by a lookup before it is called a refusal: if a
 *   shipment under our reference exists, that shipment is returned.
 * - findByMerchantReference: GET /shipments by our reference. A shipment that
 *   echoes our reference exactly is returned; an empty answer is "unknown",
 *   never "none" (the core then asks a person, never re-creates).
 * - No webhooks: status comes from reading the shipment (webhook.ts is closed).
 * - Every call has a timeout and goes through a per-provider circuit breaker
 *   (lib/delivery/http.ts).
 */

type Env = Record<string, string | undefined>;
type Mode = 'sandbox' | 'production';
const C = BOBGO_CONTRACT;
const F = C.fields;

export interface BobgoConfig {
  mode: Mode;
  apiKey: string | null;
  /** `provider_slug:service_level_code` entries we may book. Defaults to the contract's list (empty until approved). */
  approvedServiceLevels?: readonly string[];
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

/** Reads a shipment defensively. Null when there is no Bob Go tracking reference. */
export function bobgoDelivery(raw: unknown, fallbackRef: string | null): ProviderDelivery | null {
  const s = asObject(raw);
  const id = asString(s?.[F.shipmentReference]);
  if (!s || !id) return null;
  return {
    providerReference: id,
    merchantReference: asString(s[F.merchantReference]) ?? fallbackRef ?? '',
    state: mapBobgoStatus(s[F.shipmentStatus]),
    stateAt: asIsoTime(s[F.updatedAt]) ?? asIsoTime(s[F.createdAt]),
    // The shipment carries no tracking link.
    trackingUrl: null,
    // Driver names are not in the contract: none is stored.
    courierName: null,
    // Proof of delivery is not claimed (BOBGO_CAPABILITIES.proofOfDelivery is false).
    proof: [],
  };
}

/** The shipments in a list answer (`{ shipments: [...] }` or a bare array). */
function shipmentList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const list = asObject(body)?.[F.shipmentList];
  return Array.isArray(list) ? list : [];
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

/**
 * Parcels: one per unit carried, with a generic label and the unit's weight.
 * Never a brand, model or value. Bob Go parcels have no quantity field.
 */
function parcels(items: readonly ParcelItem[]): Json[] {
  const f = F.parcel;
  return items.flatMap((i) => {
    const units = Math.max(1, Math.floor(i.quantity ?? 1));
    const parcel: Json = { [f.description]: i.driverLabel, ...(i.weightGrams ? { [f.weightKg]: Math.round(i.weightGrams) / 1000 } : {}) };
    return Array.from({ length: units }, () => ({ ...parcel }));
  });
}

type Lookup = { kind: 'found'; delivery: ProviderDelivery } | { kind: 'no_match'; message: string } | { kind: 'failed'; result: ProviderCallResult<never> };

export function createBobgoAdapter(config: BobgoConfig): DeliveryPort {
  const now = config.now ?? (() => new Date());
  const breaker = config.breaker ?? breakerFor(`${BOBGO_PROVIDER_ID}:${config.mode}`);
  const timeouts = { ...C.timeoutsMs, ...config.timeoutsMs };
  const base = C.baseUrl[config.mode];
  const approved = new Set(config.approvedServiceLevels ?? C.approvedServiceLevels);
  const lithiumAccepted = config.lithiumAccepted ?? C.lithiumAccepted;

  async function api(method: 'GET' | 'POST', path: string, body: Json | undefined, timeoutMs: number): Promise<HttpResult> {
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
    const res = await api('GET', C.paths.shipmentsByReference(merchantReference), undefined, timeouts.read);
    if (!res.ok) {
      // Not sent (not configured): pass the refusal through unchanged.
      if (res.kind === 'rejected' && res.status === undefined) return { kind: 'failed', result: res };
      // No refusal (404 included) proves "none".
      return { kind: 'failed', result: res.kind === 'rejected' ? unknownMsg(`Bob Go lookup by reference failed: ${res.message}`) : res };
    }
    // Only a shipment that echoes our reference EXACTLY is ours (the filter
    // also matches Bob Go's own references, and one it ignored would hand us
    // someone else's shipment).
    const mine = shipmentList(res.value.body)
      .map((x) => bobgoDelivery(x, null))
      .filter((d): d is ProviderDelivery => !!d && d.merchantReference === merchantReference);
    if (mine.length === 1) return { kind: 'found', delivery: mine[0] };
    if (mine.length > 1) {
      // Bob Go books duplicates. If exactly one is still live, that is the
      // courier on the way; the cancelled ones book nobody.
      const live = mine.filter((d) => d.state !== 'cancelled');
      if (live.length === 1) return { kind: 'found', delivery: live[0] };
      return { kind: 'failed', result: unknownMsg(`Bob Go has ${mine.length} shipments under our reference (${live.length} not cancelled): check the Bob Go dashboard`) };
    }
    return { kind: 'no_match', message: 'Bob Go lookup returned no shipment under our reference' };
  }

  async function findByMerchantReference(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
    const l = await lookup(merchantReference);
    if (l.kind === 'found') return { ok: true, value: l.delivery };
    if (l.kind === 'failed') return l.result;
    // Never "none": that would let the core book a second courier.
    return unknownMsg(`${l.message}: check the Bob Go dashboard before any retry`);
  }

  async function readShipment(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>> {
    const res = await api('GET', C.paths.shipmentsByReference(providerReference), undefined, timeouts.read);
    if (!res.ok) return res;
    const list = shipmentList(res.value.body);
    const d = list.map((x) => bobgoDelivery(x, null)).find((x) => x?.providerReference === providerReference);
    if (d) return { ok: true, value: d };
    // A clean, empty answer for Bob Go's own reference: Bob Go has no such shipment.
    if (asObject(res.value.body) && list.length === 0) return refused(`Bob Go has no shipment ${providerReference}`);
    return unknownMsg('Bob Go returned an unreadable shipment');
  }

  return {
    providerId: BOBGO_PROVIDER_ID,
    kind: 'courier',
    mode: config.mode,
    capabilities: BOBGO_CAPABILITIES,

    /** No serviceability endpoint: local checks only; the rates are the real answer. */
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
        { [F.collectionAddress]: address(r.from), [F.deliveryAddress]: address(r.to), [F.parcels]: parcels(r.items), [F.timeout]: C.courierTimeoutMs.rates },
        timeouts.quote,
      );
      if (!res.ok) return res;
      const providers = asObject(res.value.body)?.[F.rateProviders];
      if (!Array.isArray(providers)) return unknownMsg('Bob Go rates response had no list of courier rates');
      let best: { key: string; cents: number } | null = null;
      for (const rawProvider of providers) {
        const provider = asObject(rawProvider);
        const slug = asString(provider?.[F.rateProviderSlug]);
        const responses = provider?.[F.rateResponses];
        // A courier that did not answer in time ("pending") or failed offers nothing.
        if (!provider || !slug || provider[F.rateProviderStatus] !== C.successWord || !Array.isArray(responses)) continue;
        for (const rawRate of responses) {
          const rate = asObject(rawRate);
          const code = asString(rate?.[F.rateServiceLevelCode]);
          if (!rate || !code || rate[F.rateStatus] !== C.successWord) continue;
          const key = bobgoServiceLevelKey(slug, code);
          if (!approved.has(key)) continue;
          const cents = bobgoRandsToCents(rate[F.ratePrice]);
          if (cents === null || cents === 0) continue;
          // Among APPROVED service levels only, the cheapest.
          if (!best || cents < best.cents) best = { key, cents };
        }
      }
      // Bob Go answered, but with nothing we may book: a definite "not for us".
      if (!best) return refused('Bob Go offered no approved service level for this parcel');
      const expiresAt = new Date(now().getTime() + C.quoteValidityMinutes * 60_000).toISOString();
      // The chosen courier and service level travel as the quote reference so create books exactly them.
      return { ok: true, value: { providerId: BOBGO_PROVIDER_ID, providerQuoteRef: best.key, providerCostCents: best.cents, expiresAt, window: r.window } };
    },

    async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
      if (!config.apiKey) return notConfigured('Bob Go');
      const level = parseBobgoServiceLevelKey(r.quote.providerQuoteRef);
      // Never book a service level we have not approved (custody), whatever the quote says.
      if (!level || !approved.has(r.quote.providerQuoteRef ?? '')) return refused('Bob Go: the quote is not for an approved service level; nothing was sent');
      const local = localRefusal(r.items);
      if (local) return refused(`Bob Go: ${local}; nothing was sent`);
      const body: Json = {
        // Our stable reference: the same on every attempt of the same leg.
        [F.merchantReference]: r.merchantReference,
        [F.providerSlug]: level.providerSlug,
        [F.serviceLevelCode]: level.serviceLevelCode,
        [F.collectionAddress]: address(r.from),
        [F.collectionContactName]: r.from.contactName,
        [F.collectionContactPhone]: r.from.contactPhone,
        [F.deliveryAddress]: address(r.to),
        [F.deliveryContactName]: r.to.contactName,
        [F.deliveryContactPhone]: r.to.contactPhone,
        [F.parcels]: parcels(r.items),
        [F.timeout]: C.courierTimeoutMs.create,
        ...(r.from.instructions ? { [F.collectionInstructions]: r.from.instructions } : {}),
        ...(r.to.instructions ? { [F.deliveryInstructions]: r.to.instructions } : {}),
        // Declared value is not sent: declaredValueSupport is not verified, and
        // values never travel to a courier on an unverified field.
      };
      const res = await api('POST', C.paths.createShipment, body, timeouts.create);
      if (res.ok) {
        const shipment = asObject(res.value.body);
        const d = bobgoDelivery(shipment, r.merchantReference);
        // 2xx without a reference: something may exist. The core reconciles by reference.
        if (!shipment || !d) return unknownMsg('Bob Go accepted the request but returned no tracking reference');
        // Recorded but not handed to the courier: there may or may not be a booking. Staff check.
        const submission = asString(shipment[F.submissionStatus]);
        if (submission !== C.successWord) {
          return unknownMsg(`Bob Go recorded shipment ${d.providerReference} but did not submit it to the courier (${submission ?? 'no submission status'}): check the Bob Go dashboard`);
        }
        return { ok: true, value: { ...d, merchantReference: r.merchantReference } };
      }
      if (res.kind === 'unknown') return res;
      // Not sent, or credentials refused: nothing was created, and a lookup would be refused too.
      if (res.status === undefined || res.status === 401 || res.status === 403) return res;
      // Any other refusal: look before calling it a refusal (an earlier attempt may have got through).
      const l = await lookup(r.merchantReference);
      if (l.kind === 'found') return { ok: true, value: { ...l.delivery, merchantReference: r.merchantReference } };
      if (l.kind === 'failed') return unknownMsg(`create refused (${res.message}) and the lookup by reference did not answer`);
      // Bob Go refused THIS request and its lookup shows no shipment of ours: the refusal stands.
      return res;
    },

    findByMerchantReference,

    getDelivery: readShipment,

    async cancelDelivery(providerReference: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
      const res = await api('POST', C.paths.cancelShipment, { [F.shipmentReference]: providerReference }, timeouts.cancel);
      // A 4xx ("cannot be cancelled", "not found") is a definite refusal from http.ts.
      if (!res.ok) return res;
      // Only an answer that says "cancelled" is a cancellation. Anything else
      // proves nothing either way: staff check (no refund on a guess).
      const d = bobgoDelivery(res.value.body, null);
      if (!d || d.state !== 'cancelled') return unknownMsg('Bob Go answered the cancel without a cancelled status');
      // Cancellation fees are unknown; any fee is picked up from the invoice (reconcileDelivery).
      return { ok: true, value: { cancelled: true, feeCents: 0 } };
    },

    async getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>> {
      const d = await readShipment(providerReference);
      if (!d.ok) return d;
      // No verified ETA or location: never invented.
      return { ok: true, value: { state: d.value.state, etaAt: null, location: null, trackingUrl: d.value.trackingUrl } };
    },
  };
}
