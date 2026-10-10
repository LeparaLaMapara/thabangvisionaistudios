/**
 * Phase 6 security LLM-6: /api/agents/rates and /api/agents/bio-writer read
 * ubunye_usage, compared, then wrote count + 1, so parallel requests inside
 * the burst window all saw the same count and passed the daily cap. They now
 * reserve a slot atomically (078 ubunye_reserve_message) and give it back
 * when nothing was produced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({ count: 0, tableReads: 0, rpcCalls: [] as string[], failModel: false }));

function fakeAdmin() {
  return {
    rpc: async (fn: string, args: { p_limit?: number }) => {
      db.rpcCalls.push(fn);
      // A yield, so parallel requests really interleave.
      await new Promise((r) => setTimeout(r, 1));
      if (fn === 'ubunye_reserve_message') {
        if (db.count >= (args.p_limit ?? 0)) return { data: null, error: null };
        db.count += 1;
        return { data: db.count, error: null };
      }
      if (fn === 'ubunye_release_message') {
        db.count = Math.max(0, db.count - 1);
        return { data: null, error: null };
      }
      return { data: null, error: { message: fn } };
    },
    // The old read-then-write path: every parallel read sees the same count.
    from: (table: string) => {
      const snapshot = db.count;
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, order: () => b, limit: async () => ({ data: [] }),
        single: async () => {
          if (table === 'ubunye_usage') { db.tableReads += 1; await new Promise((r) => setTimeout(r, 1)); return { data: snapshot ? { id: 'u', message_count: snapshot } : null }; }
          return { data: { display_name: 'T', location: 'Jhb', years_experience: 2 } };
        },
        update: () => ({ eq: async () => { db.count = snapshot + 1; return { error: null }; } }),
        insert: async () => { db.count = snapshot + 1; return { error: null }; },
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ error: null, user: { id: 'u1', email: 'u@example.com' } }),
  checkNotSuspended: async () => ({ suspended: false }),
  checkRateLimit: async () => true,
}));
vi.mock('@/lib/agents/tools/pricing', () => ({ suggestRates: async () => [{ r: 1 }], compareMarketRates: async () => ({}) }));
vi.mock('@/lib/ai/tracked', () => ({
  trackedCompletion: async () => { if (db.failModel) throw new Error('model down'); return 'A bio.'; },
}));

const rates = await import('@/app/api/agents/rates/route');
const bio = await import('@/app/api/agents/bio-writer/route');
const { bioWriterAgent } = await import('@/lib/agents/agents/bio-writer');

const callRates = (body: unknown = { action: 'suggest-rates' }) =>
  rates.POST(new NextRequest('http://localhost/api/agents/rates', { method: 'POST', body: JSON.stringify(body) }));
const callBio = () => bio.POST(new NextRequest('http://localhost/api/agents/bio-writer', { method: 'POST', body: '{}' }));

beforeEach(() => {
  db.count = 0;
  db.tableReads = 0;
  db.rpcCalls = [];
  db.failModel = false;
});

describe('rates: daily cap holds under parallel requests', () => {
  it('15 parallel requests at a cap of 10: exactly 10 answered', async () => {
    const statuses = (await Promise.all(Array.from({ length: 15 }, () => callRates()))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(db.count).toBe(10);
    expect(db.tableReads).toBe(0);
  });

  it('an invalid action gives the slot back', async () => {
    expect((await callRates({ action: 'nope' })).status).toBe(400);
    expect(db.count).toBe(0);
  });
});

describe('bio-writer: daily cap holds under parallel requests', () => {
  it(`parallel requests never pass the cap (${bioWriterAgent.rateLimit.free})`, async () => {
    const limit = bioWriterAgent.rateLimit.free;
    const statuses = (await Promise.all(Array.from({ length: limit + 5 }, () => callBio()))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(limit);
    expect(db.count).toBe(limit);
    expect(db.tableReads).toBe(0);
  });

  it('a failed generation gives the slot back', async () => {
    db.failModel = true;
    expect((await callBio()).status).toBe(500);
    expect(db.count).toBe(0);
    expect(db.rpcCalls).toEqual(['ubunye_reserve_message', 'ubunye_release_message']);
  });
});
