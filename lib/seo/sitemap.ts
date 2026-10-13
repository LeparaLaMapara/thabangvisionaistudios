import { STUDIO } from '@/lib/constants';
import { SITEMAP_IDS, type SitemapId } from '@/lib/seo/sitemap-registry';
import { loadCatalog } from '@/lib/discovery/catalog';
import { entriesForSitemap } from '@/lib/discovery/registry';

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
 *
 * What goes in each child comes from the discovery registry
 * (lib/discovery/registry.ts), which llms.txt, the catalogue API and the
 * IndexNow sweep read too.
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

/**
 * The entries of one child sitemap, from the discovery registry
 * (lib/discovery/registry.ts) over the cached catalogue.
 */
export async function sitemapEntries(id: SitemapId): Promise<SitemapEntry[]> {
  const catalog = await loadCatalog();
  return entriesForSitemap(catalog, id).map((e) => entry(e.path, e.lastModified, { priority: e.priority }));
}
