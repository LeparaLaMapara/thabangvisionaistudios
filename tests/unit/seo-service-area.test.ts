import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// The sitemap reads published rows through the admin client. Each table
// resolves to the fixture rows below: stock in two rental categories, and one
// listed creator (verified, for hire, complete portfolio) in Johannesburg.
const photos = [{ url: 'a' }, { url: 'b' }, { url: 'c' }];
const TABLES: Record<string, unknown[]> = {
  smart_rentals: [
    { category: 'cameras-optics', slug: 'cam-1', updated_at: '2026-10-01T10:00:00Z', owner_id: null },
    { category: 'audio', slug: 'mic-1', updated_at: '2026-10-02T10:00:00Z', owner_id: null },
  ],
  public_profiles: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      crew_slug: 'thandi',
      specializations: ['Photography'],
      location: 'Braamfontein, Johannesburg',
      verification_status: 'verified',
      available_for_hire: true,
      portfolio_projects: [{ id: 'p', title: 't', photos }],
    },
  ],
};
vi.mock('@/lib/supabase/server', () => {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'limit']) builder[m] = chain;
    builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: TABLES[table] ?? [], error: null });
    return builder;
  };
  const client = { from: (t: string) => make(t) };
  return { createAdminClient: () => client, createClient: async () => client };
});
// People (roles_v1) off: these cases cover the creator and studio sitemap; with People on they redirect (tests/unit/clarity-blockers.test.ts).
vi.mock('@/lib/features', () => ({ getFlag: async (key: string) => key !== 'roles_v1' }));
vi.mock('@/lib/ubunye-release', () => ({ getUbunyeRelease: async () => null }));

