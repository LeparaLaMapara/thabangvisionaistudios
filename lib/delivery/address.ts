import { DELIVERY_CHECKOUT, STUDIO } from '@/lib/constants';
import type { ProviderCallResult } from '@/lib/core/ports';
import type { AddressPort, DeliveryPoint } from '@/lib/core/delivery/port';
import { haversineKm, type Coordinates } from './quote';

/**
 * Server-side address verification (AddressPort, spec Phase 4 §4.7, §4.14).
 *
 * The browser's coordinates are NEVER used for a price: a customer could send
 * a point next to our office and pay the minimum for a delivery across
 * Gauteng. The typed address is geocoded here, on the server, and the quote
 * is worked out from the verified point. A browser position is only a hint,
 * compared within DELIVERY_CHECKOUT.hintToleranceKm and logged when it
 * disagrees.
 *
 * Provider: OpenStreetMap Nominatim by default (ADDRESS_PROVIDER=nominatim).
 * Its public usage policy asks for at most one request per second per
 * application, a User-Agent that identifies the application with contact
 * details, local caching, and no autocomplete. So: one lookup per "Get quote"
 * press, a serial queue at most one call per DELIVERY_CHECKOUT.address.minIntervalMs
 * per server instance, an in-memory cache, ZA only. Serverless instances do
 * not share the queue, so the cap is per instance; at our volume that is far
 * below the limit, and a busier platform should move to a paid geocoder by
 * adding an adapter here (ADDRESS_PROVIDER), with no change to the checkout.
 * ADDRESS_PROVIDER=none switches verification off; delivery then falls back to
 * collection with a clear message, never to the browser's coordinates.
 */

export type VerifiedAddress = Omit<DeliveryPoint, 'placeId' | 'contactName' | 'contactPhone' | 'instructions'>;

/** What the renter typed. Free text only; no coordinates. */
export interface AddressInput {
  street: string;
  suburb?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Validate and normalise the typed address. Returns the one-line text to geocode, or a reason. */
export function addressText(input: Partial<AddressInput> | null | undefined): { ok: true; text: string; parts: AddressInput } | { ok: false; message: string } {
  const max = DELIVERY_CHECKOUT.address.maxLength;
  const parts: AddressInput = {
    street: clean(input?.street, max),
    suburb: clean(input?.suburb, 120) || null,
    city: clean(input?.city, 120) || null,
    postalCode: clean(input?.postalCode, 12) || null,
  };
  if (!/\d/.test(parts.street) || parts.street.length < 5) return { ok: false, message: 'Enter the street number and street name.' };
  const text = [parts.street, parts.suburb, parts.city, parts.postalCode].filter(Boolean).join(', ').slice(0, max);
  if (text.length < DELIVERY_CHECKOUT.address.minLength) return { ok: false, message: 'Enter the full address: street, suburb and city.' };
  return { ok: true, text, parts };
}

/**
 * Compare a browser-reported position with the verified one. Never used for a
 * price: only to log a mismatch (a spoof, or a stale map pin).
 */
export function compareHint(verified: Coordinates, hint: unknown, toleranceKm: number = DELIVERY_CHECKOUT.hintToleranceKm): { provided: boolean; withinTolerance: boolean; distanceKm: number | null } {
  const h = hint as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = typeof h?.lat === 'number' ? h.lat : NaN;
  const lng = typeof h?.lng === 'number' ? h.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { provided: false, withinTolerance: true, distanceKm: null };
  const d = Math.round(haversineKm(verified, { lat, lng }) * 10) / 10;
  return { provided: true, withinTolerance: d <= toleranceKm, distanceKm: d };
}

// ── Nominatim adapter ───────────────────────────────────────────────────────

interface NominatimRow {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface NominatimOptions {
  fetchImpl?: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  timeoutMs?: number;
  url?: string;
}

/** Identifies us to the provider, with contact details (Nominatim usage policy). */
export function addressUserAgent(): string {
  return `${STUDIO.name}-delivery/1.0 (+${STUDIO.meta.url}; ${STUDIO.email})`;
}

/** Map a Nominatim row to a verified address. Null when it is not precise enough to drive to. */
export function verifiedFromNominatim(row: NominatimRow, typed: string): VerifiedAddress | null {
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  const a = row.address ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if ((a.country_code ?? '').toLowerCase() !== DELIVERY_CHECKOUT.address.countryCode) return null;
  // A street (or a named place on one) is needed: a suburb or city centre is not an address.
  if (!a.road && !a.pedestrian && !a.house_number) return null;
  const suburb = a.suburb ?? a.neighbourhood ?? a.quarter ?? null;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
  return {
    lat,
    lng,
    // What the driver sees is what the renter typed (unit and gate details
    // matter), located at the verified point.
    formattedAddress: typed,
    suburb,
    city,
    postalCode: a.postcode ?? null,
    province: a.state ?? null,
  };
}

export function createNominatimAddressPort(opts: NominatimOptions = {}): AddressPort {
  const cfg = DELIVERY_CHECKOUT.address;
  const fetchImpl: Fetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minInterval = opts.minIntervalMs ?? cfg.minIntervalMs;
  const ttl = opts.cacheTtlMs ?? cfg.cacheTtlMs;
  const maxEntries = opts.cacheMaxEntries ?? cfg.cacheMaxEntries;
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const base = opts.url ?? cfg.nominatimUrl;
  const cache = new Map<string, { at: number; value: VerifiedAddress | null }>();
  // Serial queue: each lookup waits for the previous one plus the interval.
  let chain: Promise<unknown> = Promise.resolve();
  let lastCallAt = 0;

  async function lookup(text: string): Promise<ProviderCallResult<VerifiedAddress | null>> {
    const wait = lastCallAt + minInterval - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
    const params = new URLSearchParams({ q: text, format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: cfg.countryCode });
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(`${base}?${params.toString()}`, {
        headers: { 'User-Agent': addressUserAgent(), 'Accept-Language': 'en', Referer: STUDIO.meta.url },
        signal: ctrl?.signal,
      });
      if (!res.ok) {
        // 429 / 5xx: try again later. Other 4xx: the request itself was refused.
        return res.status === 429 || res.status >= 500 ? { ok: false, kind: 'unknown', message: `address lookup ${res.status}` } : { ok: false, kind: 'rejected', message: `address lookup ${res.status}` };
      }
      const rows = (await res.json()) as NominatimRow[];
      const row = Array.isArray(rows) ? rows[0] : undefined;
      return { ok: true, value: row ? verifiedFromNominatim(row, text) : null };
    } catch (err) {
      return { ok: false, kind: 'unknown', message: err instanceof Error ? err.message : 'address lookup failed' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    providerId: 'nominatim',
    async geocode(text: string) {
      const key = text.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) return { ok: true, value: hit.value };
      const run = chain.then(() => lookup(text));
      chain = run.catch(() => undefined);
      const result = await run;
      if (result.ok) {
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now(), value: result.value });
      }
      return result;
    },
  };
}

