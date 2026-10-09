import { describe, it, expect } from 'vitest';
import { LISTING_POLICY, RENTAL_POLICY, STUDIO } from '@/lib/constants';
import {
  changedFields,
  depositForListing,
  listingMetadata,
  looksLikeCoordinates,
  parseListingInput,
  parseRands,
  resolveCategory,
} from '@/lib/core/listings/input';
import { metadataFreeGallery, metadataFreeImageUrl } from '@/app/api/listings/_lib/images';

const IMG = 'https://res.cloudinary.com/demo/image/upload/v1712345678/thabangvision_usecase/media/listings/abc.jpg';

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Sony A7 III',
    category: 'cameras',
    price_per_day: '450',
    replacement_value: 25000,
    location: 'Braamfontein, Johannesburg',
    gallery: [{ url: IMG, public_id: 'abc' }],
    ...over,
  };
}

describe('parseListingInput', () => {
  it('accepts a normal listing and maps the dashboard category to a slug', () => {
    const r = parseListingInput(base(), { requireCategory: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.category).toBe('cameras-optics');
      expect(r.value.price_per_day).toBe(450);
      expect(r.value.replacement_value).toBe(25000);
      expect(r.value.thumbnail_url).toBe(IMG);
    }
  });

  it('ignores anything the browser says about status, publishing, owner or deposit', () => {
    const r = parseListingInput(
      base({ is_published: true, listing_status: 'published', owner_id: 'someone', deposit_amount: 1 }),
      { requireCategory: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const keys = Object.keys(r.value);
      for (const k of ['is_published', 'listing_status', 'owner_id', 'deposit_amount']) expect(keys).not.toContain(k);
    }
  });

  it('requires a title, and a category on create', () => {
    expect(parseListingInput(base({ title: '  ' }), { requireCategory: true })).toMatchObject({ ok: false, field: 'title' });
    expect(parseListingInput(base({ category: '' }), { requireCategory: true })).toMatchObject({ ok: false, field: 'category' });
    expect(parseListingInput(base({ category: undefined }), { requireCategory: false }).ok).toBe(true);
    expect(parseListingInput(base({ category: 'weapons' }), { requireCategory: false })).toMatchObject({ ok: false, field: 'category' });
  });

  it('refuses zero, negative, non-numeric and absurd amounts but allows blank on a draft', () => {
    for (const bad of [0, -1, 'abc', 'NaN', Infinity]) {
      expect(parseListingInput(base({ price_per_day: bad }), { requireCategory: true })).toMatchObject({ ok: false, field: 'price_per_day' });
    }
    const tooMuch = LISTING_POLICY.maxReplacementValueCents / 100 + 1;
    expect(parseListingInput(base({ replacement_value: tooMuch }), { requireCategory: true })).toMatchObject({ ok: false, field: 'replacement_value' });
    const blank = parseListingInput(base({ price_per_day: '', replacement_value: null }), { requireCategory: true });
    expect(blank.ok && blank.value.price_per_day).toBe(null);
  });

  it('refuses map coordinates as a location', () => {
    expect(parseListingInput(base({ location: '-26.2041, 28.0473' }), { requireCategory: true })).toMatchObject({ ok: false, field: 'location' });
    expect(parseListingInput(base({ location: '26.20410S 28.04730E' }), { requireCategory: true })).toMatchObject({ ok: false, field: 'location' });
  });

  it('keeps only url and public_id per image, and only https', () => {
    const r = parseListingInput(
      base({ gallery: [{ url: IMG, public_id: 'abc', exif: { GPSLatitude: -26.2 }, gps: { lat: 1 } }] }),
      { requireCategory: true },
    );
    expect(r.ok && r.value.gallery).toEqual([{ url: IMG, public_id: 'abc' }]);
    expect(parseListingInput(base({ gallery: [{ url: 'http://x.test/a.jpg' }] }), { requireCategory: true })).toMatchObject({ ok: false, field: 'gallery' });
    expect(parseListingInput(base({ gallery: [{ url: 'javascript:alert(1)' }] }), { requireCategory: true })).toMatchObject({ ok: false });
    const many = Array.from({ length: STUDIO.platform.maxListingImages + 1 }, () => ({ url: IMG, public_id: 'x' }));
    expect(parseListingInput(base({ gallery: many }), { requireCategory: true })).toMatchObject({ ok: false, field: 'gallery' });
  });

  it('accepts only known AI-suggested field names', () => {
    const r = parseListingInput(base({ ai_suggested_fields: ['title', 'title', 'is_published', 'price_per_day'] }), { requireCategory: true });
    expect(r.ok && r.value.ai_suggested_fields).toEqual(['title', 'price_per_day']);
  });

  it('accepts an https evidence link or a note, not another scheme', () => {
    expect(parseListingInput(base({ replacement_value_evidence: 'https://shop.test/a7iii' }), { requireCategory: true }).ok).toBe(true);
    expect(parseListingInput(base({ replacement_value_evidence: 'Invoice from 2024, R26 000' }), { requireCategory: true }).ok).toBe(true);
    expect(parseListingInput(base({ replacement_value_evidence: 'javascript:alert(1)' }), { requireCategory: true })).toMatchObject({ ok: false });
  });

  it('rejects a non-object body', () => {
    expect(parseListingInput(null, { requireCategory: true }).ok).toBe(false);
    expect(parseListingInput([1], { requireCategory: true }).ok).toBe(false);
  });
});

describe('money and categories', () => {
  it('rounds rands to cents', () => {
    expect(parseRands('450.005', 1_000_000)).toEqual({ ok: true, value: 450.01 });
  });

  it('computes the deposit from replacement value on the server', () => {
    expect(depositForListing(20000)).toBe((20000 * RENTAL_POLICY.depositRateBps) / 10000);
    expect(depositForListing(null)).toBeNull();
    expect(depositForListing(0)).toBeNull();
  });

  it('resolves both dashboard names and real slugs', () => {
    expect(resolveCategory('lighting')).toBe('lighting-power');
    expect(resolveCategory('lighting-power')).toBe('lighting-power');
    expect(resolveCategory('nope')).toBeNull();
  });
});

describe('location privacy', () => {
  it('detects coordinates but not ordinary addresses', () => {
    expect(looksLikeCoordinates('-33.9249, 18.4241')).toBe(true);
    expect(looksLikeCoordinates('12 Smit Street, Braamfontein')).toBe(false);
  });

  it('drops GPS/EXIF-like keys from listing metadata and sets the typed location', () => {
    const m = listingMetadata(
      { ai_generated: true, gps: { lat: -26 }, latitude: -26, lng: 28, exif_data: {}, location: 'old' },
      'Soweto, Johannesburg',
    );
    expect(m).toEqual({ ai_generated: true, location: 'Soweto, Johannesburg' });
  });

  it('serves Cloudinary photos through a transformation, which strips EXIF', () => {
    expect(metadataFreeImageUrl(IMG)).toBe(
      'https://res.cloudinary.com/demo/image/upload/q_auto/v1712345678/thabangvision_usecase/media/listings/abc.jpg',
    );
    const once = metadataFreeImageUrl(IMG);
    expect(metadataFreeImageUrl(once)).toBe(once);
    expect(metadataFreeImageUrl('https://example.test/a.jpg')).toBe('https://example.test/a.jpg');
    expect(metadataFreeGallery([{ url: IMG, public_id: 'abc' }])).toEqual([{ url: once, public_id: 'abc' }]);
  });
});

describe('changedFields', () => {
  it('compares numbers and numeric strings as equal and blanks as null', () => {
    expect(changedFields({ price_per_day: 450, description: null }, { price_per_day: '450', description: '' })).toEqual([]);
    expect(changedFields({ title: 'A', gallery: ['x'] }, { title: 'B', gallery: ['x', 'y'] })).toEqual(['title', 'gallery']);
  });
});
