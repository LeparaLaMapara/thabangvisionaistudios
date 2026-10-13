import { STUDIO, PRODUCTION_CATEGORIES, UBUNYE_STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { getFlag } from '@/lib/features';
import { getUbunyeRelease } from '@/lib/ubunye-release';
import { SITEMAP_IDS, SITEMAP_ROUTES, type SitemapId } from '@/lib/seo/sitemap-registry';
import {
  newest,
  stockedRentalCategories,
  rentalCityPages,
  creatorProfilePaths,
  listedCreators,
  studioCityPages,
  type CreatorRow,
  type RentalRow,
} from '@/lib/seo/inventory';

/**
 * The sitemap, split by kind of page: /sitemap.xml is an index
 * (app/sitemap.xml/route.ts) of child sitemaps at /sitemap/<id>.xml
 * (app/sitemap/[id]/route.ts), one per id in SITEMAP_IDS.
 *
 * Route handlers, not Next's sitemap.ts convention: generateSitemaps writes
 * no index, and Next refuses a /sitemap.xml route beside a sitemap.ts.
 *
 * Rules:
 *   - only indexable pages: no login, register, unsubscribe or other noindex
 *     page (lib/seo/sitemap-registry.ts NOT_IN_SITEMAP);
 *   - lastModified only where it is real (a row's updated_at, a release's
 *     date); static pages leave it out rather than claim "changed today";
 *   - category and city pages only where real stock or a real creator serves
 *     them (lib/seo/inventory.ts).
 */
export type SitemapEntry = {
  url: string;
  lastModified?: string;
  priority?: number;
};

export function isSitemapId(id: string): id is SitemapId {
  return (SITEMAP_IDS as readonly string[]).includes(id);
}

const base = STUDIO.meta.url;
const abs = (path: string): string => `${base}${path === '/' ? '' : path}`;
const enc = encodeURIComponent;

type Entry = SitemapEntry;

function entry(path: string, lastModified?: string | null, extra: Partial<Entry> = {}): Entry {
  return { url: abs(path), ...(lastModified ? { lastModified } : {}), ...extra };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A <urlset> document for some entries. */
export function toUrlsetXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const parts = [`<loc>${xmlEscape(e.url)}</loc>`];
    if (e.lastModified) parts.push(`<lastmod>${xmlEscape(new Date(e.lastModified).toISOString())}</lastmod>`);
    if (typeof e.priority === 'number') parts.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    return `  <url>${parts.join('')}</url>`;
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
}

/** The <sitemapindex> document listing every child sitemap. */
export function toIndexXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...SITEMAP_IDS.map((id) => `  <sitemap><loc>${xmlEscape(`${base}/sitemap/${id}.xml`)}</loc></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n');
}

/** Static routes listed in the registry under `static`. */
function staticEntries(): SitemapEntry[] {
  return Object.entries(SITEMAP_ROUTES)
    .filter(([route, id]) => id === 'static' && !route.includes('['))
    .map(([route]) => entry(route, null, { priority: route === '/' ? 1 : 0.6 }));
}

async function rentalEntries(): Promise<SitemapEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('smart_rentals')
    .select('category, slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);
  if (error) console.error('[sitemap:rentals]', error.message);
  const rows = (data ?? []) as RentalRow[];

  const items = rows
    .filter((r) => r.category && r.slug)
    .map((r) => entry(`/rentals/${enc(r.category as string)}/${enc(r.slug)}`, r.updated_at, { priority: 0.7 }));
  const categories = stockedRentalCategories(rows).map((c) =>
    entry(`/rentals/${enc(c.value)}`, c.lastModified, { priority: 0.8 }),
  );
  const cities = rentalCityPages(rows).map((p) =>
    entry(`/rentals/${enc(p.category)}/in/${p.city}`, p.lastModified, { priority: 0.6 }),
  );
  const index = rows.length > 0 ? [entry('/rentals', newest(rows.map((r) => r.updated_at)), { priority: 0.9 })] : [];
  return [...index, ...categories, ...items, ...cities];
}

const CREATOR_COLUMNS =
  'id, crew_slug, specializations, location, verification_status, available_for_hire, portfolio_projects';

async function readCreators(): Promise<CreatorRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('public_profiles')
    .select(CREATOR_COLUMNS)
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true);
  if (error) console.error('[sitemap:creators]', error.message);
  return (data ?? []) as unknown as CreatorRow[];
}

async function creatorEntries(): Promise<SitemapEntry[]> {
  const supabase = createAdminClient();
  const creators = await readCreators();
  const listedIds = new Set(listedCreators(creators).map((c) => c.id));

  // Members who are not bookable creators but have community gear for hire:
  // their /creators/<id> page is indexable (app/(platform)/creators/[id]).
  const { data: owners } = await supabase
    .from('smart_rentals')
    .select('owner_id, updated_at')
    .eq('is_published', true)
    .eq('owner_type', 'community')
    .is('deleted_at', null);
  const ownerLatest = new Map<string, string | null>();
  for (const o of (owners ?? []) as { owner_id: string | null; updated_at: string | null }[]) {
    if (!o.owner_id || listedIds.has(o.owner_id)) continue;
    ownerLatest.set(o.owner_id, newest([ownerLatest.get(o.owner_id), o.updated_at]) ?? null);
  }

  // /smart-creators is the list; only listed while it has someone on it.
  const list = listedIds.size > 0 ? [entry('/smart-creators', null, { priority: 0.8 })] : [];
  // Creator profiles are under /studio, which the smart_productions flag can
  // switch off (the whole /studio tree then 404s).
  const studioOn = await getFlag('smart_productions');
  const profiles = studioOn ? creatorProfilePaths(creators).map((p) => entry(p, null, { priority: 0.7 })) : [];
  const members = [...ownerLatest].map(([id, updated]) => entry(`/creators/${id}`, updated, { priority: 0.4 }));
  return [...list, ...profiles, ...members];
}

async function studioEntries(): Promise<SitemapEntry[]> {
  if (!(await getFlag('smart_productions'))) return [];
  const supabase = createAdminClient();

  const [{ data: productions }, { data: categories }, creators] = await Promise.all([
    supabase.from('smart_productions').select('slug, updated_at').eq('is_published', true).is('deleted_at', null),
    supabase.from('production_categories').select('slug, creator_keywords, updated_at').eq('is_published', true),
    readCreators(),
  ]);

  const prodRows = (productions ?? []) as { slug: string; updated_at: string | null }[];
  const catRows = (categories ?? []) as { slug: string; creator_keywords: string[] | null; updated_at: string | null }[];
  // The category pages read the database row first and fall back to the
  // constants, so the sitemap does the same.
  const cats = catRows.length > 0
    ? catRows.map((c) => ({
        slug: c.slug,
        creatorKeywords:
          (c.creator_keywords && c.creator_keywords.length > 0
            ? c.creator_keywords
            : PRODUCTION_CATEGORIES.find((p) => p.slug === c.slug)?.creatorKeywords) ?? [],
        updated_at: c.updated_at,
      }))
    : PRODUCTION_CATEGORIES.map((c) => ({ slug: c.slug, creatorKeywords: c.creatorKeywords, updated_at: null }));

  return [
    entry('/studio', newest(prodRows.map((p) => p.updated_at)), { priority: 0.9 }),
    ...cats.map((c) => entry(`/studio/category/${enc(c.slug)}`, c.updated_at, { priority: 0.8 })),
    ...prodRows.map((p) => entry(`/studio/${enc(p.slug)}`, p.updated_at, { priority: 0.7 })),
    ...studioCityPages(creators, cats).map((p) =>
      entry(`/studio/category/${enc(p.category)}/in/${p.city}`, null, { priority: 0.6 }),
    ),
  ];
}

async function pressEntries(): Promise<SitemapEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('press')
    .select('slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);
  if (error) console.error('[sitemap:press]', error.message);
  const rows = (data ?? []) as { slug: string; updated_at: string | null }[];
  return [
    entry('/press', newest(rows.map((r) => r.updated_at)), { priority: 0.6 }),
    ...rows.map((r) => entry(`/press/${enc(r.slug)}`, r.updated_at, { priority: 0.5 })),
  ];
}

async function marketplaceEntries(): Promise<SitemapEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('listings')
    .select('slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);
  if (error) console.error('[sitemap:marketplace]', error.message);
  const rows = (data ?? []) as { slug: string; updated_at: string | null }[];
  if (rows.length === 0) return [];
  return [
    entry('/marketplace', newest(rows.map((r) => r.updated_at)), { priority: 0.6 }),
    ...rows.map((r) => entry(`/marketplace/${enc(r.slug)}`, r.updated_at, { priority: 0.5 })),
  ];
}

async function toolEntries(): Promise<SitemapEntry[]> {
  const releases = await Promise.all(UBUNYE_STUDIO.apps.map((a) => getUbunyeRelease(a.slug)));
  const apps = UBUNYE_STUDIO.apps.map((a, i) =>
    entry(`/tools/${a.slug}`, releases[i]?.published ?? null, { priority: 0.6 }),
  );
  return [entry('/tools', newest(releases.map((r) => r?.published)), { priority: 0.6 }), ...apps];
}

/** The entries of one child sitemap. */
export async function sitemapEntries(id: SitemapId): Promise<SitemapEntry[]> {
  switch (id) {
    case 'static':
      return staticEntries();
    case 'rentals':
      return rentalEntries();
    case 'creators':
      return creatorEntries();
    case 'studio':
      return studioEntries();
    case 'press':
      return pressEntries();
    case 'marketplace':
      return marketplaceEntries();
    case 'tools':
      return toolEntries();
    default:
      return [];
  }
}
