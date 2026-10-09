import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase stub ────────────────────────────────────────────────────────────
// Records every builder call so the tests can assert what the catalogue list
// reads ask for (columns, limit), and lets each test choose the response.
type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null };
let throwOnFrom = false;

vi.mock('@/lib/supabase/server', () => {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'neq', 'gt']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: typeof response) => unknown) => resolve(response);
  const client = {
    from: (table: string) => {
      if (throwOnFrom) throw new Error('fetch failed');
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  };
  return { createClient: async () => client, createAdminClient: () => client };
});

import {
  fetchPublishedRentalsByCategory,
  getPublishedRentalsByCategory,
  getRentalCategoryCounts,
  tallyCategories,
  RENTAL_CATEGORY_PAGE_LIMIT,
  RENTAL_CARD_COLUMNS,
} from '@/lib/supabase/queries/smartRentals';

const row = (n: number, gallery: unknown = { url: `https://img/${n}.jpg`, public_id: `p${n}` }) => ({
  id: `id-${n}`,
  slug: `item-${n}`,
  title: `Item ${n}`,
  category: 'audio',
  first_image: gallery,
});

beforeEach(() => {
  calls.length = 0;
  response = { data: [], error: null };
  throwOnFrom = false;
});

describe('fetchPublishedRentalsByCategory', () => {
  it('reads only card columns: first gallery image, no description or full gallery', async () => {
    await fetchPublishedRentalsByCategory('audio');
    const select = calls.find((c) => c.method === 'select')?.args[0] as string;
    expect(select).toBe(RENTAL_CARD_COLUMNS);
    const cols = select.split(',');
    expect(cols).toContain('first_image:gallery->0');
    expect(cols).not.toContain('gallery');
    expect(cols).not.toContain('description');
  });

  it('caps the read, asking for one extra row to detect more', async () => {
    await fetchPublishedRentalsByCategory('audio');
    expect(calls.find((c) => c.method === 'limit')?.args[0]).toBe(RENTAL_CATEGORY_PAGE_LIMIT + 1);
    await fetchPublishedRentalsByCategory('audio', 10);
    expect(calls.filter((c) => c.method === 'limit').pop()?.args[0]).toBe(11);
  });

  it('maps the first image back into a one-item gallery', async () => {
    response = { data: [row(1), row(2, null)], error: null };
    const { rentals, failed, hasMore } = await fetchPublishedRentalsByCategory('audio');
    expect(failed).toBe(false);
    expect(hasMore).toBe(false);
    expect(rentals[0].gallery).toEqual([{ url: 'https://img/1.jpg', public_id: 'p1' }]);
    expect(rentals[1].gallery).toBeNull();
    expect(rentals[0]).not.toHaveProperty('first_image');
  });

  it('reports hasMore and trims to the limit', async () => {
    response = { data: [row(1), row(2), row(3)], error: null };
    const { rentals, hasMore } = await fetchPublishedRentalsByCategory('audio', 2);
    expect(rentals).toHaveLength(2);
    expect(hasMore).toBe(true);
  });

  it('marks a database error as failed instead of "no equipment"', async () => {
    response = { data: null, error: { message: 'boom' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await fetchPublishedRentalsByCategory('audio')).toEqual({ rentals: [], failed: true, hasMore: false });
    spy.mockRestore();
  });

  it('marks a thrown network error as failed', async () => {
    throwOnFrom = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await fetchPublishedRentalsByCategory('audio')).failed).toBe(true);
    spy.mockRestore();
  });

  it('keeps the old array-returning helper working for existing callers', async () => {
    response = { data: [row(1)], error: null };
    const list = await getPublishedRentalsByCategory('audio');
    expect(Array.isArray(list)).toBe(true);
    expect(list[0].slug).toBe('item-1');
  });
});

describe('getRentalCategoryCounts', () => {
  it('reads only the category column', async () => {
    await getRentalCategoryCounts();
    expect(calls.find((c) => c.method === 'select')?.args[0]).toBe('category');
  });

  it('counts per category in first-seen (ranking) order', async () => {
    response = {
      data: [{ category: 'audio' }, { category: 'lighting-power' }, { category: 'audio' }, { category: null }],
      error: null,
    };
    expect(await getRentalCategoryCounts()).toEqual({
      counts: [
        { category: 'audio', count: 2 },
        { category: 'lighting-power', count: 1 },
      ],
      failed: false,
    });
  });

  it('reports a failed read', async () => {
    response = { data: null, error: { message: 'down' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await getRentalCategoryCounts()).toEqual({ counts: [], failed: true });
    spy.mockRestore();
  });
});

describe('tallyCategories', () => {
  it('handles an empty list', () => {
    expect(tallyCategories([])).toEqual([]);
  });
});
