import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GEAR_RENTAL_CATEGORIES, ON_SITE_RENTAL, RENTAL_CATEGORIES, RENTALS_COMING_SOON, STUDIO } from '@/lib/constants';
import { comingSoonLabels, halfDayPrice, hasOnSiteItem, isOnSiteCategory, MAX_RENTAL_VIDEOS, rentalLoop, rentalVideos, specEntries } from '@/lib/rental/on-site';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCategory } from '@/lib/core/listings/input';
import { rentalCityPages, stockedRentalCategories } from '@/lib/seo/inventory';
import { mayAutoplay } from '@/components/rentals/RentalLoopVideo';
import type { SACity } from '@/lib/seo/cities';
import { leadTimeMessage, meetsLeadTime, studioLeadTimeMessage } from '@/lib/rental/leadTime';

/**
 * Studios as a rental category (owner request 2026-10-15): a place is shown
 * like gear once it has a listing, priced by the full day with a half day on
 * request, never delivered, and never listable by an owner as gear.
 */

describe('the Studios category', () => {
  it('is a rental category, but not a gear category', () => {
    expect(RENTAL_CATEGORIES.some((c) => c.value === 'studios')).toBe(true);
    expect(GEAR_RENTAL_CATEGORIES.some((c) => c.value === 'studios')).toBe(false);
    expect(GEAR_RENTAL_CATEGORIES.length).toBe(RENTAL_CATEGORIES.length - ON_SITE_RENTAL.categories.length);
    expect(isOnSiteCategory('studios')).toBe(true);
    expect(isOnSiteCategory('cameras-optics')).toBe(false);
    expect(isOnSiteCategory(null)).toBe(false);
  });

  it('cannot be chosen by an owner listing gear', () => {
    expect(resolveCategory('studios')).toBeNull();
    expect(resolveCategory('cameras-optics')).toBe('cameras-optics');
  });

  it('appears only with stock (an empty category is noise)', () => {
    expect(stockedRentalCategories([]).some((c) => c.value === 'studios')).toBe(false);
    const rows = [{ category: 'studios', updated_at: '2026-10-15T00:00:00Z' }] as Parameters<typeof stockedRentalCategories>[0];
    expect(stockedRentalCategories(rows).map((c) => c.value)).toEqual(['studios']);
  });

  it('has city pages only in its own city, while gear follows delivery reach', () => {
    const home = { slug: 'home', name: STUDIO.location.city } as SACity;
    const other = { slug: 'other', name: 'Elsewhere' } as SACity;
    const rows = [
      { category: 'studios', updated_at: null },
      { category: 'audio', updated_at: null },
    ] as unknown as Parameters<typeof rentalCityPages>[0];
    const pages = rentalCityPages(rows, [home, other]);
    expect(pages.filter((p) => p.category === 'studios').map((p) => p.city)).toEqual(['home']);
    expect(pages.filter((p) => p.category === 'audio').map((p) => p.city)).toEqual(['home', 'other']);
  });
});

describe('studio notice', () => {
  // Friday 14:00: Sunday is 34 hours away (refused), Monday 58 (allowed).
  const friday = new Date(2030, 0, 11, 14, 0, 0);

  it('uses studio words, not the equipment line', () => {
    const msg = studioLeadTimeMessage(friday);
    expect(msg).toContain('studio');
    expect(msg).not.toContain('Equipment');
    expect(leadTimeMessage(friday)).toContain('Equipment');
  });

  it('states the rule checkout really enforces', () => {
    const msg = studioLeadTimeMessage(friday);
    expect(msg).toContain(`${STUDIO.rental.minLeadTimeHours} hours`);
    expect(msg).toContain('Monday');
    expect(meetsLeadTime(new Date(2030, 0, 13), friday)).toBe(false);
    expect(meetsLeadTime(new Date(2030, 0, 14), friday)).toBe(true);
  });
});

describe('coming-soon labels', () => {
  it('drop "Studios and locations" once a studio is listed, and keep labels with no category', () => {
    const list = [...RENTALS_COMING_SOON, { label: 'Vans' }];
    expect(comingSoonLabels(list, [])).toEqual(['Studios and locations', 'Vans']);
    expect(comingSoonLabels(list, [{ category: 'studios' }])).toEqual(['Vans']);
    expect(comingSoonLabels(list, [{ category: 'audio' }])).toEqual(['Studios and locations', 'Vans']);
  });
});

describe('half-day price', () => {
  it('comes from the listing, for places only', () => {
    expect(halfDayPrice({ category: 'studios', price_per_half_day: 1500 })).toBe(1500);
    // Postgres numeric arrives as a string.
    expect(halfDayPrice({ category: 'studios', price_per_half_day: '1500' })).toBe(1500);
    expect(halfDayPrice({ category: 'audio', price_per_half_day: 1500 })).toBeNull();
  });

  it('is removed by clearing the column', () => {
    expect(halfDayPrice({ category: 'studios', price_per_half_day: null })).toBeNull();
    expect(halfDayPrice({ category: 'studios' })).toBeNull();
  });
});

