import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { SA_CITIES, getRentalCities, type SACity } from '@/lib/seo/cities';
import { creatorMatchesCategory } from '@/lib/seo/creator-url';
import { rentalCategoryStats } from '@/lib/discovery/registry';
import { absUrl, primaryDownloads } from '@/lib/discovery/format';
import type { Catalog, CatalogCreator, CatalogRental, CatalogTool } from '@/lib/discovery/types';

/**
 * The public, read-only catalogue: JSON shapes and search, shared by the
 * /v1 API (app/v1/...) and the MCP server (lib/discovery/mcp.ts) so both
 * always answer the same way.
 *
 * Only what public pages show. Every item carries its canonical page URL:
 * booking and payment happen on the site, never through this API.
 */

export const API_VERSION = 'v1';
export const API_MAX_LIMIT = 100;
export const API_DEFAULT_LIMIT = 25;
/** Requests per minute per IP, per surface. Generous for agents, a wall for scrapers. */
export const DISCOVERY_RATE_LIMITS = {
  api: { max: 60, windowMs: 60_000 },
  mcp: { max: 60, windowMs: 60_000 },
} as const;

/** Most items whose availability one request may check (each check reads bookings). */
export const AVAILABILITY_CHECK_CAP = 30;

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface RentalJson {
  id: string;
  slug: string;
  title: string;
  category: string;
  category_label: string | null;
  brand: string | null;
  model: string | null;
  currency: 'ZAR';
  price_per_day_zar: number | null;
  price_per_week_zar: number | null;
  deposit_zar: number | null;
  listed_as_available: boolean;
  units: number;
  supplied_by: 'thabangvision' | 'verified_member';
  includes: string[];
  description: string | null;
  image: string | null;
  url: string;
  markdown_url: string;
  updated_at: string | null;
  /** Only when dates were asked for: whether the item is free on those dates. */
  available_for_dates?: boolean | null;
}

export function rentalJson(r: CatalogRental): RentalJson {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    category_label: r.categoryLabel,
    brand: r.brand,
    model: r.model,
    currency: 'ZAR',
    price_per_day_zar: r.pricePerDay,
    price_per_week_zar: r.pricePerWeek && r.pricePerWeek > 0 ? r.pricePerWeek : null,
    deposit_zar: r.deposit && r.deposit > 0 ? r.deposit : null,
    listed_as_available: r.isAvailable,
    units: r.quantity,
    supplied_by: r.ownerType === 'community' ? 'verified_member' : 'thabangvision',
    includes: r.includes,
    description: r.description,
    image: r.image,
    url: absUrl(r.path),
    markdown_url: `${absUrl(r.path)}.md`,
    updated_at: r.updatedAt,
  };
}

export interface CreatorJson {
  handle: string;
  name: string;
  category: string;
  specializations: string[];
  location: string | null;
  cities: string[];
  currency: 'ZAR';
  hourly_rate_zar: number | null;
  years_experience: number | null;
  verified: true;
  bio: string | null;
  avatar: string | null;
  url: string;
  markdown_url: string;
}

export function creatorJson(p: CatalogCreator): CreatorJson {
  return {
    handle: p.handle,
    name: p.name,
    category: p.category,
    specializations: p.specializations,
    location: p.location,
    cities: p.citySlugs,
    currency: 'ZAR',
    hourly_rate_zar: p.hourlyRate,
    years_experience: p.yearsExperience,
    verified: true,
    bio: p.bio,
    avatar: p.avatar,
    url: absUrl(p.path),
    markdown_url: `${absUrl(p.path)}.md`,
  };
}

export interface ToolJson {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  capabilities: string[];
  licence: string;
  price_zar: 0;
  web_url: string;
  source_url: string;
  version: string | null;
  published: string | null;
  downloads: { platform: string; label: string; url: string }[];
  url: string;
  markdown_url: string;
}

export function toolJson(t: CatalogTool): ToolJson {
  return {
    slug: t.slug,
    name: t.name,
    category: t.category,
    tagline: t.tagline,
    capabilities: t.capabilities,
    licence: t.licence,
    price_zar: 0,
    web_url: t.webUrl,
    source_url: t.repoUrl,
    version: t.version,
    published: t.published,
    downloads: primaryDownloads(t),
    url: absUrl(t.path),
    markdown_url: `${absUrl(t.path)}.md`,
  };
}

