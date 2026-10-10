/**
 * Phase 5: a signed-in person's daily Ubunye message is counted only once a
 * reply starts (onServed), never for a reply that failed. The limit check
 * itself still runs before the model is called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordAnsweredMessage } from '@/lib/agents/usage';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  usage: [] as Row[],
  writes: [] as { op: string; values: Row }[],
  serve: true,
  limitCount: 0,
}));

function fakeDb() {
  return {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let update: Row | null = null;
      const rows = () => (table === 'ubunye_usage' ? state.usage.filter((r) => filters.every(([k, v]) => r[k] === v)) : []);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        single: async () => ({ data: table === 'subscriptions' ? null : rows()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (v: Row) => { update = v; return b; },
        insert: async (v: Row) => { state.writes.push({ op: 'insert', values: v }); state.usage.push({ id: `u${state.usage.length + 1}`, ...v }); return { error: null }; },
        then: (resolve: (r: unknown) => void) => {
          if (update) {
            state.writes.push({ op: 'update', values: update });
            rows().forEach((r) => Object.assign(r, update));
          }
          resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ ...fakeDb(), auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }),
  createAdminClient: () => fakeDb(),
}));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/ai', () => ({ getModelId: () => 'model-smart', routeQuery: () => ({ tier: 'smart', modelId: 'model-smart' }) }));
vi.mock('@/lib/ai/tracked', () => ({ logTokenUsage: () => undefined }));
vi.mock('@/lib/ai/pricing', () => ({ estimateCostZAR: () => 0.1 }));
vi.mock('@/lib/ai/budget', () => ({ checkAiBudget: async () => ({ allowed: true, spent: 0, budget: 100 }) }));
vi.mock('@/lib/http/clientIp', () => ({ clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/ubunye/system-prompt', () => ({ fetchPlatformData: async () => ({}), fetchUserContext: async () => null, buildSystemPrompt: () => 'system' }));
vi.mock('@/lib/agents/agents/assistant', () => ({
  assistantAgent: { id: 'assistant', rateLimit: { guest: 5, free: 20, pro: 100, studio: -1 } },
  buildAssistantPrompt: () => 'system',
}));
vi.mock('@/lib/agents/agents/booking', () => ({ bookingAgent: { id: 'booking', rateLimit: { guest: 0, free: 20, pro: 100, studio: -1 } }, buildBookingPrompt: () => 'system' }));
vi.mock('@/lib/features', () => ({ getFlags: async () => ({ smart_productions: false }) }));
vi.mock('@/lib/rag', () => ({ isRagEnabled: () => false, searchSimilar: async () => [], formatRetrievalContext: () => '' }));
vi.mock('@/lib/agents/tools/search', () => ({ createSearchTools: () => ({}) }));
vi.mock('@/lib/agents/tools/booking', () => ({ createBookingTools: () => ({}) }));
vi.mock('@/lib/agents/tools/delivery', () => ({ createDeliveryTools: () => ({}) }));
vi.mock('@/lib/data/chat-history', () => ({
  createConversation: async () => 'conv-1',
  logChatMessage: () => undefined,
  hashIp: () => 'hash',
  conversationBelongsTo: async () => true,
}));
vi.mock('@/lib/agent/repo', () => ({ SupabaseAgentActions: class { async pending() { return null; } } }));
vi.mock('@/lib/agent/prompt', () => ({ pendingProposalBlock: () => '' }));
vi.mock('@/lib/ai/resilient-stream', () => ({
  // Stands in for the provider chain: either a reply starts (onServed) or every provider fails.
  streamWithFallback: (p: { onServed?: (e: { modelId: string; provider: string }, n: number) => void }) => {
    if (state.serve) p.onServed?.({ modelId: 'model-smart', provider: 'anthropic' }, 0);
    return new Response('stream');
  },
}));

const ask = async (): Promise<Response> => {
  const { executeAgent } = await import('@/lib/agents/runtime');
  const req = new NextRequest('http://localhost/api/ubunye-chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What lenses can I rent?' }] }),
  });
  return executeAgent('assistant', req);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.usage = [];
  state.writes = [];
  state.serve = true;
});

describe('signed-in Ubunye usage', () => {
  it('a reply that never starts does not use up a message', async () => {
    state.serve = false;
    const res = await ask();
    await flush();
    expect(res.status).toBe(200);
    expect(state.writes).toEqual([]);
  });

  it('an answered message is counted once', async () => {
    await ask();
    await flush();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ op: 'insert', values: { user_id: 'user-1', message_count: 1 } });
    await ask();
    await flush();
    expect(state.writes[1]).toMatchObject({ op: 'update', values: { message_count: 2 } });
  });

  it('the daily limit is still enforced before any model call', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    state.usage = [{ id: 'u1', user_id: 'user-1', date: today, message_count: 20 }];
    const res = await ask();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'limit_reached', limit: 20 });
    expect(state.writes).toEqual([]);
  });
});

describe('recordAnsweredMessage', () => {
  it('re-reads the row, so concurrent answers are not lost', async () => {
    state.usage = [{ id: 'u1', user_id: 'user-1', date: '2026-10-10', message_count: 3 }];
    await recordAnsweredMessage(fakeDb(), { userId: 'user-1', date: '2026-10-10' });
    expect(state.usage[0].message_count).toBe(4);
  });
});
