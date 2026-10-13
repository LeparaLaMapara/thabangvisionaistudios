import { describe, it, expect } from 'vitest';
import { createSearchTools } from '@/lib/agents/tools/search';
import { createBookingTools } from '@/lib/agents/tools/booking';
import { getBusyCreatorIds } from '@/lib/supabase/queries/crew';

// Migration 077 hides crew_requests from visitors, so the creator tools ask
// busy_creator_ids() (creator ids only) instead of reading requests.

const CREATORS = [
  { id: 'c-busy', display_name: 'Busy Bee', crew_slug: 'busy-bee', crew_bio: 'b', specializations: ['photography'] },
  { id: 'c-free', display_name: 'Free Fox', crew_slug: 'free-fox', crew_bio: 'f', specializations: ['photography'] },
];

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(opts: { rpcError?: boolean; tableRows?: Record<string, unknown> } = {}) {
  const tables: string[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const builder = (table: string): unknown => {
    let single = false;
    const result = (): Result => {
      const rows = (opts.tableRows?.[table] ?? (table === 'public_profiles' ? CREATORS : [])) as unknown[];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result()).then(resolve, reject);
          }
          if (prop === 'single' || prop === 'maybeSingle') single = true;
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return {
    tables,
    rpcs,
    from(table: string) {
      tables.push(table);
      return builder(table);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: 'function public.busy_creator_ids(uuid[]) does not exist' } });
      return Promise.resolve({ data: [{ creator_id: 'c-busy' }], error: null });
    },
  };
}

describe('busy creators without reading crew requests (077)', () => {
  it('search_creators (assistant) marks busy creators through busy_creator_ids', async () => {
    const db = fakeClient();
    const tools = createSearchTools(db);
    const out = await tools.search_creators.execute({ specialization: 'photography' });
    expect(db.rpcs).toEqual([{ fn: 'busy_creator_ids', args: { p_creator_ids: ['c-busy', 'c-free'] } }]);
    expect(db.tables).not.toContain('crew_requests');
    const byId = Object.fromEntries(out.results.map((r: { id: string; available: boolean }) => [r.id, r.available]));
    expect(byId).toEqual({ 'c-busy': false, 'c-free': true });
  });

  it('search_creators (booking agent) does the same', async () => {
    const db = fakeClient();
    const tools = createBookingTools(db, false);
    const out = await tools.search_creators.execute({});
    expect(db.rpcs.map((r) => r.fn)).toEqual(['busy_creator_ids']);
    expect(db.tables).not.toContain('crew_requests');
    expect(out.results.find((r: { id: string }) => r.id === 'c-busy').available).toBe(false);
    expect(out.results.find((r: { id: string }) => r.id === 'c-free').available).toBe(true);
  });

  it('get_creator_detail reports a busy creator as busy', async () => {
    const db = fakeClient();
    const tools = createBookingTools(db, false);
    const out = await tools.get_creator_detail.execute({ crew_slug: 'busy-bee' });
    expect(db.rpcs).toEqual([{ fn: 'busy_creator_ids', args: { p_creator_ids: ['c-busy'] } }]);
    expect(db.tables).not.toContain('crew_requests');
    expect(JSON.stringify(out)).toMatch(/busy/i);
  });

  it('falls back to the direct read while 077 is not applied', async () => {
    const db = fakeClient({ rpcError: true, tableRows: { crew_requests: [{ creator_id: 'c-free' }] } });
    const busy = await getBusyCreatorIds(db, ['c-busy', 'c-free']);
    expect([...busy]).toEqual(['c-free']);
    expect(db.tables).toEqual(['crew_requests']);
  });

  it('asks about at most 100 distinct creators and nothing for an empty list', async () => {
    const db = fakeClient();
    await getBusyCreatorIds(db, Array.from({ length: 150 }, (_, i) => `c-${i % 120}`));
    expect((db.rpcs[0].args.p_creator_ids as string[]).length).toBe(100);
    const empty = fakeClient();
    expect((await getBusyCreatorIds(empty, [])).size).toBe(0);
    expect(empty.rpcs).toHaveLength(0);
  });
});
