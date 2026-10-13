import { RENTAL_CATEGORIES, PRODUCTION_CATEGORIES } from '@/lib/constants';
import { getRentalCities, LISTED_CITIES, locationMatchesCity, type SACity } from '@/lib/seo/cities';
import { creatorMatchesCategory, creatorProfilePath, isListedCreator } from '@/lib/seo/creator-url';
import type { PortfolioProject } from '@/types/portfolio';

/**
 * The inventory rule: a category page, or a category in a city, exists (200,
 * indexable, in the sitemap) only while real stock or a real creator serves
 * it. Nothing here is a hard-coded list of pages, so pages appear on their own
 * as stock and creators are added, and disappear when they go.
 *
 * Rentals
 *   /rentals/<category>            at least one published item in it
 *   /rentals/<category>/in/<city>  that, AND the stock reaches the city:
 *                                  collection there, or our delivery radius
 *                                  covers it (lib/seo/cities.ts rentalsReachCity)
 * Studio
 *   /studio/category/<category>/in/<city>
 *                                  at least one listed creator (verified, open
 *                                  for hire, complete portfolio) in that
 *                                  category who is based in that city
 *
 * The pages apply the same rule to their own reads (404 or 308 otherwise);
 * these pure functions are what the sitemap uses, and what the tests pin.
 */

export interface RentalRow {
  category: string | null;
  slug: string;
  updated_at: string | null;
}

export interface CreatorRow {
  id: string;
  crew_slug: string | null;
  specializations: string[] | null;
  location: string | null;
  verification_status: string | null;
  available_for_hire: boolean | null;
  portfolio_projects: PortfolioProject[] | null;
}

/** The newest of some timestamps, or undefined when there are none. */
export function newest(dates: (string | null | undefined)[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const d of dates) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

/** Rental categories with stock, each with its newest item's update time. */
export function stockedRentalCategories(rows: RentalRow[]): { value: string; lastModified?: string }[] {
  return RENTAL_CATEGORIES
    .map((c) => {
      const items = rows.filter((r) => r.category === c.value);
      return { value: c.value, count: items.length, lastModified: newest(items.map((r) => r.updated_at)) };
    })
    .filter((c) => c.count > 0)
    .map(({ value, lastModified }) => ({ value, lastModified }));
}

/** Rental category x city pages that pass the rule. */
export function rentalCityPages(rows: RentalRow[], cities: SACity[] = getRentalCities()): { category: string; city: string; lastModified?: string }[] {
  const out: { category: string; city: string; lastModified?: string }[] = [];
  for (const cat of stockedRentalCategories(rows)) {
    for (const city of cities) out.push({ category: cat.value, city: city.slug, lastModified: cat.lastModified });
  }
  return out;
}

/** Creators who get a public profile page. */
export function listedCreators(rows: CreatorRow[]): CreatorRow[] {
  return rows.filter(isListedCreator);
}

/** Canonical profile paths of the listed creators. */
export function creatorProfilePaths(rows: CreatorRow[]): string[] {
  return listedCreators(rows).map(creatorProfilePath);
}

/** Studio category x city pages that pass the rule. */
export function studioCityPages(
  rows: CreatorRow[],
  categories: { slug: string; creatorKeywords: string[] }[] = PRODUCTION_CATEGORIES,
  cities: SACity[] = LISTED_CITIES,
): { category: string; city: string }[] {
  const creators = listedCreators(rows);
  const out: { category: string; city: string }[] = [];
  for (const cat of categories) {
    const inCat = creators.filter((c) => creatorMatchesCategory(c.specializations, cat));
    for (const city of cities) {
      if (inCat.some((c) => locationMatchesCity(c.location, city))) out.push({ category: cat.slug, city: city.slug });
    }
  }
  return out;
}
