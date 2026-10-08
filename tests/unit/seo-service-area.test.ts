import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// The sitemap reads published rows through the admin client. Every query
// resolves to an empty list: the city URLs come from constants, not the DB.
vi.mock('@/lib/supabase/server', () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'select', 'eq', 'is', 'order', 'limit']) builder[m] = chain;
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return { createAdminClient: () => builder, createClient: async () => builder };
});

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

vi.mock('@/lib/supabase/queries/smartRentals', () => ({ getPublishedRentalsByCategory: async () => [] }));
vi.mock('@/lib/supabase/queries/productionCategories', () => ({ getCategoryBySlug: async () => null }));
vi.mock('@/lib/supabase/queries/smartProductions', () => ({
  getStudioProductionsByType: async () => [],
  getCreatorProductionsByType: async () => [],
}));
vi.mock('@/lib/supabase/queries/crew', () => ({ getCrewBySpecializationsAndLocation: async () => [] }));
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
  isInServiceArea,
} from '@/lib/seo/cities';
import { organizationJsonLd, localBusinessJsonLd, serviceJsonLd } from '@/lib/seo/structured-data';
import sitemap from '@/app/sitemap';
import { GET as llmsTxt } from '@/app/llms.txt/route';
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
});

describe('sitemap', () => {
  it('lists city pages for the service area only', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    const cityUrls = urls.filter((u) => u.includes('/in/'));

    // Every rental and studio category, times every listed city.
    expect(cityUrls.length).toBe((RENTAL_CATEGORIES.length + PRODUCTION_CATEGORIES.length) * LISTED_CITIES.length);

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
});

describe('llms.txt', () => {
  it('states the service area from constants and makes no national claim', async () => {
    const body = await llmsTxt().text();
    expect(body).toContain(`We work in ${STUDIO.serviceArea.province}.`);
    expect(body).toContain(STUDIO.serviceArea.outsideProvinceNote);
    for (const claim of ['across South Africa', 'all major cities', 'nationwide']) {
      expect(body).not.toContain(claim);
    }
    for (const c of RETIRED) expect(body).not.toContain(c.name);
  });
});
