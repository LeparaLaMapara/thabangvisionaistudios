/**
 * Phase 6 security LLM-4 / LLM-5: Ubunye accepted a 2 MB message, passed no
 * output-token cap, and a hijacked model could run 20 tool calls per step
 * (80 per message). Limits: STUDIO.security.chat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { capToolCalls, limitChatMessages, TOOL_LIMIT_RESULT } from '@/lib/agents/request-limits';

const state = vi.hoisted(() => ({
  count: 0,
  limitSeen: [] as number[],
  calls: [] as string[],
  serve: true,
  budget: true,
  rpcError: null as null | { code?: string; message: string },
  modelCalls: 0,
  streamParams: [] as Array<Record<string, unknown>>,
  toolRuns: 0,
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
        update: () => b,
        insert: async () => ({ error: null }),
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
vi.mock('@/lib/agents/tools/search', () => ({
  createSearchTools: () => ({
    search_gear: { description: 'x', execute: async () => { state.toolRuns += 1; return { results: [] }; } },
  }),
}));
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
    state.streamParams.push(p as unknown as Record<string, unknown>);
    if (state.serve) p.onServed?.({ modelId: 'model-smart', provider: 'anthropic' }, 0);
    const settled = Promise.resolve().then(() => p.onSettled?.(state.serve));
    return new Response(new ReadableStream({ async start(c) { await settled; c.close(); } }));
  },
}));


const post = async (body: unknown): Promise<Response> => {
  const { executeAgent } = await import('@/lib/agents/runtime');
  return executeAgent('assistant', new NextRequest('http://localhost/api/ubunye-chat', { method: 'POST', body: JSON.stringify(body) }));
};

beforeEach(() => {
  state.count = 0;
  state.calls = [];
  state.modelCalls = 0;
  state.streamParams = [];
  state.toolRuns = 0;
  state.serve = true;
  state.budget = true;
  state.rpcError = null;
});

describe('chat request limits (LLM-4)', () => {
  it('a 2 MB message is refused with 413 before any model call or slot', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'x'.repeat(2_000_000) }] });
    expect(res.status).toBe(413);
    expect(state.modelCalls).toBe(0);
    expect(state.calls).toEqual([]);
  });

  it('a newest message over the character cap is refused', async () => {
    const res = await post({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'y'.repeat(STUDIO.security.chat.maxMessageChars + 1) }] }] });
    expect(res.status).toBe(413);
    expect(state.modelCalls).toBe(0);
  });

  it('the stream gets maxOutputTokens and only the recent history', async () => {
    const history = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    history.push({ role: 'user', content: 'What lenses can I rent?' });
    const res = await post({ messages: history });
    await res.text();
    expect(res.status).toBe(200);
    const p = state.streamParams[0];
    expect(p.maxOutputTokens).toBe(STUDIO.security.chat.maxOutputTokens);
    expect((p.messages as unknown[]).length).toBeLessThanOrEqual(STUDIO.security.chat.maxHistoryMessages);
    expect((p.messages as Array<{ role: string }>)[0].role).toBe('user');
  });
});

describe('tool calls per message (LLM-5)', () => {
  it('the runtime hands the model capped tools: the 9th call does not run', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'What lenses can I rent?' }] });
    await res.text();
    const tools = state.streamParams[0].tools as Record<string, { execute: (a: unknown) => Promise<unknown> }>;
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await tools.search_gear.execute({}));
    expect(state.toolRuns).toBe(STUDIO.security.chat.maxToolCallsPerMessage);
    expect(results.at(-1)).toEqual(TOOL_LIMIT_RESULT);
  });

  it('capToolCalls shares one budget across tools', async () => {
    let runs = 0;
    const tools = capToolCalls({ a: { execute: async () => ++runs }, b: { execute: async () => ++runs }, c: { description: 'no execute' } }, 3);
    await tools.a.execute(); await tools.b.execute(); await tools.a.execute();
    expect(await tools.b.execute()).toEqual(TOOL_LIMIT_RESULT);
    expect(runs).toBe(3);
    expect(tools.c).toEqual({ description: 'no execute' });
  });

  it('limitChatMessages keeps a user-first tail', () => {
    const r = limitChatMessages([{ role: 'assistant' }, { role: 'user', content: 'hi' }]);
    expect(r.ok && (r.messages[0] as { role: string }).role).toBe('user');
  });
});