/** Verification switched off: every lookup is refused, so delivery falls back to collection. */
export const disabledAddressPort: AddressPort = {
  providerId: 'none',
  async geocode() {
    return { ok: false, kind: 'rejected', message: 'address_verification_disabled' };
  },
};

let instance: AddressPort | null = null;

/** The AddressPort for this deployment, chosen by ADDRESS_PROVIDER. One per server instance (shared cache and queue). */
export function addressPort(env: Record<string, string | undefined> = process.env): AddressPort {
  if (instance) return instance;
  const which = (env.ADDRESS_PROVIDER ?? 'nominatim').trim().toLowerCase();
  instance = which === 'nominatim' ? createNominatimAddressPort() : disabledAddressPort;
  return instance;
}

export type VerifyOutcome =
  | { ok: true; address: VerifiedAddress; verifiedBy: string }
  | { ok: false; code: 'ADDRESS_INVALID' | 'ADDRESS_NOT_FOUND' | 'ADDRESS_CHECK_UNAVAILABLE' | 'ADDRESS_CHECK_OFF'; message: string };

/** Geocode the typed address with the port and say plainly what went wrong. */
export async function verifyAddress(input: Partial<AddressInput> | null | undefined, port: AddressPort): Promise<VerifyOutcome> {
  const t = addressText(input);
  if (!t.ok) return { ok: false, code: 'ADDRESS_INVALID', message: t.message };
  const r = await port.geocode(t.text);
  if (!r.ok) {
    if (r.message === 'address_verification_disabled') {
      return { ok: false, code: 'ADDRESS_CHECK_OFF', message: 'We cannot check delivery addresses at the moment, so delivery is not available. You can collect in person.' };
    }
    return { ok: false, code: 'ADDRESS_CHECK_UNAVAILABLE', message: 'We could not check that address just now. Please try again in a minute, or collect in person.' };
  }
  if (!r.value) {
    return { ok: false, code: 'ADDRESS_NOT_FOUND', message: 'We could not find that street address. Check the street number, street name, suburb and city.' };
  }
  return { ok: true, address: { ...r.value, formattedAddress: t.text }, verifiedBy: port.providerId };
}

/** The driver's contact for this address: first name (or business) and a South African phone number. */
export function contactDetails(body: { contact_name?: unknown; contact_phone?: unknown; instructions?: unknown }):
  | { ok: true; contactName: string; contactPhone: string; instructions: string | null }
  | { ok: false; message: string } {
  const name = clean(body.contact_name, DELIVERY_CHECKOUT.contact.maxNameLength);
  if (name.length < 2) return { ok: false, message: 'Who should the driver ask for?' };
  const raw = clean(body.contact_phone, 20).replace(/[\s()-]/g, '');
  const phone = raw.startsWith('+27') ? `0${raw.slice(3)}` : raw;
  if (!/^0\d{9}$/.test(phone)) return { ok: false, message: 'Enter a South African phone number for the driver, like 082 123 4567.' };
  const instructions = clean(body.instructions, DELIVERY_CHECKOUT.contact.maxInstructionsLength) || null;
  return { ok: true, contactName: name, contactPhone: phone, instructions };
}
