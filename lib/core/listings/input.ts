/**
 * Validation of what an owner sends when creating or editing a community
 * listing. Pure: no Supabase, Next.js or provider imports. Amounts arrive and
 * leave in rands (the smart_rentals columns are rands); bounds are checked in
 * cents.
 *
 * Nothing the browser sends decides the listing's status, its deposit, its
 * owner or whether it is public. Those are set on the server.
 */

import {
  LISTING_POLICY,
  LISTING_TO_RENTAL_CATEGORY,
  RENTAL_CATEGORY_VALUES,
  STUDIO,
  type RentalCategorySlug,
} from '@/lib/constants';
import { fromCents, toCents } from '@/lib/core/pricing/money';
import { depositFor } from '@/lib/core/pricing/rental';
import { isAiSuggestibleField, weekRateProblem, type AiSuggestibleField } from './review';

const LIMITS = {
  title: 140,
  description: 4000,
  shortText: 80,
  location: 120,
  evidence: 500,
  includesItems: 20,
} as const;

const DAYS_PER_WEEK = 7;

export interface ListingImage {
  url: string;
  public_id: string;
}

export interface ListingInput {
  title: string;
  description: string | null;
  /** smart_rentals category slug; null only when not sent on an edit. */
  category: RentalCategorySlug | null;
  condition: string | null;
  brand: string | null;
  model: string | null;
  /** Rands. */
  price_per_day: number | null;
  /**
   * Rands. `undefined` when the body did not send it (an edit keeps the
   * stored value); null clears it. Never more than 7 days at the day rate.
   */
  price_per_week: number | null | undefined;
  /** Rands. */
  replacement_value: number | null;
  /** What comes with the hire. `undefined` when not sent (an edit keeps the stored list). */
  rental_includes: string[] | undefined;
  serial_number: string | null;
  /** Owner-entered suburb and city. Never coordinates. */
  location: string | null;
  replacement_value_evidence: string | null;
  /**
   * The cover photo: always one of `gallery` (null when there is no
   * gallery). Chosen by cover_public_id or thumbnail_url from the gallery;
   * a cover that is not one of the listing's own photos is refused.
   */
  thumbnail_url: string | null;
  /** The cover's storage id, taken from the gallery entry, never from the browser on its own. */
  cover_public_id: string | null;
  gallery: ListingImage[] | null;
  /** Raw declaration ticks; turned into a record by buildAttestations(). */
  attestations: unknown;
  ai_suggested_fields: AiSuggestibleField[];
}

export type ParseResult = { ok: true; value: ListingInput } | { ok: false; error: string; field: string };

function fail(field: string, error: string): ParseResult {
  return { ok: false, error, field };
}

function optionalText(raw: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const v = raw.trim();
  if (v.length > max) return { ok: false };
  return { ok: true, value: v || null };
}

/**
 * A money amount in rands: blank means "not set"; anything else must be a
 * finite amount above zero and below the sanity ceiling.
 */
export function parseRands(raw: unknown, maxCents: number): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  const cents = toCents(n);
  if (cents <= 0 || cents > maxCents) return { ok: false };
  return { ok: true, value: fromCents(cents) };
}

/** Accepts the dashboard's short names (cameras, lenses…) or a real category slug. */
export function resolveCategory(raw: unknown): RentalCategorySlug | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  if ((RENTAL_CATEGORY_VALUES as readonly string[]).includes(v)) return v as RentalCategorySlug;
  return LISTING_TO_RENTAL_CATEGORY[v] ?? null;
}

// "-26.2041, 28.0473" or "26.2041S 28.0473E": coordinates, not a suburb.
const COORDINATES = /-?\d{1,3}\.\d{3,}\s*[°NSEWnsew]?\s*[,;\s]\s*-?\d{1,3}\.\d{3,}/;

export function looksLikeCoordinates(text: string): boolean {
  return COORDINATES.test(text);
}