// permanentRedirect throws in Next; record the target and throw the same way
// so the page stops where Next would stop it.
const redirects: string[] = [];
vi.mock('next/navigation', () => ({
  permanentRedirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:308:${url}`);
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:307:${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

// One item in every rental category except data-storage, which is empty.
vi.mock('@/lib/supabase/queries/smartRentals', () => ({
  getPublishedRentalsByCategory: async () => [],
  // Related categories on a city page link only stocked ones.
  getRentalCategoryCounts: async () => ({ counts: [{ category: 'cameras-optics', count: 1 }], failed: false }),
  fetchPublishedRentalsByCategory: async (category: string) => ({
    rentals: category === 'data-storage' ? [] : [{ id: 'r1', slug: 'r1', category }],
    failed: false,
    hasMore: false,
  }),
  // The category page reads the whole list (develop's all gear page).
  fetchAllPublishedRentals: async () => ({
    rentals: RENTAL_CATEGORIES.filter((c) => c.value !== 'data-storage').map((c) => ({
      id: `r-${c.value}`,
      slug: `r-${c.value}`,
      category: c.value,
    })),
    failed: false,
    hasMore: false,
  }),
}));
vi.mock('@/lib/supabase/queries/productionCategories', () => ({ getCategoryBySlug: async () => null }));
vi.mock('@/lib/supabase/queries/smartProductions', () => ({
  getStudioProductionsByType: async () => [],
  getCreatorProductionsByType: async () => [],
}));
// A creator is based in Pretoria only.
vi.mock('@/lib/supabase/queries/crew', () => ({
  getCrewBySpecializationsAndLocation: async (_k: string[], city: string) =>
    city === 'Pretoria' ? [{ id: 'c1' }] : [],
}));
vi.mock('@/app/(platform)/rentals/[category]/RentalCategoryClient', () => ({ default: () => null }));
vi.mock('@/app/(platform)/studio/category/[slug]/CategoryPageClient', () => ({ default: () => null }));
vi.mock('@/components/seo/RelatedCategories', () => ({ RelatedCategories: () => null }));
vi.mock('@/components/ubunye/AskUbunyeButton', () => ({ AskUbunyeButton: () => null }));

import { STUDIO, RENTAL_CATEGORIES, PRODUCTION_CATEGORIES } from '@/lib/constants';
import {
  SA_CITIES,
  LISTED_CITIES,
  COUNTRY_SLUG,
  getListedCityBySlug,
  getListedCitySlugs,
  getRentalCities,
  isInServiceArea,
} from '@/lib/seo/cities';
import { organizationJsonLd, localBusinessJsonLd, serviceJsonLd } from '@/lib/seo/structured-data';
import { sitemapEntries, toUrlsetXml, toIndexXml } from '@/lib/seo/sitemap';
import { SITEMAP_IDS } from '@/lib/seo/sitemap-registry';
import { GET as llmsTxt } from '@/app/llms.txt/route';
import RentalCategoryPage from '@/app/(platform)/rentals/[category]/page';
import RentalLocationPage from '@/app/(platform)/rentals/[category]/in/[city]/page';
import StudioLocationPage from '@/app/(platform)/studio/category/[slug]/in/[city]/page';

// Cities that used to have pages and must not any more (negative fixtures).
const RETIRED = SA_CITIES.filter((c) => c.province !== STUDIO.serviceArea.province);

describe('city filter: pages only for the service area', () => {
  it('lists only cities in the configured province', () => {
    expect(LISTED_CITIES.length).toBeGreaterThan(0);
    for (const c of LISTED_CITIES) expect(c.province).toBe(STUDIO.serviceArea.province);
    expect(LISTED_CITIES.every(isInServiceArea)).toBe(true);
  });

  it('has retired cities to redirect (the negative cases are real)', () => {
    expect(RETIRED.map((c) => c.slug)).toEqual(expect.arrayContaining(['cape-town', 'durban', 'polokwane']));
  });

  it('resolves listed slugs and refuses everything else', () => {
    expect(getListedCityBySlug('johannesburg')?.name).toBe('Johannesburg');
    expect(getListedCityBySlug('pretoria')?.province).toBe(STUDIO.serviceArea.province);
    for (const c of RETIRED) expect(getListedCityBySlug(c.slug)).toBeUndefined();
    expect(getListedCityBySlug(COUNTRY_SLUG)).toBeUndefined();
    expect(getListedCityBySlug('not-a-city')).toBeUndefined();
  });

  it('the rental cities are the ones our delivery reaches, all inside the service area', () => {
    const slugs = getRentalCities().map((c) => c.slug);
    expect(slugs).toContain('johannesburg');
    expect(slugs).toContain('pretoria');
    for (const c of getRentalCities()) expect(c.province).toBe(STUDIO.serviceArea.province);
  });
});

describe('sitemap', () => {
  const all = async () => (await Promise.all(SITEMAP_IDS.map((id) => sitemapEntries(id)))).flat();

  it('lists city pages only where stock or a creator serves them', async () => {
    const urls = (await all()).map((e) => e.url);
    const cityUrls = urls.filter((u) => u.includes('/in/'));

    // Rentals: only the two stocked categories, times the cities the stock reaches.
    const rentalCity = cityUrls.filter((u) => u.includes('/rentals/'));
    expect(rentalCity.length).toBe(2 * getRentalCities().length);
    expect(rentalCity.every((u) => /\/rentals\/(cameras-optics|audio)\/in\//.test(u))).toBe(true);
    // An empty rental category has no page at all.
    expect(urls.some((u) => u.includes('/rentals/data-storage'))).toBe(false);

    // Studio: only categories the one creator works in, and only Johannesburg.
    const studioCity = cityUrls.filter((u) => u.includes('/studio/'));
    expect(studioCity.length).toBeGreaterThan(0);
    expect(studioCity.every((u) => u.endsWith('/in/johannesburg'))).toBe(true);
    expect(studioCity.length).toBeLessThan(PRODUCTION_CATEGORIES.length * LISTED_CITIES.length);

    const listed = new Set(getListedCitySlugs());
    for (const u of cityUrls) {
      const slug = u.split('/in/')[1];
      expect(listed.has(slug)).toBe(true);
    }
    for (const c of RETIRED) {
      expect(urls.some((u) => u.endsWith(`/in/${c.slug}`))).toBe(false);
    }
    expect(urls.some((u) => u.endsWith(`/in/${COUNTRY_SLUG}`))).toBe(false);
  });

  it('lists the creator profile at its canonical address', async () => {
    const urls = (await all()).map((e) => e.url);
    expect(urls).toContain(`${STUDIO.meta.url}/studio/category/photography/thandi`);
    expect(urls).toContain(`${STUDIO.meta.url}/smart-creators`);
  });

  it('never lists noindex or utility pages', async () => {
    const urls = (await all()).map((e) => e.url);
    for (const p of ['/login', '/register', '/unsubscribe', '/reset-password', '/onboarding', '/welcome']) {
      expect(urls).not.toContain(`${STUDIO.meta.url}${p}`);
    }
  });

  it('writes a sitemap index of every child, and valid urlset XML', async () => {
    const index = toIndexXml();
    for (const id of SITEMAP_IDS) expect(index).toContain(`<loc>${STUDIO.meta.url}/sitemap/${id}.xml</loc>`);
    const xml = toUrlsetXml([{ url: 'https://x.test/a?b=1&c=2', lastModified: '2026-10-01T10:00:00Z', priority: 0.7 }]);
    expect(xml).toContain('<loc>https://x.test/a?b=1&amp;c=2</loc>');
    expect(xml).toContain('<lastmod>2026-10-01T10:00:00.000Z</lastmod>');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('uses real dates: a rental entry carries its row update time', async () => {
    const cam = (await all()).find((e) => e.url.endsWith('/rentals/cameras-optics/cam-1'));
    expect(cam?.lastModified).toBe('2026-10-01T10:00:00Z');
  });
});

describe('structured data areaServed', () => {
  const gauteng = {
    '@type': 'AdministrativeArea',
    name: STUDIO.serviceArea.province,
  };

  it('the organisation and the business serve the province, not the country', () => {
    expect(organizationJsonLd().areaServed).toMatchObject(gauteng);
    expect(localBusinessJsonLd().areaServed).toMatchObject(gauteng);
    expect((organizationJsonLd().areaServed as { '@type': string })['@type']).not.toBe('Country');
    expect((localBusinessJsonLd().areaServed as { '@type': string })['@type']).not.toBe('Country');
  });

  it('a service without a city serves the province; with a city, the city in the province', () => {
    const base = { name: 'x', description: 'y', url: STUDIO.meta.url };
    expect(serviceJsonLd(base).areaServed).toMatchObject(gauteng);
    expect(serviceJsonLd({ ...base, city: 'Pretoria' }).areaServed).toMatchObject({
      '@type': 'City',
      name: 'Pretoria',
      containedInPlace: gauteng,
    });
  });
});

describe('city pages redirect (308) outside the service area', () => {
  beforeEach(() => {
    redirects.length = 0;
  });

  const rentalCat = RENTAL_CATEGORIES[0].value;
  const studioCat = PRODUCTION_CATEGORIES[0].slug;

  const rental = (city: string) =>
    RentalLocationPage({ params: Promise.resolve({ category: rentalCat, city }) });
  const studio = (city: string) =>
    StudioLocationPage({ params: Promise.resolve({ slug: studioCat, city }) });

  it.each([...RETIRED.map((c) => c.slug), COUNTRY_SLUG, 'atlantis'])('rentals: %s goes to the category page', async (city) => {
    await expect(rental(city)).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([`/rentals/${rentalCat}`]);
  });

  it.each([...RETIRED.map((c) => c.slug), COUNTRY_SLUG, 'atlantis'])('studio: %s goes to the category page', async (city) => {
    await expect(studio(city)).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([`/studio/category/${studioCat}`]);
  });

  it('listed cities render without a redirect', async () => {
    await expect(rental('johannesburg')).resolves.toBeTruthy();
    await expect(studio('pretoria')).resolves.toBeTruthy();
    expect(redirects).toEqual([]);
  });

  it('studio: a listed city with no creator there goes to the category page', async () => {
    await expect(studio('johannesburg')).rejects.toThrow('NEXT_REDIRECT:308');
    expect(redirects).toEqual([`/studio/category/${studioCat}`]);
  });

  it('rentals: an empty or unknown category is a 404, and so are its city pages', async () => {
    await expect(
      RentalLocationPage({ params: Promise.resolve({ category: 'data-storage', city: 'johannesburg' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(RentalCategoryPage({ params: Promise.resolve({ category: 'data-storage' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(RentalCategoryPage({ params: Promise.resolve({ category: 'not-a-category' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('llms.txt', () => {
  it('states the service area from constants and makes no national claim', async () => {
    const body = await (await llmsTxt()).text();
    expect(body).toContain(`We work in ${STUDIO.serviceArea.province}.`);
    expect(body).toContain(STUDIO.serviceArea.outsideProvinceNote);
    for (const claim of ['across South Africa', 'all major cities', 'nationwide']) {
      expect(body).not.toContain(claim);
    }
    for (const c of RETIRED) expect(body).not.toContain(c.name);
  });
});