export function categoriesJson(c: Catalog): {
  rentals: { slug: string; label: string; description: string; items: number; url: string }[];
  studio: { slug: string; name: string; description: string | null; creators: number; url: string }[];
} {
  const stats = new Map(rentalCategoryStats(c).map((s) => [s.value, s.count]));
  return {
    rentals: RENTAL_CATEGORIES.filter((x) => (stats.get(x.value) ?? 0) > 0).map((x) => ({
      slug: x.value,
      label: x.label,
      description: x.description,
      items: stats.get(x.value) ?? 0,
      url: absUrl(`/rentals/${x.value}`),
    })),
    studio: c.studioOn
      ? c.studioCategories.map((s) => ({
          slug: s.slug,
          name: s.name,
          description: s.description,
          creators: c.creators.filter((p) => creatorMatchesCategory(p.specializations, s)).length,
          url: absUrl(s.path),
        }))
      : [],
  };
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** A city from free text: slug, name or alias, case-insensitive. */
export function findCity(text: string | null | undefined): SACity | null {
  const t = (text ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!t) return null;
  return (
    SA_CITIES.find(
      (c) => c.slug === t || c.name.toLowerCase().replace(/\s+/g, '-') === t || c.aliases.includes(t.replace(/-/g, '')),
    ) ?? null
  );
}

export type DateRange = { start: string; end: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a requested hire period. Returns the range or a plain-words error. */
export function parseDates(start: string | null | undefined, end: string | null | undefined, today: string): DateRange | { error: string } | null {
  if (!start && !end) return null;
  const s = (start ?? '').trim();
  const e = (end ?? s).trim();
  if (!ISO_DAY.test(s) || !ISO_DAY.test(e) || Number.isNaN(Date.parse(s)) || Number.isNaN(Date.parse(e))) {
    return { error: 'Dates must be YYYY-MM-DD.' };
  }
  if (e < s) return { error: 'The end date is before the start date.' };
  if (s < today) return { error: 'The start date is in the past.' };
  const days = Math.round((Date.parse(e) - Date.parse(s)) / 86_400_000) + 1;
  if (days > STUDIO.rental.maxBookingDays) return { error: `At most ${STUDIO.rental.maxBookingDays} days at a time.` };
  return { start: s, end: e };
}

function tokens(q: string | null | undefined): string[] {
  return (q ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .slice(0, 8);
}

function matchScore(fields: { text: string | null | undefined; weight: number }[], terms: string[]): number {
  if (terms.length === 0) return 1;
  let score = 0;
  for (const term of terms) {
    let hit = 0;
    for (const f of fields) if ((f.text ?? '').toLowerCase().includes(term)) hit = Math.max(hit, f.weight);
    if (hit === 0) return 0;
    score += hit;
  }
  return score;
}

export function clampLimit(raw: unknown, fallback = API_DEFAULT_LIMIT): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), API_MAX_LIMIT);
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface RentalSearch {
  query?: string | null;
  category?: string | null;
  city?: string | null;
  dates?: DateRange | null;
  limit?: number;
  offset?: number;
}

/** Whether one item is free on the dates; injected so tests need no database. */
export type AvailabilityCheck = (r: CatalogRental, dates: DateRange) => Promise<boolean>;

export interface RentalSearchResult {
  total: number;
  items: RentalJson[];
  notes: string[];
}

export async function searchRentals(c: Catalog, s: RentalSearch, check?: AvailabilityCheck): Promise<RentalSearchResult> {
  const notes: string[] = [];
  let rows = c.rentals;

  if (s.category) {
    const cat = RENTAL_CATEGORIES.find((x) => x.value === s.category || x.label.toLowerCase() === s.category?.toLowerCase());
    rows = cat ? rows.filter((r) => r.category === cat.value) : [];
    if (!cat) notes.push(`Unknown category. Use one of: ${RENTAL_CATEGORIES.map((x) => x.value).join(', ')}.`);
  }

  if (s.city) {
    const city = findCity(s.city);
    const reached = city ? getRentalCities().some((x) => x.slug === city.slug) : false;
    if (!reached) {
      rows = [];
      notes.push(
        `${STUDIO.name} rents gear in ${STUDIO.serviceArea.province}: collection in ${STUDIO.location.city} or delivery within reach. ${STUDIO.serviceArea.outsideProvinceNote}`,
      );
    }
  }

  const terms = tokens(s.query);
  const scored = rows
    .map((r) => ({
      r,
      score: matchScore(
        [
          { text: r.title, weight: 3 },
          { text: `${r.brand ?? ''} ${r.model ?? ''}`, weight: 3 },
          { text: `${r.categoryLabel ?? ''} ${r.category}`, weight: 2 },
          { text: `${r.description ?? ''} ${r.includes.join(' ')}`, weight: 1 },
        ],
        terms,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.rankingScore - a.r.rankingScore);

  let list = scored.map((x) => x.r);
  const availability = new Map<string, boolean | null>();
  if (s.dates) {
    list = list.filter((r) => r.isAvailable);
    if (!check) {
      notes.push('Availability for dates is not checked here; pick the dates on the item page.');
    } else {
      const toCheck = list.slice(0, AVAILABILITY_CHECK_CAP);
      if (list.length > toCheck.length) notes.push(`Dates were checked for the first ${AVAILABILITY_CHECK_CAP} matches only. Narrow the search for more.`);
      const results = await Promise.all(toCheck.map((r) => check(r, s.dates as DateRange).catch(() => null)));
      toCheck.forEach((r, i) => availability.set(r.id, results[i]));
      list = toCheck.filter((r) => availability.get(r.id) !== false);
      notes.push('Availability is a snapshot; the item page confirms it when you book.');
    }
  }

  const offset = Math.max(0, Math.floor(s.offset ?? 0));
  const limit = clampLimit(s.limit);
  return {
    total: list.length,
    items: list.slice(offset, offset + limit).map((r) => ({
      ...rentalJson(r),
      ...(s.dates ? { available_for_dates: availability.get(r.id) ?? null } : {}),
    })),
    notes,
  };
}

export function findRental(c: Catalog, idOrSlug: string): CatalogRental | null {
  const key = idOrSlug.trim();
  return c.rentals.find((r) => r.id === key || r.slug === key || r.path === key) ?? null;
}

export interface CreatorSearch {
  query?: string | null;
  category?: string | null;
  city?: string | null;
  limit?: number;
  offset?: number;
}

export function searchCreators(c: Catalog, s: CreatorSearch): { total: number; items: CreatorJson[]; notes: string[] } {
  const notes: string[] = [];
  if (!c.studioOn) return { total: 0, items: [], notes: ['Creator bookings are switched off right now.'] };
  let rows = c.creators;
  if (s.category) {
    const cat = c.studioCategories.find((x) => x.slug === s.category || x.name.toLowerCase() === s.category?.toLowerCase());
    rows = cat
      ? rows.filter((p) => creatorMatchesCategory(p.specializations, cat))
      : rows.filter((p) => p.specializations.some((x) => x.toLowerCase() === s.category?.toLowerCase()));
  }
  if (s.city) {
    const city = findCity(s.city);
    const want = (s.city ?? '').trim().toLowerCase();
    rows = rows.filter((p) => (city ? p.citySlugs.includes(city.slug) : (p.location ?? '').toLowerCase().includes(want)));
  }
  const terms = tokens(s.query);
  const list = rows
    .map((p) => ({
      p,
      score: matchScore(
        [
          { text: p.name, weight: 3 },
          { text: p.specializations.join(' '), weight: 2 },
          { text: `${p.location ?? ''} ${p.bio ?? ''}`, weight: 1 },
        ],
        terms,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
  const offset = Math.max(0, Math.floor(s.offset ?? 0));
  const limit = clampLimit(s.limit);
  if (list.length === 0) notes.push(`No match. All creators: ${absUrl('/smart-creators')}`);
  return { total: list.length, items: list.slice(offset, offset + limit).map(creatorJson), notes };
}

export function findCreator(c: Catalog, handle: string): CatalogCreator | null {
  if (!c.studioOn) return null;
  const key = handle.trim();
  return c.creators.find((p) => p.handle === key || p.id === key || p.path === key) ?? null;
}

export function findTool(c: Catalog, slug: string): CatalogTool | null {
  return c.tools.find((t) => t.slug === slug.trim().toLowerCase()) ?? null;
}

/** Plain-words booking guide, for agents. Built from the same answers as the FAQ page. */
export function howToBook(answers: { id: string; question: string; answer: string }[]): {
  steps: string[];
  gear_url: string;
  creators_url: string;
  faq_url: string;
  contact: { email: string; whatsapp: string };
  rules: { question: string; answer: string }[];
} {
  const pick = (id: string) => answers.find((a) => a.id === id);
  const keep = ['core-how-rent', 'core-notice', 'core-collect-deliver', 'core-deposit', 'core-id', 'core-cancel', 'core-photographer', 'core-payment', 'core-vat'];
  return {
    steps: [
      'Find the item or creator (search_gear, search_creators) and send the person to its url.',
      pick('core-how-rent')?.answer ?? 'Open the item, pick dates, and book on the page.',
      `Bookings, payment and the ID check happen on ${STUDIO.meta.url}; this server cannot book or pay.`,
    ],
    gear_url: absUrl('/rentals'),
    creators_url: absUrl('/smart-creators'),
    faq_url: absUrl('/faq'),
    contact: { email: STUDIO.email, whatsapp: STUDIO.whatsapp.display },
    rules: keep.map(pick).filter((x): x is { id: string; question: string; answer: string } => !!x).map(({ question, answer }) => ({ question, answer })),
  };
}

