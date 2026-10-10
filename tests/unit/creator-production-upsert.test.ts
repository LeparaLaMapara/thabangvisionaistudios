import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Found by the local journey tests: finishing creator onboarding always
 * failed with "Failed to create production listing." The production was
 * written with upsert(onConflict: 'creator_id'), but the only uniqueness on
 * creator_id is a PARTIAL index (migration 035), which ON CONFLICT cannot
 * target, so Postgres refused every call. Now: update the live row, else
 * insert; an insert that loses a race updates instead. Never an upsert.
 */

type Call = { op: string; table: string; payload?: Record<string, unknown>; filters: Array<[string, string, unknown]> };
const calls: Call[] = [];
let liveRows = 0;
let insertError: { code?: string; message: string } | null = null;
let raceWinner = false;

function builder(table: string) {
  const call: Call = { op: 'select', table, filters: [] };
  const b = {
    select: () => b,
    update: (p: Record<string, unknown>) => { call.op = 'update'; call.payload = p; return b; },
    insert: (p: Record<string, unknown>) => {
      call.op = 'insert'; call.payload = p; calls.push(call);
      if (insertError?.code === '23505') raceWinner = true;
      return Promise.resolve({ error: insertError });
    },
    upsert: () => { throw new Error('upsert must not be used: creator_id is only a partial unique index'); },
    eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return b; },
    is: (k: string, v: unknown) => { call.filters.push(['is', k, v]); return b; },
    single: () => Promise.resolve({ data: { id: 'creator-1', display_name: 'Cebo', crew_slug: 'cebo', bio: 'Bio', specializations: ['photography'], skills: ['Photography'], hourly_rate: 900, portfolio_projects: [], crew_featured: false }, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      calls.push(call);
      const found = call.op === 'update' ? liveRows + (raceWinner ? 1 : 0) : 0;
      return Promise.resolve({ data: Array.from({ length: found }, (_, i) => ({ id: `p${i}` })), error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));

import { createCreatorProduction } from '@/lib/supabase/queries/smartProductions';

beforeEach(() => {
  calls.length = 0;
  liveRows = 0;
  insertError = null;
  raceWinner = false;
});

describe('createCreatorProduction', () => {
  it('inserts the first production for a creator', async () => {
    expect(await createCreatorProduction('creator-1')).toEqual({ success: true });
    const ops = calls.filter((c) => c.table === 'smart_productions').map((c) => c.op);
    expect(ops).toEqual(['update', 'insert']);
    const insert = calls.find((c) => c.op === 'insert')!;
    expect(insert.payload).toMatchObject({ creator_id: 'creator-1', slug: 'cebo', is_published: false });
  });

  it('updates the live production instead of inserting a second one', async () => {
    liveRows = 1;
    expect(await createCreatorProduction('creator-1')).toEqual({ success: true });
    const update = calls.find((c) => c.table === 'smart_productions' && c.op === 'update')!;
    expect(update.filters).toEqual([['eq', 'creator_id', 'creator-1'], ['is', 'deleted_at', null]]);
    expect(update.payload).not.toHaveProperty('created_at');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('a lost insert race (unique violation) updates the winner instead', async () => {
    insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect(await createCreatorProduction('creator-1')).toEqual({ success: true });
    expect(calls.filter((c) => c.table === 'smart_productions').map((c) => c.op)).toEqual(['update', 'insert', 'update']);
  });

  it('reports any other insert failure', async () => {
    insertError = { code: '42501', message: 'permission denied' };
    expect(await createCreatorProduction('creator-1')).toEqual({ success: false, error: 'permission denied' });
  });
});
