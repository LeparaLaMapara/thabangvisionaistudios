import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));

import { SupabaseQuoteLinks } from '@/lib/delivery/checkout';

/**
 * Found by the local journey tests: every delivery checkout failed with
 * "Your delivery quote could not be used". linkToGroup updates with an or=
 * filter on booking_group_id and returned only 'id'; PostgREST (checked on
 * 12.2, 13.0 and 14.x) answers such an update with 42703 "column
 * delivery_quotes.booking_group_id does not exist" whenever a column named in
 * or= is missing from select=. Rule: every or= column is also selected.
 */
function recordingDb(result: { data: unknown; error: unknown }) {
  const seen: { or?: string; select?: string } = {};
  const b = {
    update: () => b,
    eq: () => b,
    or: (f: string) => { seen.or = f; return b; },
    select: (c: string) => { seen.select = c; return Promise.resolve(result); },
  };
  return { db: { from: () => b } as never, seen };
}

const columnsIn = (orFilter: string): string[] =>
  [...new Set(orFilter.split(',').map((part) => part.trim().split('.')[0]))];

describe('SupabaseQuoteLinks.linkToGroup', () => {
  it('selects every column its or= filter names (PostgREST 42703 otherwise)', async () => {
    const { db, seen } = recordingDb({ data: [{ id: 'q1', booking_group_id: 'g1' }], error: null });
    expect(await new SupabaseQuoteLinks(db).linkToGroup('q1', 'g1')).toBe(true);
    const selected = (seen.select ?? '').split(',').map((c) => c.trim());
    for (const col of columnsIn(seen.or ?? '')) expect(selected).toContain(col);
  });

  it('is false when no row was claimed, and throws on a database error', async () => {
    expect(await new SupabaseQuoteLinks(recordingDb({ data: [], error: null }).db).linkToGroup('q1', 'g1')).toBe(false);
    await expect(new SupabaseQuoteLinks(recordingDb({ data: null, error: { message: 'boom' } }).db).linkToGroup('q1', 'g1')).rejects.toThrow(/boom/);
  });
});
