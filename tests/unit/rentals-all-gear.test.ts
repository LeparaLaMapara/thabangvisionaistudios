import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ─── Supabase stub (records builder calls) ─────────────────────────────────────
type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock('@/lib/supabase/server', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'neq']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: typeof response) => unknown) => resolve(response);
  const client = { from: () => builder };
  return { createClient: async () => client };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: (p: { src: string; alt: string; onError?: () => void }) =>
    h('img', { src: p.src, alt: p.alt, onError: p.onError }),
}));

import { fetchAllPublishedRentals, RENTAL_CARD_COLUMNS, type RentalListItem } from '@/lib/supabase/queries/smartRentals';
import { gearCardImage, gearCardImageFallback } from '@/lib/rental/gear-image';
import AllGearClient, { categoryChips } from '@/app/(platform)/rentals/AllGearClient';

const item = (n: number, category: string, price = 100): RentalListItem =>
  ({
    id: `id-${n}`, slug: `item-${n}`, title: `Item ${n}`, category, sub_category: null, brand: null, model: null,
    price_per_day: price, currency: 'ZAR', thumbnail_url: null,
    gallery: [{ url: `https://res.cloudinary.com/x/image/upload/v1/item-${n}.jpg`, public_id: `p${n}` }],
    is_available: true, is_featured: false, features: null, metadata: null, created_at: '2026-01-01',
  }) as unknown as RentalListItem;

const gear = [item(1, 'cameras-optics', 1300), item(2, 'audio'), item(3, 'cameras-optics'), item(4, 'lighting-power')];

beforeEach(() => {
  calls.length = 0;
  response = { data: [], error: null };
  window.history.replaceState(null, '', '/rentals');
});

describe('fetchAllPublishedRentals', () => {
  it('reads card columns for every published category except crew', async () => {
    await fetchAllPublishedRentals();
    expect(calls.find((c) => c.method === 'select')?.args[0]).toBe(RENTAL_CARD_COLUMNS);
    expect(calls).toContainEqual({ method: 'neq', args: ['category', 'crew-services'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['is_published', true] });
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'category')).toBe(false);
  });

  it('marks a database error as failed', async () => {
    response = { data: null, error: { message: 'boom' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await fetchAllPublishedRentals()).failed).toBe(true);
    spy.mockRestore();
  });
});

describe('gear card images', () => {
  const url = 'https://res.cloudinary.com/x/image/upload/v1/a.jpg';
  it('removes the background and pads to a square on the card colour', () => {
    expect(gearCardImage(url)).toBe(
      'https://res.cloudinary.com/x/image/upload/e_background_removal/c_pad,ar_1:1,b_rgb:141414/v1/a.jpg',
    );
  });
  it('has a fallback without background removal, and leaves other hosts alone', () => {
    expect(gearCardImageFallback(url)).not.toContain('e_background_removal');
    expect(gearCardImage('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });
});

describe('/rentals all-gear page', () => {
  it('builds chips: All first, then categories biggest first', () => {
    expect(categoryChips(gear).map((c) => [c.value, c.count])).toEqual([
      ['all', 4], ['cameras-optics', 2], ['audio', 1], ['lighting-power', 1],
    ]);
  });

  it('shows every item straight away, each linking to its own page', () => {
    const { container } = render(h(AllGearClient, { rentals: gear }));
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Item 1/ }).getAttribute('href')).toBe('/rentals/cameras-optics/item-1');
    expect(container.textContent).toContain('R1 300 / day');
    expect(screen.getByRole('button', { name: /All/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a chip filters in place and keeps the address shareable', () => {
    render(h(AllGearClient, { rentals: gear }));
    fireEvent.click(screen.getByRole('button', { name: /Audio/ }));
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('Item 2')]);
    expect(window.location.pathname).toBe('/rentals/audio');
    fireEvent.click(screen.getByRole('button', { name: /All/ }));
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(window.location.pathname).toBe('/rentals');
  });

  it('a category address opens with that chip chosen; an unknown one shows all', () => {
    const { unmount } = render(h(AllGearClient, { rentals: gear, initialCategory: 'cameras-optics' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    unmount();
    render(h(AllGearClient, { rentals: gear, initialCategory: 'nope' }));
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('falls back to the plain photo when background removal fails', () => {
    render(h(AllGearClient, { rentals: [gear[0]] }));
    const img = within(screen.getByRole('link')).getByRole('img');
    expect(img.getAttribute('src')).toContain('e_background_removal');
    fireEvent.error(img);
    expect(within(screen.getByRole('link')).getByRole('img').getAttribute('src')).not.toContain('e_background_removal');
  });
});

describe('/rentals photos that cannot load', () => {
  it('a broken non-Cloudinary photo shows "No photo yet" instead of a broken image', () => {
    const local = { ...gear[1], gallery: null, thumbnail_url: '/missing.jpg' } as unknown as RentalListItem;
    render(h(AllGearClient, { rentals: [local] }));
    fireEvent.error(within(screen.getByRole('link')).getByRole('img'));
    expect(within(screen.getByRole('link')).queryByRole('img')).toBeNull();
    expect(screen.getByText('No photo yet')).toBeTruthy();
  });
});