describe('a listing loop', () => {
  it('is read from a same-site MP4 with the WebM and poster beside it', () => {
    expect(rentalLoop({ video_provider: 'file', video_url: '/media/rentals/studio/studio-loop.mp4' })).toEqual({
      mp4: '/media/rentals/studio/studio-loop.mp4',
      webm: '/media/rentals/studio/studio-loop.webm',
      poster: '/media/rentals/studio/studio-loop-poster.webp',
    });
  });

  it('is refused for other servers, odd paths and other providers', () => {
    for (const video_url of ['https://evil.example/x.mp4', '//evil.example/media/x.mp4', '/media/../x.mp4', '/other/x.mp4', '/media/x.webm']) {
      expect(rentalLoop({ video_provider: 'file', video_url })).toBeNull();
    }
    expect(rentalLoop({ video_provider: 'youtube', video_url: '/media/x.mp4' })).toBeNull();
    expect(rentalLoop({ video_provider: 'file', video_url: null })).toBeNull();
  });

  it('autoplays only on 4g with data saver off and no reduced motion', () => {
    const win = (reduce: boolean, connection?: { saveData?: boolean; effectiveType?: string }) =>
      ({ matchMedia: () => ({ matches: reduce }), navigator: { connection } }) as unknown as Window;
    expect(mayAutoplay(win(false, { effectiveType: '4g', saveData: false }))).toBe(true);
    expect(mayAutoplay(win(true, { effectiveType: '4g' }))).toBe(false);
    expect(mayAutoplay(win(false, { effectiveType: '4g', saveData: true }))).toBe(false);
    expect(mayAutoplay(win(false, { effectiveType: '3g' }))).toBe(false);
    expect(mayAutoplay(win(false))).toBe(false);
  });
});

describe('the videos on a listing', () => {
  const v = (n: number) => ({ url: `/media/rentals/studio/studio-video-${n}.mp4`, poster: `/media/rentals/studio/studio-video-${n}-poster.webp`, title: `Video ${n}` });

  it('are read from metadata.videos, in order', () => {
    expect(rentalVideos({ metadata: { videos: [v(1), v(2), v(3)] } }).map((x) => x.url)).toEqual([v(1).url, v(2).url, v(3).url]);
    expect(rentalVideos({ metadata: { videos: [v(1)] } })).toEqual([v(1)]);
  });

  it('are empty when the listing has no list, so the page falls back to the single loop', () => {
    expect(rentalVideos({ metadata: null })).toEqual([]);
    expect(rentalVideos({ metadata: {} })).toEqual([]);
    expect(rentalVideos({ metadata: { videos: 'x' } })).toEqual([]);
    expect(rentalVideos({})).toEqual([]);
    const gear = { metadata: { sensor: 'Full frame' }, video_provider: 'file', video_url: '/media/rentals/studio/studio-loop.mp4' };
    expect(rentalVideos(gear)).toEqual([]);
    expect(rentalLoop(gear)?.mp4).toBe('/media/rentals/studio/studio-loop.mp4');
  });

  it('drop other servers and odd paths, and a bad poster or title only loses that field', () => {
    const list = [
      { url: 'https://evil.example/x.mp4' },
      { url: '//evil.example/media/x.mp4' },
      { url: '/media/../x.mp4' },
      { url: '/media/x.webm' },
      null,
      'x',
      { url: '/media/rentals/studio/ok.mp4', poster: 'https://evil.example/p.webp', title: '   ' },
    ];
    expect(rentalVideos({ metadata: { videos: list } })).toEqual([{ url: '/media/rentals/studio/ok.mp4', poster: null, title: null }]);
  });

  it('stop at the most a page shows', () => {
    const many = Array.from({ length: MAX_RENTAL_VIDEOS + 3 }, (_, i) => v(i + 1));
    expect(rentalVideos({ metadata: { videos: many } })).toHaveLength(MAX_RENTAL_VIDEOS);
  });

  it('never show as a specification row', () => {
    expect(specEntries({ sensor: 'Full frame', weight_kg: 2, videos: [v(1)], extra: { a: 1 } })).toEqual([
      ['sensor', 'Full frame'],
      ['weight_kg', '2'],
    ]);
    expect(specEntries(null)).toEqual([]);
    expect(specEntries([1, 2])).toEqual([]);
  });

  it('in the studio listing script point at files that exist', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/rentals/studio-listing.sql'), 'utf8');
    const paths = [...sql.matchAll(/"(\/media\/rentals\/studio\/[^"]+)"/g)].map((m) => m[1]);
    expect(paths.filter((p) => p.endsWith('.mp4'))).toHaveLength(3);
    for (const p of paths) expect(existsSync(join(process.cwd(), 'public', p))).toBe(true);
  });
});

// ─── Checkout: a studio is never delivered ─────────────────────────────────────

const reserve = vi.fn();
const cartItems = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'u@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { verification_status: 'verified' } }) }) }) }),
  }),
  createAdminClient: () => ({ rpc: reserve }),
}));
vi.mock('@/lib/supabase/queries/cart', () => ({ getCartItems: (...a: unknown[]) => cartItems(...a), clearCart: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/consent', () => ({ recordConsent: vi.fn(async () => ({ ok: true })), requiredConsents: () => [] }));

describe('checkout with a studio', () => {
  it('knows when an order holds a place', () => {
    expect(hasOnSiteItem([{ rental: { category: 'audio' } }, { rental: { category: 'studios' } }])).toBe(true);
    expect(hasOnSiteItem([{ rental: { category: 'audio' } }])).toBe(false);
  });

  it('refuses delivery before anything is reserved', async () => {
    cartItems.mockResolvedValue([
      {
        id: 'c1',
        rental_id: 'r1',
        quantity: 1,
        start_date: '2030-01-10',
        end_date: '2030-01-11',
        rental: { id: 'r1', title: 'Studio', slug: 's', category: 'studios', price_per_day: 3500, price_per_week: null, deposit_amount: 1750, replacement_value: null, is_available: true, quantity: 1 },
      },
    ]);
    const { POST } = await import('@/app/api/cart/checkout/route');
    const res = await POST(
      new NextRequest('http://localhost/api/cart/checkout', {
        method: 'POST',
        body: JSON.stringify({ acceptTerms: true, fulfilment_method: 'delivery', delivery_address: '1 Long Street, Somewhere, Gauteng' }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('ON_SITE_ONLY');
    expect(reserve).not.toHaveBeenCalled();
  });
});
