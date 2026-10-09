import type { ProviderCallResult } from '@/lib/core/ports';
import type {
  CreateDeliveryRequest,
  DeliveryPort,
  DeliveryQuoteRequest,
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
  firstNameOnly,
  notConfigured,
  validCoords,
  type FetchLike,
  type HttpResult,
  type Json,
} from '../http';
import { WUMDROP_API, WUMDROP_CAPABILITIES, WUMDROP_PROVIDER_ID, mapWumdropStatus } from './api';

/**
 * WumDrop adapter (spec Phase 4 §4.5, milestone 4D: redundancy). Server only.
 *
 * - Basic auth with the API key.
 * - Create: POST /v1/deliveries with order_reference = our merchant
 *   reference. WumDrop refuses a duplicate reference, so a 4xx on create is
 *   checked with a lookup by reference before it is called a refusal: if the
 *   job exists (an earlier attempt got through), it is returned; only "no job
 *   under our reference" makes it a definite refusal.
 * - findByMerchantReference: GET /deliveries/ext/:order_reference
 *   (404 = no job under our reference).
 * - No webhook signing is verified: status comes from polling getDelivery
 *   (see webhook.ts, which fails closed).
 */

type Env = Record<string, string | undefined>;
type Mode = 'sandbox' | 'production';

export interface WumdropConfig {
  mode: Mode;
  apiKey: string | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
  breaker?: CircuitBreaker;
  timeoutsMs?: Partial<Record<keyof typeof WUMDROP_API.timeoutsMs, number>>;
}

/** Key per mode: WUMDROP_SANDBOX_API_KEY (sandbox) or WUMDROP_API_KEY (production). */
export function wumdropConfigFromEnv(env: Env, mode: Mode): WumdropConfig {
  const key = (mode === 'sandbox' ? env.WUMDROP_SANDBOX_API_KEY : env.WUMDROP_API_KEY)?.trim() || null;
  return { mode, apiKey: key };
}

