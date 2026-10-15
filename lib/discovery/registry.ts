import { STUDIO, UBUNYE_STUDIO, getUbunyeApp } from '@/lib/constants';
import { SITEMAP_ROUTES, type SitemapId } from '@/lib/seo/sitemap-registry';
import { getRentalCities, LISTED_CITIES } from '@/lib/seo/cities';
import { newest } from '@/lib/seo/inventory';
import { creatorMatchesCategory } from '@/lib/seo/creator-url';
import { productJsonLd, personJsonLd } from '@/lib/seo/structured-data';
import { ubunyeAppJsonLd } from '@/lib/seo/ubunye-app-jsonld';
import type { Catalog } from '@/lib/discovery/types';

/**
 * The discovery registry: one entry per kind of public page.
 *
 * Each entity says which route patterns it owns, which child sitemap lists it,
 * how to list its URLs (with real lastmod dates) from the catalogue, and,
 * where a builder exists, its JSON-LD. The sitemap, llms.txt and
 * llms-full.txt, the daily IndexNow sweep and notifyDiscovery's "is this
 * indexable" check all read this list, so a new kind of page registers here
 * once and shows up everywhere.
 *
 * tests/unit/discovery-registry.test.ts fails when a route in SITEMAP_ROUTES
 * (lib/seo/sitemap-registry.ts) is owned by no entity, or by an entity filed
 * under a different sitemap. The #90 test already fails when a public page is
 * in neither SITEMAP_ROUTES nor NOT_IN_SITEMAP.
 */

export type DiscoveryEntry = {
  /** Path on the site, starting with "/". */
  path: string;
  /** Real last change (ISO), only when known. */
  lastModified?: string;
  priority?: number;
  /** Short human name, used by llms-full.txt. */
  title?: string;
};

export type JsonLd = Record<string, unknown>;

export interface DiscoveryEntity {
  /** Stable id for this kind of page. */
  type: string;
  /** Plain words for docs and llms-full.txt headings. */
  label: string;
  sitemap: SitemapId;
  /** Route patterns (as in SITEMAP_ROUTES) this entity owns. */
  routes: string[];
  /** Every URL of this kind that should be indexed right now. */
  entries(c: Catalog): DiscoveryEntry[];
  /** schema.org JSON-LD for one page of this kind, by path. */
  jsonLd?(c: Catalog, path: string): JsonLd | null;
  /** Whether this kind of page has a markdown twin at <path>.md (lib/discovery/markdown.ts). */
  markdownTwin?: boolean;
}

const enc = encodeURIComponent;
const abs = (path: string): string => `${STUDIO.meta.url}${path === '/' ? '' : path}`;

function entry(path: string, lastModified: string | null | undefined, priority: number, title?: string): DiscoveryEntry {
  return { path, ...(lastModified ? { lastModified } : {}), priority, ...(title ? { title } : {}) };
}

const staticRoutes = (): string[] =>
  Object.entries(SITEMAP_ROUTES)
    .filter(([route, id]) => id === 'static' && !route.includes('['))
    .map(([route]) => route);

/** Rental categories that have stock, with counts and newest change. */
export function rentalCategoryStats(c: Catalog): { value: string; label: string; count: number; lastModified?: string }[] {
  const by = new Map<string, { label: string; count: number; dates: (string | null)[] }>();
  for (const r of c.rentals) {
    const cur = by.get(r.category) ?? { label: r.categoryLabel ?? r.category, count: 0, dates: [] };
    cur.count += 1;
    cur.dates.push(r.updatedAt);
    by.set(r.category, cur);
  }
  return [...by].map(([value, s]) => ({ value, label: s.label, count: s.count, lastModified: newest(s.dates) }));
}

