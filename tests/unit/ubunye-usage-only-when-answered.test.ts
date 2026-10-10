/**
 * Phase 5 (D-68, review fix): a signed-in person's daily Ubunye slot is
 * RESERVED atomically before the model is called (078
 * ubunye_reserve_message), and RELEASED if no reply ever starts: every
 * provider failed, the AI budget refused, or the request broke first. At the
 * limit the RPC refuses and no model is called. Concurrency is proved in SQL
 * (scripts/db/078-concurrency.test.sh).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { releaseMessage, reserveMessage } from '@/lib/agents/usage';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  count: 0,
  limitSeen: [] as number[],
  calls: [] as string[],
  serve: true,
  budget: true,
  rpcError: null as null | { code?: string; message: string },
  modelCalls: 0,
}));

/** Stands in for 078: reserve under the limit, release never below 0. */
function fakeDb() {
  return {
    rpc: async (fn: string, args: { p_limit?: number }) => {
      state.calls.push(fn);
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (fn === 'ubunye_reserve_message') {
        state.limitSeen.push(args.p_limit ?? -1);
        if (state.count >= (args.p_limit ?? 0)) return { data: null, error: null };
        state.count += 1;
        return { data: state.count, error: null };
      }
      if (fn === 'ubunye_release_message') {
        state.count = Math.max(0, state.count - 1);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    },
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
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
vi.mock('@/lib/ai/budget', () => ({ checkAiBudget: async () => ({ allowed: state.budget, spent: 0, budget: 100 }) }));
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
  // Stands in for the provider chain: a reply starts (onServed) or every
  // provider fails; then the stream settles, as the real one does, before closing.
  streamWithFallback: (p: { onServed?: (e: { modelId: string; provider: string }, n: number) => void; onSettled?: (served: boolean) => Promise<void> | void }) => {
    state.modelCalls += 1;
    if (state.serve) p.onServed?.({ modelId: 'model-smart', provider: 'anthropic' }, 0);
    const settled = Promise.resolve().then(() => p.onSettled?.(state.serve));
    return new Response(new ReadableStream({ async start(c) { await settled; c.close(); } }));
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

const finish = async (res: Response) => { await res.text(); };

beforeEach(() => {
  state.count = 0;
  state.limitSeen = [];
  state.calls = [];
  state.serve = true;
  state.budget = true;
  state.rpcError = null;
  state.modelCalls = 0;
});

describe('signed-in Ubunye usage: reserve, then release if no reply starts', () => {
  it('an answered message keeps its slot (reserved once, never released)', async () => {
    const res = await ask();
    await finish(res);
    expect(res.status).toBe(200);
    expect(state.count).toBe(1);
    expect(state.calls).toEqual(['ubunye_reserve_message']);
    expect(state.limitSeen).toEqual([20]); // the assistant's free-plan limit, unchanged
  });

  it('a reply that never starts gives the slot back, once the stream settles', async () => {
    state.serve = false;
    const res = await ask();
    await finish(res);
    expect(state.calls).toEqual(['ubunye_reserve_message', 'ubunye_release_message']);
    expect(state.count).toBe(0);
  });

  it('an AI budget refusal gives the slot back', async () => {
    state.budget = false;
    const res = await ask();
    expect(res.status).toBe(503);
    expect(state.modelCalls).toBe(0);
    expect(state.count).toBe(0);
    expect(state.calls).toEqual(['ubunye_reserve_message', 'ubunye_release_message']);
  });

  it('at the limit the reserve is refused: 429 and no model call', async () => {
    state.count = 20;
    const res = await ask();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'limit_reached', limit: 20 });
    expect(state.modelCalls).toBe(0);
    expect(state.count).toBe(20);
  });

  it('a database error refuses (fails closed) without calling the model', async () => {
    state.rpcError = { code: 'XX000', message: 'boom' };
    const res = await ask();
    expect(res.status).toBe(503);
    expect(state.modelCalls).toBe(0);
  });

  it('before 078 is applied the message is answered but not counted (logged loudly)', async () => {
    state.rpcError = { code: 'PGRST202', message: 'Could not find the function public.ubunye_reserve_message' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await ask();
    await finish(res);
    expect(res.status).toBe(200);
    expect(err.mock.calls.some((c) => String(c[0]).includes('078'))).toBe(true);
    err.mockRestore();
  });
});

describe('reserveMessage / releaseMessage', () => {
  it('map the RPC answers', async () => {
    expect(await reserveMessage(fakeDb(), { userId: 'u', date: '2026-10-10', limit: 1 })).toEqual({ kind: 'reserved', count: 1 });
    expect(await reserveMessage(fakeDb(), { userId: 'u', date: '2026-10-10', limit: 1 })).toEqual({ kind: 'limit_reached' });
    await releaseMessage(fakeDb(), { userId: 'u', date: '2026-10-10' });
    expect(state.count).toBe(0);
  });
});