/** Rands (number or decimal string) to integer cents, without float drift. Null if not a price. */
export function randsToCents(v: unknown): number | null {
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

/** Proof references from a WumDrop delivery (VERIFY: field names). No images, names or ID numbers are kept. */
export function wumdropProofs(id: string, d: Json): ProviderDelivery['proof'] {
  const pod = asObject(d.proof_of_delivery) ?? asObject(d.pod);
  if (!pod) return [];
  const out: ProviderDelivery['proof'] = [];
  if (pod.signature) out.push({ kind: 'signature', ref: `${WUMDROP_PROVIDER_ID}:${id}:signature` });
  if (pod.image ?? pod.photo) out.push({ kind: 'photo', ref: `${WUMDROP_PROVIDER_ID}:${id}:photo` });
  return out;
}

/** VERIFY: response field names. Reads defensively; null when there is no delivery id. */
export function wumdropDelivery(raw: unknown, fallbackRef: string | null): ProviderDelivery | null {
  const top = asObject(raw);
  const d = asObject(top?.delivery) ?? asObject(top?.data) ?? top;
  const id = asString(d?.id) ?? asString(d?.delivery_id);
  if (!d || !id) return null;
  return {
    providerReference: id,
    merchantReference: asString(d.order_reference) ?? fallbackRef ?? '',
    state: mapWumdropStatus(d.status),
    stateAt: asIsoTime(d.updated_at) ?? asIsoTime(d.created_at),
    trackingUrl: asString(d.tracking_url),
    courierName: firstNameOnly(asObject(d.driver)?.name),
    proof: wumdropProofs(id, d),
  };
}

export function createWumdropAdapter(config: WumdropConfig): DeliveryPort {
  const now = config.now ?? (() => new Date());
  const breaker = config.breaker ?? breakerFor(`${WUMDROP_PROVIDER_ID}:${config.mode}`);
  const timeouts = { ...WUMDROP_API.timeoutsMs, ...config.timeoutsMs };
  const base = WUMDROP_API.baseUrl[config.mode];

  async function api(method: 'GET' | 'POST' | 'DELETE', path: string, body: Json | undefined, timeoutMs: number): Promise<HttpResult> {
    if (!config.apiKey) return notConfigured('WumDrop');
    return deliveryHttp({
      method,
      url: `${base}${path}`,
      headers: { Authorization: WUMDROP_API.basicAuth(config.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
      fetchImpl: config.fetchImpl,
      breaker,
    });
  }

  async function findByMerchantReference(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
    const res = await api('GET', WUMDROP_API.paths.byReference(merchantReference), undefined, timeouts.read);
    if (!res.ok) {
      // 404 on the lookup is WumDrop's definite "no delivery under this reference".
      if (res.kind === 'rejected' && res.status === 404) return { ok: true, value: null };
      // Not sent (not configured): pass the refusal through. Any other refusal
      // (credentials, bad request) is not an answer about the job: unknown.
      if (res.kind === 'rejected' && res.status === undefined) return res;
      return res.kind === 'rejected' ? unknownMsg(`lookup by reference failed: ${res.message}`) : res;
    }
    const d = wumdropDelivery(res.value.body, merchantReference);
    if (!d) return unknownMsg('WumDrop lookup returned no delivery id');
    // A job under a different reference is not ours.
    if (d.merchantReference && d.merchantReference !== merchantReference) return unknownMsg('WumDrop lookup returned a different reference');
    return { ok: true, value: { ...d, merchantReference } };
  }

  return {
    providerId: WUMDROP_PROVIDER_ID,
    kind: 'courier',
    mode: config.mode,
    capabilities: WUMDROP_CAPABILITIES,

    /** No serviceability endpoint is verified: local sanity check; the quote is the real answer. */
    async checkServiceability(r: ServiceabilityRequest): Promise<ProviderCallResult<ServiceabilityResult>> {
      if (!config.apiKey) return notConfigured('WumDrop');
      if (!validCoords(r.from) || !validCoords(r.to)) return { ok: true, value: { serviceable: false, reason: 'invalid_location' } };
      return { ok: true, value: { serviceable: true, reason: null } };
    },

    async quote(r: DeliveryQuoteRequest): Promise<ProviderCallResult<ProviderQuote>> {
      if (!validCoords(r.from) || !validCoords(r.to)) return { ok: false, kind: 'rejected', message: 'invalid coordinates' };
      // VERIFY: quote request fields.
      const res = await api(
        'POST',
        WUMDROP_API.paths.quote,
        {
          pickup_lat: r.from.lat,
          pickup_lng: r.from.lng,
          dropoff_lat: r.to.lat,
          dropoff_lng: r.to.lng,
          parcel_count: r.items.length,
        },
        timeouts.read,
      );
      if (!res.ok) return res;
      const b = asObject(res.value.body);
      const cents = randsToCents(b?.[WUMDROP_API.quotePriceField]);
      if (cents === null) return unknownMsg('WumDrop quote had no usable price');
      const expiresAt = new Date(now().getTime() + WUMDROP_API.quoteValidityMinutes * 60_000).toISOString();
      return { ok: true, value: { providerId: WUMDROP_PROVIDER_ID, providerQuoteRef: asString(b?.id), providerCostCents: cents, expiresAt, window: r.window } };
    },

    async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
      // VERIFY: field names other than order_reference.
      const body: Json = {
        order_reference: r.merchantReference,
        pickup_address: r.from.formattedAddress,
        pickup_lat: r.from.lat,
        pickup_lng: r.from.lng,
        pickup_contact_name: r.from.contactName,
        pickup_contact_phone: r.from.contactPhone,
        ...(r.from.instructions ? { pickup_instructions: r.from.instructions } : {}),
        dropoff_address: r.to.formattedAddress,
        dropoff_lat: r.to.lat,
        dropoff_lng: r.to.lng,
        dropoff_contact_name: r.to.contactName,
        dropoff_contact_phone: r.to.contactPhone,
        ...(r.to.instructions ? { dropoff_instructions: r.to.instructions } : {}),
        // Generic label only: never brand, model or value to a driver.
        parcel_description: [...new Set(r.items.map((i) => i.driverLabel))].join(', '),
        parcel_count: r.items.length,
        ...(r.quote.providerQuoteRef ? { quote_id: r.quote.providerQuoteRef } : {}),
      };
      const res = await api('POST', WUMDROP_API.paths.create, body, timeouts.create);
      if (res.ok) {
        const d = wumdropDelivery(res.value.body, r.merchantReference);
        // 2xx without an id: something may exist. The core reconciles by reference.
        if (!d) return unknownMsg('WumDrop accepted the request but returned no delivery id');
        return { ok: true, value: { ...d, merchantReference: r.merchantReference } };
      }
      if (res.kind === 'unknown') return res;
      // Not sent (not configured), or credentials refused: nothing was created
      // and a lookup would be refused too.
      if (res.status === undefined || res.status === 401 || res.status === 403) return res;
      // Any other refusal may be "duplicate order_reference": ask before calling it a refusal.
      const found = await findByMerchantReference(r.merchantReference);
      if (!found.ok) return unknownMsg(`create refused (${res.message}) and the lookup by reference did not answer`);
      if (found.value) return { ok: true, value: found.value };
      return res;
    },

    findByMerchantReference,

    async getDelivery(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>> {
      const res = await api('GET', WUMDROP_API.paths.get(providerReference), undefined, timeouts.read);
      if (!res.ok) return res;
      const d = wumdropDelivery(res.value.body, null);
      return d ? { ok: true, value: d } : unknownMsg('WumDrop returned an unreadable delivery');
    },

    async cancelDelivery(providerReference: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
      const res = await api('DELETE', WUMDROP_API.paths.cancel(providerReference), undefined, timeouts.cancel);
      if (!res.ok) return res;
      // VERIFY: the DELETE response. An empty 2xx (e.g. 204) or a "cancelled"
      // status is a cancellation; a body with any other status is not proof
      // either way, so it is unknown (staff check) rather than a refund on a guess.
      const d = wumdropDelivery(res.value.body, null);
      if (d && d.state !== 'cancelled') return unknownMsg('WumDrop answered the cancel with an unrecognised status');
      // VERIFY: cancellation fees; any fee is picked up from the invoice (reconcileDelivery).
      return { ok: true, value: { cancelled: true, feeCents: 0 } };
    },

    async getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>> {
      const res = await api('GET', WUMDROP_API.paths.get(providerReference), undefined, timeouts.read);
      if (!res.ok) return res;
      const d = wumdropDelivery(res.value.body, null);
      if (!d) return unknownMsg('WumDrop returned an unreadable delivery');
      // No verified ETA or live location: never invented.
      return { ok: true, value: { state: d.state, etaAt: null, location: null, trackingUrl: d.trackingUrl } };
    },
  };
}
