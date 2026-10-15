import { ON_SITE_RENTAL } from '@/lib/constants';

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