function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseGallery(raw: unknown): { ok: true; value: ListingImage[] | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false, error: 'Images must be a list.' };
  if (raw.length > STUDIO.platform.maxListingImages) {
    return { ok: false, error: `At most ${STUDIO.platform.maxListingImages} images per listing.` };
  }
  const out: ListingImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Each image needs a URL.' };
    const { url, public_id } = item as Record<string, unknown>;
    if (typeof url !== 'string' || !isHttpsUrl(url)) return { ok: false, error: 'Each image needs a secure (https) URL.' };
    // Only the URL and storage id are kept: any other key (EXIF, GPS, camera
    // data) the browser attaches is dropped here.
    out.push({ url, public_id: typeof public_id === 'string' ? public_id : '' });
  }
  return { ok: true, value: out.length > 0 ? out : null };
}

function parseIncludes(raw: unknown): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "What's included must be a list." };
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: "Each item in what's included must be text." };
    const v = item.trim();
    if (!v) continue;
    if (v.length > LIMITS.shortText) return { ok: false, error: `Each included item is limited to ${LIMITS.shortText} characters.` };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > LIMITS.includesItems) return { ok: false, error: `At most ${LIMITS.includesItems} included items.` };
  return { ok: true, value: out };
}

/**
 * The cover photo, picked from the listing's own gallery: the entry whose
 * storage id is `coverPublicId`, else the entry whose URL is `thumbnailUrl`,
 * else the first photo. A requested cover that matches no photo is refused,
 * so a cover can never be an image a reviewer was not shown.
 */
export function resolveCover(
  gallery: ListingImage[] | null,
  thumbnailUrl: unknown,
  coverPublicId: unknown,
): { ok: true; value: { thumbnail_url: string | null; cover_public_id: string | null } } | { ok: false } {
  const wantedUrl = typeof thumbnailUrl === 'string' && thumbnailUrl ? thumbnailUrl : null;
  const wantedId = typeof coverPublicId === 'string' && coverPublicId ? coverPublicId : null;
  if (!gallery || gallery.length === 0) {
    if (wantedUrl || wantedId) return { ok: false };
    return { ok: true, value: { thumbnail_url: null, cover_public_id: null } };
  }
  let cover: ListingImage | undefined;
  if (wantedId) cover = gallery.find((g) => g.public_id === wantedId);
  if (!cover && wantedUrl) cover = gallery.find((g) => g.url === wantedUrl);
  if (!cover && (wantedId || wantedUrl)) return { ok: false };
  cover = cover ?? gallery[0];
  return { ok: true, value: { thumbnail_url: cover.url, cover_public_id: cover.public_id || null } };
}

/**
 * Parses a create or edit body. `requireCategory` is true on create. Title is
 * always required (every save writes it). Amounts may be blank on a draft;
 * submission checks they are set.
 */
