/* eslint-disable @typescript-eslint/no-explicit-any -- reading arbitrary JSON-LD shapes in assertions */
import { describe, expect, it } from 'vitest';
import { STUDIO } from '@/lib/constants';
import { productJsonLd, personJsonLd, softwareApplicationJsonLd } from '@/lib/seo/structured-data';
import { creatorProfilePath, creatorCategorySlug, isListedCreator } from '@/lib/seo/creator-url';
import { metaDescription } from '@/lib/seo/metadata';
import { rentalsReachCity, SA_CITIES } from '@/lib/seo/cities';

const rental = {
  title: 'Sony A7 III',
  slug: 'sony-a7-iii',
  category: 'cameras-optics',
  categoryLabel: 'Cameras & Optics',
  description: 'Full frame body.',
  price_per_day: 450,
  thumbnail_url: 'https://res.cloudinary.com/x/a.jpg',
  gallery: [{ url: 'https://res.cloudinary.com/x/b.jpg' }],
  is_available: true,
  brand: 'Sony',
  model: 'ILCE-7M3',
  average_rating: 0,
  review_count: 0,
};

describe('productJsonLd', () => {
  it('is a Product with a ZAR per-day Offer at the canonical URL', () => {
    const ld = productJsonLd(rental) as Record<string, any>;
    expect(ld['@type']).toBe('Product');
    expect(ld.url).toBe(`${STUDIO.meta.url}/rentals/cameras-optics/sony-a7-iii`);
    expect(ld.brand).toEqual({ '@type': 'Brand', name: 'Sony' });
    expect(ld.category).toBe('Cameras & Optics');
    expect(ld.image).toEqual(['https://res.cloudinary.com/x/a.jpg', 'https://res.cloudinary.com/x/b.jpg']);
    expect(ld.offers).toMatchObject({
      '@type': 'Offer',
      price: 450,
      priceCurrency: 'ZAR',
      availability: 'https://schema.org/InStock',
      priceSpecification: { '@type': 'UnitPriceSpecification', unitCode: 'DAY', price: 450 },
    });
    // No rating until there are reviews.
    expect(ld.aggregateRating).toBeUndefined();
  });

  it('never publishes price 0: no daily price means no offer at all', () => {
    expect((productJsonLd({ ...rental, price_per_day: null }) as Record<string, unknown>).offers).toBeUndefined();
    expect((productJsonLd({ ...rental, price_per_day: 0 }) as Record<string, unknown>).offers).toBeUndefined();
  });

  it('marks unavailable gear OutOfStock and carries real ratings', () => {
    const ld = productJsonLd({ ...rental, is_available: false, average_rating: 4.66, review_count: 3 }) as Record<string, any>;
    expect(ld.offers.availability).toBe('https://schema.org/OutOfStock');
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4.7, reviewCount: 3 });
  });
});

describe('creator addresses', () => {
  it('uses the creator category and crew slug, falling back to the id', () => {
    expect(creatorProfilePath({ id: 'u1', crew_slug: 'lebo', specializations: ['Cinematography'] })).toBe(
      '/studio/category/video-production/lebo',
    );
    expect(creatorProfilePath({ id: 'u1', crew_slug: null, specializations: ['photography'] })).toBe(
      '/studio/category/photography/u1',
    );
  });

  it('falls back to the first category when none match', () => {
    expect(creatorCategorySlug([])).toBe('photography');
    expect(creatorCategorySlug(null)).toBe('photography');
  });

  it('lists only verified, for-hire creators with a complete portfolio', () => {
    const photos = [{ url: 'a' }, { url: 'b' }, { url: 'c' }];
    const ok = { verification_status: 'verified', available_for_hire: true, portfolio_projects: [{ photos }] } as never;
    expect(isListedCreator(ok)).toBe(true);
    expect(isListedCreator({ ...(ok as object), available_for_hire: false } as never)).toBe(false);
    expect(isListedCreator({ ...(ok as object), verification_status: 'pending' } as never)).toBe(false);
    expect(isListedCreator({ ...(ok as object), portfolio_projects: [{ photos: photos.slice(0, 2) }] } as never)).toBe(false);
  });
});

describe('personJsonLd', () => {
  it('puts the rating on the Person at the given URL', () => {
    const ld = personJsonLd({
      display_name: 'Lebo',
      url: 'https://x.test/studio/category/photography/lebo',
      rating: { ratingValue: 4.5, reviewCount: 2 },
    }) as Record<string, any>;
    expect(ld['@type']).toBe('Person');
    expect(ld.url).toBe('https://x.test/studio/category/photography/lebo');
    expect(ld.aggregateRating).toMatchObject({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2 });
  });
});

describe('softwareApplicationJsonLd', () => {
  it('is free, and leaves version and downloads out without a release', () => {
    const base = {
      name: 'Ubunye Film',
      description: 'Video editor.',
      url: 'https://x.test/tools/film',
      applicationCategory: 'MultimediaApplication',
      operatingSystems: ['Web browser'],
    };
    const ld = softwareApplicationJsonLd(base) as Record<string, any>;
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.offers).toMatchObject({ price: 0, priceCurrency: 'ZAR' });
    expect(ld.softwareVersion).toBeUndefined();
    expect(ld.downloadUrl).toBeUndefined();
    const withRelease = softwareApplicationJsonLd({
      ...base,
      release: { version: '0.3.1', published: '2026-10-01T00:00:00Z', downloadUrls: ['https://d.test/a.msi'] },
    }) as Record<string, any>;
    expect(withRelease.softwareVersion).toBe('0.3.1');
    expect(withRelease.downloadUrl).toEqual(['https://d.test/a.msi']);
  });
});

describe('rental reach', () => {
  const city = (slug: string) => SA_CITIES.find((c) => c.slug === slug)!;
  it('reaches the collection city and cities inside the delivery radius only', () => {
    expect(rentalsReachCity(city('johannesburg'))).toBe(true);
    expect(rentalsReachCity(city('pretoria'))).toBe(true);
    expect(rentalsReachCity(city('cape-town'))).toBe(false);
    expect(rentalsReachCity(city('polokwane'))).toBe(false);
    expect(rentalsReachCity(city('rustenburg'))).toBe(false);
  });
});

describe('metaDescription', () => {
  it('collapses whitespace, cuts at a word and falls back when empty', () => {
    expect(metaDescription('  a   b ', 'f')).toBe('a b');
    expect(metaDescription('', 'fallback')).toBe('fallback');
    const long = 'word '.repeat(60);
    const out = metaDescription(long, 'f');
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });
});
