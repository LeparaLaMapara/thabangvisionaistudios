import { ON_SITE_RENTAL, RENTAL_POLICY } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

/**
 * Places for hire (the Studios category): pure rules shared by the pages, the
 * cart and the checkout. See ON_SITE_RENTAL in lib/constants.ts.
 */

/** Whether a rental category is a place used where it is (never delivered). */
export function isOnSiteCategory(category: string | null | undefined): boolean {
  return !!category && ON_SITE_RENTAL.categories.includes(category);
}

/** Whether any of these rentals is a place, so the order cannot be delivered. */
export function hasOnSiteItem(items: readonly { rental: { category?: string | null } }[]): boolean {
  return items.some((i) => isOnSiteCategory(i.rental.category));
}

/**
 * Whether every item is a place (a studio): then nothing is collected or
 * delivered, and checkout asks no "how do you receive it" question.
 */
export function onlyOnSiteItems(items: readonly { rental: { category?: string | null } }[]): boolean {
  return items.length > 0 && items.every((i) => isOnSiteCategory(i.rental.category));
}

/** What a studio-only cart says instead of the collect or deliver choice. */
export function studioUseNote(place: string, city: string): string {
  return `You use the studio at ${place}, ${city}, on the days you booked. There is nothing to collect or deliver. Bring the ID you verified with.`;
}

/**
 * The half-day price in rands, or null when the listing has none (the option
 * is then not shown). Only places have half days.
 */
export function halfDayPrice(rental: { category?: string | null; price_per_half_day?: number | string | null }): number | null {
  if (!isOnSiteCategory(rental.category)) return null;
  const n = Number(rental.price_per_half_day ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface LoopMedia {
  mp4: string;
  webm: string;
  poster: string;
}

/**
 * A listing's own short silent loop: `video_provider = 'file'` and
 * `video_url` the MP4 under /media/ on this site. The WebM and the poster sit
 * next to it with the same name (`x.mp4`, `x.webm`, `x-poster.webp`). Only
 * same-site paths are accepted, so a row cannot point the page at another
 * server.
 */
export function rentalLoop(rental: { video_provider?: string | null; video_url?: string | null }): LoopMedia | null {
  const url = rental.video_url?.trim();
  if (rental.video_provider !== 'file' || !url) return null;
  if (!/^\/media\/[A-Za-z0-9/_-]+\.mp4$/.test(url) || url.includes('//')) return null;
  const base = url.slice(0, -'.mp4'.length);
  return { mp4: url, webm: `${base}.webm`, poster: `${base}-poster.webp` };
}

export interface RentalVideo {
  /** Same-site MP4 under /media/. */
  url: string;
  /** Same-site still shown before the video plays, or null. */
  poster: string | null;
  /** A short plain name for the video, or null. */
  title: string | null;
}

/** The most videos a listing shows; more is a slow page, not a better one. */
export const MAX_RENTAL_VIDEOS = 6;

const SAME_SITE_MP4 = /^\/media\/[A-Za-z0-9/_-]+\.mp4$/;
const SAME_SITE_STILL = /^\/media\/[A-Za-z0-9/_-]+\.(webp|jpg|jpeg|png)$/;

function sameSite(path: unknown, pattern: RegExp): string | null {
  if (typeof path !== 'string') return null;
  const p = path.trim();
  return pattern.test(p) && !p.includes('//') ? p : null;
}

/**
 * A listing's own videos, in order: `metadata.videos`, a list of
 * `{ url, poster, title }` written by the listing script
 * (scripts/rentals/studio-listing.sql). Entries that are not same-site MP4s
 * under /media/ are dropped, so a row cannot point the page at another
 * server. An empty list means "none", and the page falls back to the single
 * `video_url` loop (rentalLoop), so gear pages are unchanged.
 */
export function rentalVideos(rental: { metadata?: unknown }): RentalVideo[] {
  const meta = rental.metadata;
  if (!meta || typeof meta !== 'object') return [];
  const list = (meta as { videos?: unknown }).videos;
  if (!Array.isArray(list)) return [];
  const out: RentalVideo[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const v = item as { url?: unknown; poster?: unknown; title?: unknown };
    const url = sameSite(v.url, SAME_SITE_MP4);
    if (!url) continue;
    const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 80) : null;
    out.push({ url, poster: sameSite(v.poster, SAME_SITE_STILL), title });
    if (out.length === MAX_RENTAL_VIDEOS) break;
  }
  return out;
}

/**
 * The listing details worth showing as specifications: the plain text and
 * number values of `metadata`. Structured values (such as `videos`) are page
 * data, not specs, so they never show as a row.
 */
export function specEntries(metadata: unknown): [string, string][] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).flatMap(([key, val]): [string, string][] =>
    typeof val === 'string' ? [[key, val]] : typeof val === 'number' && Number.isFinite(val) ? [[key, String(val)]] : [],
  );
}

/**
 * The coming-soon labels still worth showing: a label whose category now has
 * a published listing is real, so its tile goes.
 */
export function comingSoonLabels(
  list: readonly { label: string; category?: string }[],
  rentals: readonly { category: string | null }[],
): string[] {
  const stocked = new Set(rentals.map((r) => r.category));
  return list.filter((c) => !c.category || !stocked.has(c.category)).map((c) => c.label);
}

const rand = (cents: number): string => formatRand(Math.round(cents / 100));

/**
 * What a first-time studio booker needs, in the order checkout checks it
 * (app/api/cart/checkout: the renter checks in lib/rental/eligibility-server).
 * A studio is held against the same "gear at a time" limit as gear, valued
 * as checkout values it (lib/rental/protection itemValue), so the limit line
 * says whether a new account can book this studio and how to raise it.
 */
export function studioNeeds(valueCents: number): string[] {
  const limits = RENTAL_POLICY.trustTierLimitsCents;
  const value = rand(valueCents);
  const limitLine =
    valueCents <= limits.contactable
      ? `New accounts can book up to ${rand(limits.contactable)} at a time. This studio counts as ${value}, so it fits. Gear you book for the same days counts too; a bank account in your own name raises the limit to ${rand(limits.verified)}.`
      : valueCents <= limits.verified
        ? `This studio counts as ${value}. New accounts can book up to ${rand(limits.contactable)} at a time, so you also need a bank account in your own name, which raises the limit to ${rand(limits.verified)}.`
        : `This studio counts as ${value}, more than a new account can book. WhatsApp us and we will arrange it.`;
  return [
    'An account with a confirmed email address and phone number.',
    'A one-time ID check (ID and selfie), approved by a person before you pay.',
    limitLine,
    `Nothing to collect or deliver: you use it at the studio in ${collectionPointWithCity()}.`,
  ];
}
