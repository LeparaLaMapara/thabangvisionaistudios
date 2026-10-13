import type { ProviderCallResult } from '@/lib/core/ports';
import type {
  CreateDeliveryRequest,
  DeliveryPoint,
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
import { haversineKm } from '../quote';
import { UBER_DIRECT_API, UBER_DIRECT_CAPABILITIES, UBER_DIRECT_PROVIDER_ID, mapUberStatus } from './api';

/**
 * Uber Direct adapter (spec Phase 4 §4.5, milestone 4B). Server only.
 *
 * - OAuth2 client credentials (scope eats.deliveries), token cached until
 *   shortly before it expires.
 * - Quote: Uber's quote endpoint; the price is the provider's cost in cents,
 *   valid for at most 15 minutes.
 * - Create: our merchant reference goes out as `external_id` and
 *   `idempotency_key`. Uber refuses a second create with the same key (409
 *   duplicate_delivery, verified 2026-10-13); we then return the first
 *   delivery, found by external_id. Hand-to-hand: meet at the door,
 *   signature + photo at dropoff, PIN when the core supplies one, photo at
 *   pickup, return to sender if undeliverable.
 * - findByMerchantReference: GET /deliveries?external_id= (verified). None
 *   found = nothing was created; more than one = unknown, a person checks.
 * - Every call has a timeout and goes through a per-provider circuit breaker;
 *   nothing here retries a create.
 */

type Env = Record<string, string | undefined>;
type Mode = 'sandbox' | 'production';

export interface UberDirectConfig {
  mode: Mode;
  clientId: string | null;
  clientSecret: string | null;
  customerId: string | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
  breaker?: CircuitBreaker;
  timeoutsMs?: Partial<Record<keyof typeof UBER_DIRECT_API.timeoutsMs, number>>;
}

/**
 * Credentials per mode, so a deployment set to sandbox can never pick up live
 * keys by accident:
 *   sandbox:    UBER_DIRECT_SANDBOX_CLIENT_ID / _CLIENT_SECRET / _CUSTOMER_ID
 *   production: UBER_DIRECT_CLIENT_ID / UBER_DIRECT_CLIENT_SECRET / UBER_DIRECT_CUSTOMER_ID
 */
export function uberDirectConfigFromEnv(env: Env, mode: Mode): UberDirectConfig {
  const p = mode === 'sandbox' ? 'UBER_DIRECT_SANDBOX_' : 'UBER_DIRECT_';
  const v = (k: string): string | null => env[`${p}${k}`]?.trim() || null;
  return { mode, clientId: v('CLIENT_ID'), clientSecret: v('CLIENT_SECRET'), customerId: v('CUSTOMER_ID') };
}

// ── Token cache (per instance; a cold start fetches a new token) ────────────

interface CachedToken {
  token: string;
  expiresAtMs: number;
}
const tokenCache = new Map<string, CachedToken>();
const tokenInFlight = new Map<string, Promise<ProviderCallResult<string>>>();

/** Tests only. */
export function resetUberDirectTokenCache(): void {
  tokenCache.clear();
  tokenInFlight.clear();
}

type Configured = UberDirectConfig & { clientId: string; clientSecret: string; customerId: string };
const isConfigured = (c: UberDirectConfig): c is Configured => !!c.clientId && !!c.clientSecret && !!c.customerId;

const unknownMsg = (message: string): { ok: false; kind: 'unknown'; message: string } => ({ ok: false, kind: 'unknown', message });

export function createUberDirectAdapter(config: UberDirectConfig): DeliveryPort {
  const now = config.now ?? (() => new Date());
  const breaker = config.breaker ?? breakerFor(`${UBER_DIRECT_PROVIDER_ID}:${config.mode}`);
  const timeouts = { ...UBER_DIRECT_API.timeoutsMs, ...config.timeoutsMs };
  const base = UBER_DIRECT_API.baseUrl[config.mode];
  const cacheKey = `${config.mode}:${config.clientId ?? ''}`;

  async function fetchToken(c: Configured): Promise<ProviderCallResult<string>> {
    const res = await deliveryHttp({
      method: 'POST',
      url: UBER_DIRECT_API.tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials', scope: UBER_DIRECT_API.scope }).toString(),
      timeoutMs: timeouts.token,
      fetchImpl: c.fetchImpl,
      breaker,
    });
    if (!res.ok) {
      // A 400/401 from the token endpoint is a configuration problem (invalid_client).
      return res.kind === 'rejected' ? { ok: false, kind: 'rejected', message: `Uber Direct authentication refused (check credentials): ${res.message}` } : res;
    }
    const body = asObject(res.value.body);
    const token = asString(body?.access_token);
    const expiresIn = Number(body?.expires_in);
    if (!token) return unknownMsg('Uber Direct token response had no access_token');
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0;
    const expiresAtMs = now().getTime() + Math.max(0, ttlMs - UBER_DIRECT_API.tokenRefreshSkewMs);
    tokenCache.set(cacheKey, { token, expiresAtMs });
    return { ok: true, value: token };
  }

  async function token(c: Configured): Promise<ProviderCallResult<string>> {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now().getTime()) return { ok: true, value: cached.token };
    const pending = tokenInFlight.get(cacheKey);
    if (pending) return pending;
    const p = fetchToken(c).finally(() => tokenInFlight.delete(cacheKey));
    tokenInFlight.set(cacheKey, p);
    return p;
  }

  async function api(method: 'GET' | 'POST', path: string, body: Json | undefined, timeoutMs: number): Promise<HttpResult> {
    if (!isConfigured(config)) return notConfigured('Uber Direct');
    const t = await token(config);
    if (!t.ok) return t;
    const res = await deliveryHttp({
      method,
      url: `${base}${path}`,
      headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
      fetchImpl: config.fetchImpl,
      breaker,
    });
    // A refused token is dropped so the next call fetches a fresh one. The
    // call itself is NOT repeated here (a create is never retried by an adapter).
    if (!res.ok && (res.status === 401 || res.status === 403)) tokenCache.delete(cacheKey);
    return res;
  }

  function address(p: Partial<Pick<DeliveryPoint, 'formattedAddress'>> & Pick<DeliveryPoint, 'suburb' | 'city' | 'postalCode' | 'province'>): string {
    // Uber's structured address JSON, sent as a string (verified 2026-10-13).
    const street = [p.formattedAddress ?? p.suburb ?? ''].filter((s) => s.trim() !== '');
    return JSON.stringify({ street_address: street, city: p.city ?? '', state: p.province ?? '', zip_code: p.postalCode ?? '', country: UBER_DIRECT_API.countryCode });
  }

  function toDelivery(raw: unknown, fallbackMerchantRef: string | null): ProviderDelivery | null {
    const d = asObject(raw);
    const id = asString(d?.id);
    if (!d || !id) return null;
    return {
      providerReference: id,
      merchantReference: asString(d.external_id) ?? fallbackMerchantRef ?? '',
      state: mapUberStatus(d.status),
      stateAt: asIsoTime(d.updated) ?? asIsoTime(d.created),
      trackingUrl: asString(d.tracking_url),
      courierName: firstNameOnly(asObject(d.courier)?.name),
      proof: uberProofs(id, d),
    };
  }

  const quoteWindowFields = (w: { start: string | null; end: string | null }): Json => ({
    ...(w.start ? { pickup_ready_dt: w.start } : {}),
    ...(w.end ? { dropoff_deadline_dt: w.end } : {}),
  });

  async function findByExternalId(merchantReference: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
    const res = await api('GET', UBER_DIRECT_API.paths.byExternalId(config.customerId ?? '', merchantReference), undefined, timeouts.read);
    if (!res.ok) return res;
    const data = asObject(res.value.body)?.data;
    if (!Array.isArray(data)) return unknownMsg('Uber Direct returned an unreadable delivery list');
    // Only exact matches count, whatever the filter did.
    const mine = data.map((d) => toDelivery(d, null)).filter((d): d is ProviderDelivery => !!d && d.merchantReference === merchantReference);
    if (mine.length === 0) return { ok: true, value: null };
    if (mine.length > 1) return unknownMsg('Uber Direct has more than one delivery with our reference: check the Uber Direct dashboard');
    return { ok: true, value: mine[0] };
  }

  async function requestQuote(r: DeliveryQuoteRequest): Promise<ProviderCallResult<ProviderQuote>> {
    if (!validCoords(r.from) || !validCoords(r.to)) return { ok: false, kind: 'rejected', message: 'invalid coordinates' };
    const res = await api(
      'POST',
      UBER_DIRECT_API.paths.quote(config.customerId ?? ''),
      {
        pickup_address: address(r.from),
        dropoff_address: address(r.to),
        pickup_latitude: r.from.lat,
        pickup_longitude: r.from.lng,
        dropoff_latitude: r.to.lat,
        dropoff_longitude: r.to.lng,
        ...quoteWindowFields(r.window),
      },
      timeouts.read,
    );
    if (!res.ok) return res;
    const b = asObject(res.value.body);
    const fee = Number(b?.fee);
    // VERIFY: fee is integer cents. Anything else is not a price we can charge from.
    if (!b || !Number.isSafeInteger(fee) || fee < 0) return unknownMsg('Uber Direct quote had no usable fee');
    const currency = asString(b.currency_type) ?? asString(b.currency);
    if (currency && currency.toUpperCase() !== UBER_DIRECT_API.currency) return { ok: false, kind: 'rejected', message: `unexpected quote currency ${currency}` };
    const ours = now().getTime() + UBER_DIRECT_API.quoteValidityMinutes * 60_000;
    const theirs = asIsoTime(b.expires);
    const expiresAt = theirs && new Date(theirs).getTime() < ours ? theirs : new Date(ours).toISOString();
    return { ok: true, value: { providerId: UBER_DIRECT_PROVIDER_ID, providerQuoteRef: asString(b.id), providerCostCents: fee, expiresAt, window: r.window } };
  }

  return {
    providerId: UBER_DIRECT_PROVIDER_ID,
    kind: 'courier',
    mode: config.mode,
    capabilities: UBER_DIRECT_CAPABILITIES,

    /**
     * No separate serviceability endpoint: a local check (configured, usable
     * coordinates, inside Uber's radius) so a trip Uber will refuse is never
     * sent. Uber's real answer is the quote, which the core asks for next; a
     * refused quote (address_undeliverable) excludes the provider quietly.
     */
    async checkServiceability(r: ServiceabilityRequest): Promise<ProviderCallResult<ServiceabilityResult>> {
      if (!isConfigured(config)) return notConfigured('Uber Direct');
      if (!validCoords(r.from) || !validCoords(r.to)) return { ok: true, value: { serviceable: false, reason: 'invalid_location' } };
      if (!withinUberRadius(r.from, r.to)) return { ok: true, value: { serviceable: false, reason: 'outside_provider_radius' } };
      return { ok: true, value: { serviceable: true, reason: null } };
    },

    quote: requestQuote,

    async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
      const dropoffVerification: Json = {
        // VERIFY: field names. Signature + photo prove the hand-over; a PIN when we have one.
        signature_requirement: { enabled: true, collect_signer_name: true },
        picture: true,
        ...(r.requirements.recipientPin ? { pincode: { enabled: true, value: r.requirements.recipientPin } } : {}),
      };
      const body: Json = {
        ...(r.quote.providerQuoteRef ? { quote_id: r.quote.providerQuoteRef } : {}),
        // Our stable reference: the same on every attempt of the same leg.
        external_id: r.merchantReference,
        // VERIFY: duplicate behaviour. Until verified the core does not rely on it.
        idempotency_key: r.merchantReference,
        manifest_reference: r.merchantReference,
        pickup_name: r.from.contactName,
        pickup_address: address(r.from),
        pickup_phone_number: r.from.contactPhone,
        pickup_latitude: r.from.lat,
        pickup_longitude: r.from.lng,
        ...(r.from.instructions ? { pickup_notes: r.from.instructions } : {}),
        dropoff_name: r.to.contactName,
        dropoff_address: address(r.to),
        dropoff_phone_number: r.to.contactPhone,
        dropoff_latitude: r.to.lat,
        dropoff_longitude: r.to.lng,
        ...(r.to.instructions ? { dropoff_notes: r.to.instructions } : {}),
        // Generic label only: never brand, model or value to a driver.
        manifest_items: r.items.map((i) => ({ name: i.driverLabel, quantity: 1, ...(i.weightGrams ? { weight: i.weightGrams } : {}) })),
        ...(r.requirements.declaredValueCents !== null ? { manifest_total_value: r.requirements.declaredValueCents } : {}),
        // Pickup: the courier photographs the parcel at collection.
        pickup_verification: { picture: true },
        dropoff_verification: dropoffVerification,
        undeliverable_action: UBER_DIRECT_API.undeliverableActionReturn,
        ...quoteWindowFields(r.window),
      };
      // Hand-to-hand: never leave-at-door (PIN/signature also exclude it).
      if (r.requirements.noLeaveAtDoor) body.deliverable_action = UBER_DIRECT_API.deliverableActionMeetAtDoor;
      const res = await api('POST', UBER_DIRECT_API.paths.create(config.customerId ?? ''), body, timeouts.create);
      if (!res.ok) {
        // 409 duplicate_delivery: this reference was already used. Return the
        // delivery it made (never a second courier); unknown if we cannot see it.
        if (res.status === 409) {
          const found = await findByExternalId(r.merchantReference);
          if (found.ok && found.value) return { ok: true, value: { ...found.value, merchantReference: r.merchantReference } };
          return unknownMsg('Uber Direct says this delivery already exists, but it could not be found by our reference: check the Uber Direct dashboard');
        }
        return res;
      }
      const d = toDelivery(res.value.body, r.merchantReference);
      // 2xx without a delivery id: something may have been created. Unknown, not ok.
      if (!d) return unknownMsg('Uber Direct accepted the request but returned no delivery id');
      return { ok: true, value: { ...d, merchantReference: r.merchantReference } };
    },

    /** Our reference goes out as external_id; Uber lists deliveries by it (verified 2026-10-13). */
    findByMerchantReference: findByExternalId,

    async getDelivery(providerReference: string): Promise<ProviderCallResult<ProviderDelivery>> {
      const res = await api('GET', UBER_DIRECT_API.paths.get(config.customerId ?? '', providerReference), undefined, timeouts.read);
      if (!res.ok) return res;
      const d = toDelivery(res.value.body, null);
      return d ? { ok: true, value: d } : unknownMsg('Uber Direct returned an unreadable delivery');
    },

    async cancelDelivery(providerReference: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
      const res = await api('POST', UBER_DIRECT_API.paths.cancel(config.customerId ?? '', providerReference), {}, timeouts.cancel);
      if (!res.ok) return res;
      const d = toDelivery(res.value.body, null);
      if (!d) return unknownMsg('Uber Direct cancel returned no delivery');
      // A 2xx that does not say "canceled" proves nothing either way: staff check.
      if (d.state !== 'cancelled') return unknownMsg('Uber Direct answered the cancel without a cancelled status');
      // VERIFY: SA cancellation fees. The API response does not give one we
      // have verified; any fee is picked up from the invoice (reconcileDelivery).
      return { ok: true, value: { cancelled: true, feeCents: 0 } };
    },

    async getTracking(providerReference: string): Promise<ProviderCallResult<TrackingResult>> {
      const res = await api('GET', UBER_DIRECT_API.paths.get(config.customerId ?? '', providerReference), undefined, timeouts.read);
      if (!res.ok) return res;
      const d = asObject(res.value.body);
      if (!d || !asString(d.id)) return unknownMsg('Uber Direct returned an unreadable delivery');
      // Only what Uber reports: never an invented ETA or location.
      const loc = asObject(asObject(d.courier)?.location);
      const lat = Number(loc?.lat);
      const lng = Number(loc?.lng);
      const at = asIsoTime(d.updated);
      return {
        ok: true,
        value: {
          state: mapUberStatus(d.status),
          etaAt: asIsoTime(d.dropoff_eta),
          location: loc && at && validCoords({ lat, lng }) ? { lat, lng, at } : null,
          trackingUrl: asString(d.tracking_url),
        },
      };
    },
  };
}

