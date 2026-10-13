/**
 * No public page ships undiscoverable.
 *
 * Walks app/ for every page.tsx, works out its route, and checks:
 *   - every public route is either listed in a sitemap (SITEMAP_ROUTES) or
 *     deliberately left out with a reason (NOT_IN_SITEMAP);
 *   - a sitemap route has title + description + canonical, which here means
 *     its page.tsx or layout.tsx builds metadata with buildPageMetadata
 *     (that helper always sets all three) and is not hard-wired noindex;
 *   - a left-out route really is noindex, or really redirects;
 *   - the registry names no route that no longer exists.
 *
 * Adding a page means adding one line to lib/seo/sitemap-registry.ts. That is
 * the point: someone has to decide.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  SITEMAP_ROUTES,
  NOT_IN_SITEMAP,
  PRIVATE_ROUTE_PREFIXES,
  SITEMAP_IDS,
} from '@/lib/seo/sitemap-registry';
import { buildPageMetadata } from '@/lib/seo/metadata';

const APP = join(process.cwd(), 'app');

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'api' && dir === APP) continue;
      out.push(...pageFiles(full));
    } else if (name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

/** app/(platform)/rentals/[category]/page.tsx -> /rentals/[category] */
function routeOf(file: string): string {
  const parts = relative(APP, file).split(sep).slice(0, -1).filter((p) => !/^\(.*\)$/.test(p));
  return `/${parts.join('/')}`;
}

/** The page source plus its own folder's layout, where metadata may live. */
function sourcesOf(file: string): string {
  const layout = join(file, '..', 'layout.tsx');
  return readFileSync(file, 'utf8') + (existsSync(layout) ? `\n${readFileSync(layout, 'utf8')}` : '');
}

const pages = pageFiles(APP).map((file) => ({ file, route: routeOf(file) }));
const isPrivate = (route: string) =>
  PRIVATE_ROUTE_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`));
const publicPages = pages.filter((p) => !isPrivate(p.route));

describe('every public page is wired for discovery', () => {
  it('finds the pages (the walk itself works)', () => {
    expect(publicPages.length).toBeGreaterThan(30);
    expect(publicPages.map((p) => p.route)).toContain('/rentals/[category]/[slug]');
  });

  it.each(publicPages.map((p) => [p.route, p.file] as const))(
    '%s is in a sitemap or deliberately left out',
    (route) => {
      const listed = route in SITEMAP_ROUTES;
      const excluded = route in NOT_IN_SITEMAP;
      expect(
        listed || excluded,
        `${route} is a new public page: add it to SITEMAP_ROUTES or NOT_IN_SITEMAP in lib/seo/sitemap-registry.ts`,
      ).toBe(true);
      expect(listed && excluded, `${route} is in both lists`).toBe(false);
    },
  );

  it.each(publicPages.filter((p) => p.route in SITEMAP_ROUTES).map((p) => [p.route, p.file] as const))(
    '%s has title, description and canonical (buildPageMetadata) and is not noindex',
    (route, file) => {
      const src = sourcesOf(file);
      expect(src, `${route}: build its metadata with buildPageMetadata (lib/seo/metadata.ts)`).toMatch(
        /buildPageMetadata\(/,
      );
      expect(src, `${route} is in the sitemap but hard-wired noindex`).not.toMatch(/noIndex:\s*true|index:\s*false/);
    },
  );

  it.each(publicPages.filter((p) => p.route in NOT_IN_SITEMAP).map((p) => [p.route, p.file] as const))(
    '%s is left out of the sitemap and is really noindex or a redirect',
    (route, file) => {
      const src = sourcesOf(file);
      if (NOT_IN_SITEMAP[route] === 'noindex') {
        expect(src, `${route}: mark it noIndex: true (or robots index: false)`).toMatch(/noIndex:\s*true|index:\s*false/);
      } else {
        expect(src, `${route}: expected a redirect`).toMatch(/\b(permanentRedirect|redirect)\(/);
      }
    },
  );

  it('the registry names only routes that exist', () => {
    const routes = new Set(pages.map((p) => p.route));
    for (const r of [...Object.keys(SITEMAP_ROUTES), ...Object.keys(NOT_IN_SITEMAP)]) {
      expect(routes.has(r), `${r} is in lib/seo/sitemap-registry.ts but has no page.tsx`).toBe(true);
    }
  });

  it('every sitemap route maps to a child sitemap that exists', () => {
    for (const id of Object.values(SITEMAP_ROUTES)) expect(SITEMAP_IDS).toContain(id);
  });
});

describe('buildPageMetadata', () => {
  it('always sets title, description and an absolute canonical', () => {
    const m = buildPageMetadata({ title: 'T', description: 'D', path: '/x' });
    expect(m.title).toBe('T');
    expect(m.description).toBe('D');
    expect(String((m.alternates as { canonical: string }).canonical)).toMatch(/^https?:\/\/.+\/x$/);
    expect(m.robots).toBeUndefined();
  });
});
