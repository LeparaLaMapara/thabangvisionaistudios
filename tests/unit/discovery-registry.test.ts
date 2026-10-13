/**
 * The discovery registry is the one list every surface reads. A route that
 * is in the sitemap registry (lib/seo/sitemap-registry.ts) but owned by no
 * discovery entity would be in robots' and the #90 test's view but missing
 * from the sitemap, llms.txt and the IndexNow sweep. These tests stop that.
 */
import { describe, expect, it } from 'vitest';
import { SITEMAP_ROUTES, SITEMAP_IDS } from '@/lib/seo/sitemap-registry';
import { DISCOVERY_ENTITIES, entriesForSitemap, entityOf, routeOf, allEntries } from '@/lib/discovery/registry';
import { getRentalCities } from '@/lib/seo/cities';
import { fixtureCatalog } from './helpers/discovery-catalog';

describe('every sitemap route is registered once in the discovery registry', () => {
  it.each(Object.entries(SITEMAP_ROUTES))('%s is owned by exactly one entity, filed under its sitemap', (route, sitemap) => {
    const owners = DISCOVERY_ENTITIES.filter((e) => e.routes.includes(route));
    expect(owners.length, `${route}: add it to an entity in lib/discovery/registry.ts`).toBe(1);
    expect(owners[0].sitemap, `${route}: SITEMAP_ROUTES says ${sitemap}`).toBe(sitemap);
  });

  it('entities own no route the sitemap registry does not know', () => {
    for (const e of DISCOVERY_ENTITIES) for (const r of e.routes) expect(SITEMAP_ROUTES, `${e.type} owns ${r}`).toHaveProperty([r]);
  });

  it('entity types are unique and every entity files under a real sitemap', () => {
    expect(new Set(DISCOVERY_ENTITIES.map((e) => e.type)).size).toBe(DISCOVERY_ENTITIES.length);
    for (const e of DISCOVERY_ENTITIES) expect(SITEMAP_IDS).toContain(e.sitemap);
  });
});

describe('route matching', () => {
  it('prefers static segments', () => {
    expect(routeOf('/rentals/cameras-optics/in/johannesburg')).toBe('/rentals/[category]/in/[city]');
    expect(routeOf('/rentals/cameras-optics/sony-fx3')).toBe('/rentals/[category]/[slug]');
    expect(routeOf('/studio/category/photography/in/johannesburg')).toBe('/studio/category/[slug]/in/[city]');
    expect(routeOf('/studio/category/photography/thandi')).toBe('/studio/category/[slug]/[id]');
    expect(routeOf('/')).toBe('/');
    expect(routeOf('/faq/')).toBe('/faq');
  });

  it('knows private and noindex paths are not indexable', () => {
    for (const p of ['/login', '/dashboard', '/admin/rentals', '/api/og', '/book', '/catalog/x', '/nope']) expect(routeOf(p)).toBeNull();
  });

  it('finds the entity of a path', () => {
    expect(entityOf('/rentals/audio/rode-ntg')?.type).toBe('rental');
    expect(entityOf('/tools/light')?.type).toBe('tool');
  });
});

describe('entries from the catalogue', () => {
  const c = fixtureCatalog();
  const paths = (id: (typeof SITEMAP_IDS)[number]) => entriesForSitemap(c, id).map((e) => e.path);

  it('rentals: index, stocked categories, items and city pages with real dates', () => {
    const p = paths('rentals');
    expect(p).toContain('/rentals');
    expect(p).toContain('/rentals/cameras-optics');
    expect(p).toContain('/rentals/audio/rode-ntg');
    expect(p).not.toContain('/rentals/lighting-power');
    expect(p.filter((x) => x.includes('/in/')).length).toBe(2 * getRentalCities().length);
    const item = entriesForSitemap(c, 'rentals').find((e) => e.path === '/rentals/cameras-optics/sony-fx3');
    expect(item?.lastModified).toBe('2026-10-13T06:00:00.000Z');
  });

  it('creators: list, profile, member page; studio city pages only where a creator is', () => {
    expect(paths('creators')).toEqual(expect.arrayContaining(['/smart-creators', '/studio/category/photography/thandi', '/creators/00000000-0000-4000-8000-0000000000aa']));
    const cities = paths('studio').filter((x) => x.includes('/in/'));
    expect(cities).toEqual(['/studio/category/photography/in/johannesburg']);
  });

  it('studio pages go when the studio flag is off', () => {
    const off = { ...c, studioOn: false };
    expect(entriesForSitemap(off, 'studio')).toEqual([]);
    expect(entriesForSitemap(off, 'creators').map((e) => e.path)).not.toContain('/studio/category/photography/thandi');
  });

  it('JSON-LD builders exist for gear, creators and tools', () => {
    const rental = DISCOVERY_ENTITIES.find((e) => e.type === 'rental')!.jsonLd!(c, '/rentals/cameras-optics/sony-fx3');
    expect(rental?.['@type']).toBe('Product');
    const person = DISCOVERY_ENTITIES.find((e) => e.type === 'creator')!.jsonLd!(c, '/studio/category/photography/thandi');
    expect(person?.['@type']).toBe('Person');
    const tool = DISCOVERY_ENTITIES.find((e) => e.type === 'tool')!.jsonLd!(c, '/tools/light');
    expect(tool?.['@type']).toBe('SoftwareApplication');
  });

  it('every entry is an indexable route', () => {
    for (const e of allEntries(c)) expect(routeOf(e.path), e.path).not.toBeNull();
  });
});