/**
 * Proof Uber reports for a delivery, as references only (no image URLs or
 * signer names are kept). Uber sends each kind as an object whose image_url
 * is "" until the proof exists (seen 2026-10-13), so only a filled one counts.
 */
/** Straight-line distance inside Uber's radius (UBER_DIRECT_API.maxRadiusKm). */
export function withinUberRadius(from: { lat: number; lng: number }, to: { lat: number; lng: number }): boolean {
  return haversineKm(from, to) <= UBER_DIRECT_API.maxRadiusKm;
}

export function uberProofs(deliveryId: string, d: Json): ProviderDelivery['proof'] {
  const out: ProviderDelivery['proof'] = [];
  const sides: [string, Json | null][] = [
    ['pickup', asObject(asObject(d.pickup)?.verification)],
    ['dropoff', asObject(asObject(d.dropoff)?.verification)],
  ];
  const kinds: [string, ProviderDelivery['proof'][number]['kind']][] = [
    ['pin_code', 'pin'],
    ['signature', 'signature'],
    ['picture', 'photo'],
    ['barcodes', 'scan'],
  ];
  for (const [side, v] of sides) {
    if (!v) continue;
    for (const [field, kind] of kinds) {
      if (proofPresent(v[field])) {
        out.push({ kind, ref: `${UBER_DIRECT_PROVIDER_ID}:${deliveryId}:${side}:${kind}` });
      }
    }
  }
  return out;
}

function proofPresent(x: unknown): boolean {
  if (x === undefined || x === null || x === false || x === '') return false;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object') {
    const o = x as Record<string, unknown>;
    // A proof object counts only when it carries something: an image, a code, a value.
    return ['image_url', 'value', 'code', 'pin', 'entered', 'barcode'].some((k) => typeof o[k] === 'string' && (o[k] as string).trim() !== '');
  }
  return x === true || (typeof x === 'string' && x.trim() !== '');
}