export const DISCOVERY_ENTITIES: DiscoveryEntity[] = [
  {
    type: 'static',
    label: 'Main pages',
    sitemap: 'static',
    routes: staticRoutes(),
    entries: () => staticRoutes().map((r) => entry(r, null, r === '/' ? 1 : 0.6)),
    markdownTwin: true, // only /faq has one; markdown.ts decides per path
  },
  {
    type: 'rental-index',
    label: 'All rentals',
    sitemap: 'rentals',
    routes: ['/rentals'],
    entries: (c) => (c.rentals.length > 0 ? [entry('/rentals', newest(c.rentals.map((r) => r.updatedAt)), 0.9, 'Equipment rentals')] : []),
  },
  {
    type: 'rental-category',
    label: 'Rental categories',
    sitemap: 'rentals',
    routes: ['/rentals/[category]'],
    entries: (c) => rentalCategoryStats(c).map((s) => entry(`/rentals/${enc(s.value)}`, s.lastModified, 0.8, s.label)),
    markdownTwin: true,
  },
  {
    type: 'rental',
    label: 'Gear for hire',
    sitemap: 'rentals',
    routes: ['/rentals/[category]/[slug]'],
    entries: (c) => c.rentals.map((r) => entry(r.path, r.updatedAt, 0.7, r.title)),
    jsonLd: (c, path) => {
      const r = c.rentals.find((x) => x.path === path);
      return r
        ? productJsonLd({
            title: r.title,
            slug: r.slug,
            category: r.category,
            categoryLabel: r.categoryLabel,
            description: r.description,
            price_per_day: r.pricePerDay,
            thumbnail_url: r.image,
            is_available: r.isAvailable,
            brand: r.brand,
            model: r.model,
          })
        : null;
    },
    markdownTwin: true,
  },
  {
    type: 'rental-city',
    label: 'Rentals by city',
    sitemap: 'rentals',
    routes: ['/rentals/[category]/in/[city]'],
    entries: (c) => {
      const cities = getRentalCities();
      return rentalCategoryStats(c).flatMap((s) =>
        cities.map((city) => entry(`/rentals/${enc(s.value)}/in/${city.slug}`, s.lastModified, 0.6, `${s.label} in ${city.name}`)),
      );
    },
  },
  {
    type: 'creator-list',
    label: 'Creators list',
    sitemap: 'creators',
    routes: ['/smart-creators'],
    // With People on, /smart-creators redirects to /people.
    entries: (c) => (c.creators.length > 0 && !c.rolesOn ? [entry('/smart-creators', null, 0.8, 'Creators')] : []),
  },
  {
    type: 'creator',
    label: 'Creators',
    sitemap: 'creators',
    routes: ['/studio/category/[slug]/[id]'],
    // Creator profiles live under /studio, which the smart_productions flag can switch off.
    entries: (c) => (c.studioOn && !c.rolesOn ? c.creators.map((p) => entry(p.path, null, 0.7, p.name)) : []),
    jsonLd: (c, path) => {
      const p = c.creators.find((x) => x.path === path);
      return p
        ? personJsonLd({
            display_name: p.name,
            url: abs(p.path),
            specializations: p.specializations,
            location: p.location,
            avatar_url: p.avatar,
            description: p.bio,
          })
        : null;
    },
    markdownTwin: true,
  },
  {
    type: 'member',
    label: 'Members with gear for hire',
    sitemap: 'creators',
    routes: ['/creators/[id]'],
    entries: (c) => c.members.map((m) => entry(m.path, m.updatedAt, 0.4)),
  },
  {
    type: 'studio-index',
    label: 'Studio',
    sitemap: 'studio',
    routes: ['/studio'],
    // With People on, /studio redirects to /people.
    entries: (c) => (c.studioOn && !c.rolesOn ? [entry('/studio', newest(c.productions.map((p) => p.updatedAt)), 0.9, 'Studio')] : []),
  },
  {
    type: 'studio-category',
    label: 'Studio categories',
    sitemap: 'studio',
    routes: ['/studio/category/[slug]'],
    // With People on, every /studio/category page redirects to /people.
    entries: (c) => (c.studioOn && !c.rolesOn ? c.studioCategories.map((s) => entry(s.path, s.updatedAt, 0.8, s.name)) : []),
    markdownTwin: true,
  },
  {
    type: 'production',
    label: 'Studio packages and past work',
    sitemap: 'studio',
    routes: ['/studio/[slug]'],
    entries: (c) => (c.studioOn ? c.productions.map((p) => entry(p.path, p.updatedAt, 0.7, p.title)) : []),
  },
  {
    type: 'studio-city',
    label: 'Studio by city',
    sitemap: 'studio',
    routes: ['/studio/category/[slug]/in/[city]'],
    entries: (c) => (c.studioOn && !c.rolesOn ? studioCityPagesOf(c).map((p) => entry(`/studio/category/${enc(p.category)}/in/${p.city}`, null, 0.6)) : []),
  },
  {
    type: 'press-index',
    label: 'Press',
    sitemap: 'press',
    routes: ['/press'],
    entries: (c) => [entry('/press', newest(c.press.map((p) => p.updatedAt)), 0.6, 'Press')],
  },
  {
    type: 'press',
    label: 'Press articles',
    sitemap: 'press',
    routes: ['/press/[slug]'],
    entries: (c) => c.press.map((p) => entry(p.path, p.updatedAt, 0.5, p.title)),
    markdownTwin: true,
  },
  {
    type: 'marketplace-index',
    label: 'Marketplace',
    sitemap: 'marketplace',
    routes: ['/marketplace'],
    entries: (c) => (c.listings.length > 0 ? [entry('/marketplace', newest(c.listings.map((l) => l.updatedAt)), 0.6, 'Marketplace')] : []),
  },
  {
    type: 'marketplace-listing',
    label: 'Marketplace listings',
    sitemap: 'marketplace',
    routes: ['/marketplace/[slug]'],
    entries: (c) => c.listings.map((l) => entry(l.path, l.updatedAt, 0.5, l.title)),
  },
  {
    type: 'tools-index',
    label: UBUNYE_STUDIO.suiteName,
    sitemap: 'tools',
    routes: ['/tools'],
    entries: (c) => [entry('/tools', newest(c.tools.map((t) => t.published)), 0.6, UBUNYE_STUDIO.suiteName)],
    markdownTwin: true,
  },
  {
    type: 'tool',
    label: 'Free tools',
    sitemap: 'tools',
    routes: ['/tools/[app]'],
    entries: (c) => c.tools.map((t) => entry(t.path, t.published, 0.6, t.name)),
    jsonLd: (c, path) => {
      const t = c.tools.find((x) => x.path === path);
      const app = t ? getUbunyeApp(t.slug) : undefined;
      if (!t || !app) return null;
      return ubunyeAppJsonLd(
        app,
        t.version && t.published ? { app: t.slug, version: t.version, published: t.published, files: t.files } : null,
      );
    },
    markdownTwin: true,
  },
];