export function parseListingInput(body: unknown, opts: { requireCategory: boolean }): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body', 'Send the listing as a JSON object.');
  const b = body as Record<string, unknown>;

  const title = optionalText(b.title, LIMITS.title);
  if (!title.ok || !title.value) return fail('title', `Title is required (up to ${LIMITS.title} characters).`);

  const description = optionalText(b.description, LIMITS.description);
  if (!description.ok) return fail('description', `Description is limited to ${LIMITS.description} characters.`);

  const category = resolveCategory(b.category);
  if (b.category !== undefined && b.category !== null && b.category !== '' && !category) {
    return fail('category', 'Choose a category from the list.');
  }
  if (opts.requireCategory && !category) return fail('category', 'Category is required.');

  const condition = optionalText(b.condition, LIMITS.shortText);
  if (!condition.ok) return fail('condition', 'Condition is not valid.');
  const brand = optionalText(b.brand, LIMITS.shortText);
  if (!brand.ok) return fail('brand', `Brand is limited to ${LIMITS.shortText} characters.`);
  const model = optionalText(b.model, LIMITS.shortText);
  if (!model.ok) return fail('model', `Model is limited to ${LIMITS.shortText} characters.`);
  const serial = optionalText(b.serial_number, LIMITS.shortText);
  if (!serial.ok) return fail('serial_number', `Serial number is limited to ${LIMITS.shortText} characters.`);

  const price = parseRands(b.price_per_day, LISTING_POLICY.maxPricePerDayCents);
  if (!price.ok) return fail('price_per_day', 'Day rate must be an amount above zero.');
  const replacement = parseRands(b.replacement_value, LISTING_POLICY.maxReplacementValueCents);
  if (!replacement.ok) return fail('replacement_value', 'Replacement value must be an amount above zero.');

  const week = parseRands(b.price_per_week, LISTING_POLICY.maxPricePerDayCents * DAYS_PER_WEEK);
  if (!week.ok) return fail('price_per_week', 'Week rate must be an amount above zero.');
  const pricePerWeek = b.price_per_week === undefined ? undefined : week.value;
  // Checked here when both are sent; an edit that sends only one is checked
  // against the stored value by the route.
  if (pricePerWeek != null && price.value !== null) {
    const problem = weekRateProblem(price.value, pricePerWeek);
    if (problem) return fail('price_per_week', problem);
  }

  const includes = parseIncludes(b.rental_includes);
  if (!includes.ok) return fail('rental_includes', includes.error);

  const location = optionalText(b.location, LIMITS.location);
  if (!location.ok) return fail('location', `Location is limited to ${LIMITS.location} characters.`);
  if (location.value && looksLikeCoordinates(location.value)) {
    return fail('location', 'Enter a suburb and city, not map coordinates.');
  }

  const evidence = optionalText(b.replacement_value_evidence, LIMITS.evidence);
  if (!evidence.ok) return fail('replacement_value_evidence', `Evidence is limited to ${LIMITS.evidence} characters.`);
  if (evidence.value && /^[a-z]+:/i.test(evidence.value) && !isHttpsUrl(evidence.value)) {
    return fail('replacement_value_evidence', 'An evidence link must start with https://');
  }

  const gallery = parseGallery(b.gallery);
  if (!gallery.ok) return fail('gallery', gallery.error);

  const cover = resolveCover(gallery.value, b.thumbnail_url, b.cover_public_id);
  if (!cover.ok) return fail('thumbnail_url', "Choose the cover from this listing's own photos.");

  const aiSuggested = Array.isArray(b.ai_suggested_fields)
    ? Array.from(new Set(b.ai_suggested_fields.filter(isAiSuggestibleField)))
    : [];

  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      category,
      condition: condition.value,
      brand: brand.value,
      model: model.value,
      price_per_day: price.value,
      price_per_week: pricePerWeek,
      replacement_value: replacement.value,
      rental_includes: includes.value,
      serial_number: serial.value,
      location: location.value,
      replacement_value_evidence: evidence.value,
      thumbnail_url: cover.value.thumbnail_url,
      cover_public_id: cover.value.cover_public_id,
      gallery: gallery.value,
      attestations: b.attestations,
      ai_suggested_fields: aiSuggested,
    },
  };
}

/**
 * The refundable deposit for a listing, in rands, from its replacement value
 * (RENTAL_POLICY.depositRateBps). Computed here, never taken from the browser.
 */
export function depositForListing(replacementValueRands: number | null): number | null {
  if (replacementValueRands === null || !(replacementValueRands > 0)) return null;
  return fromCents(depositFor(toCents(replacementValueRands)));
}

const LOCATION_DATA_KEY = /^(gps|exif|geo|lat|latitude|lng|lon|long|longitude|coords?|coordinates|position)(_|$)/i;

/**
 * The listing's metadata blob with the owner's location set and any
 * GPS/EXIF-like keys removed. The location shown to renters is the
 * owner-entered suburb and city only.
 */
export function listingMetadata(existing: unknown, location: string | null): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (LOCATION_DATA_KEY.test(k)) continue;
    out[k] = v;
  }
  out.location = location;
  return out;
}

/** Fields whose stored value differs from the incoming edit (for AI confirmation and re-review). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(after)) {
    if (JSON.stringify(normalise(before[key])) !== JSON.stringify(normalise(after[key]))) changed.push(key);
  }
  return changed;
}

function normalise(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return v;
}