/**
 * Studio category x city pages: at least one listed creator in that category
 * based in that city. The same rule as studioCityPages in lib/seo/inventory.ts,
 * applied to catalogue creators (already filtered to listed ones).
 */
export function studioCityPagesOf(c: Catalog): { category: string; city: string }[] {
  const out: { category: string; city: string }[] = [];
  for (const cat of c.studioCategories) {
    const inCat = c.creators.filter((p) => creatorMatchesCategory(p.specializations, cat));
    for (const city of LISTED_CITIES) {
      if (inCat.some((p) => p.citySlugs.includes(city.slug))) out.push({ category: cat.slug, city: city.slug });
    }
  }
  return out;
}

/** Every indexable URL path of one child sitemap. */
export function entriesForSitemap(c: Catalog, id: SitemapId): DiscoveryEntry[] {
  return DISCOVERY_ENTITIES.filter((e) => e.sitemap === id).flatMap((e) => e.entries(c));
}

/** Every indexable URL path on the site. */
export function allEntries(c: Catalog): DiscoveryEntry[] {
  return DISCOVERY_ENTITIES.flatMap((e) => e.entries(c));
}

// ─── Route matching ─────────────────────────────────────────────────────────

type CompiledRoute = { route: string; re: RegExp; statics: number };

const COMPILED: CompiledRoute[] = Object.keys(SITEMAP_ROUTES).map((route) => {
  const segs = route.split('/').filter(Boolean);
  const re = new RegExp(`^/${segs.map((s) => (s.startsWith('[') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
  return { route, re: route === '/' ? /^\/$/ : re, statics: segs.filter((s) => !s.startsWith('[')).length };
});

/**
 * The SITEMAP_ROUTES pattern a concrete path belongs to, or null when the
 * path is not an indexable page. Static segments win over dynamic ones, so
 * /rentals/cameras-optics/in/johannesburg is a city page, not an item.
 */
export function routeOf(path: string): string | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const hits = COMPILED.filter((c) => c.re.test(clean));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.statics - a.statics);
  return hits[0].route;
}

/** The registered entity that owns a concrete path. */
export function entityOf(path: string): DiscoveryEntity | null {
  const route = routeOf(path);
  if (!route) return null;
  return DISCOVERY_ENTITIES.find((e) => e.routes.includes(route)) ?? null;
}
