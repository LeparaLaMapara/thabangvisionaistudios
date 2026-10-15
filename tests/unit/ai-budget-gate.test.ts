import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STUDIO } from '@/lib/constants';

// Month-to-date spend the fake admin client reports, and every insert it gets.
const state = { spend: 0, inserts: 0 };

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from() {
      return {
        select() {
          return { gte: () => Promise.resolve({ data: [{ estimated_cost: state.spend }], error: null }) };
        },
        insert() {
          state.inserts += 1;
          return { then: (cb: (r: { error: null }) => void) => cb({ error: null }) };
        },
      };
    },
  }),
}));

import { __resetBudgetCache, AiBudgetExceededError, AI_BUDGET_MESSAGE, isAiBudgetError } from '@/lib/ai/budget';
import { trackedCompletion } from '@/lib/ai/tracked';
import { generateWithFallback } from '@/lib/ai/resilient';
import { aiBudgetResponse } from '@/lib/ai/budget-response';

const BUDGET = STUDIO.ai.budget.monthlyBudgetZAR;
const PAID = Object.keys(STUDIO.ai.pricing)[0];

describe('monthly AI budget is enforced on every non-streaming call', () => {
  beforeEach(() => {
    __resetBudgetCache();
    state.spend = 0;
    state.inserts = 0;
  });

  it('trackedCompletion runs the call while under budget', async () => {
    state.spend = BUDGET / 2;
    const call = vi.fn(async () => ({ result: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }));
    await expect(trackedCompletion({ agentId: 't', provider: 'x', model: PAID, call })).resolves.toBe('ok');
    expect(call).toHaveBeenCalledOnce();
  });

  it('trackedCompletion refuses before spending a token once the budget is used', async () => {
    state.spend = BUDGET + 1;
    const call = vi.fn(async () => ({ result: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }));
    const p = trackedCompletion({ agentId: 't', provider: 'x', model: PAID, call });
    await expect(p).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(call).not.toHaveBeenCalled();
  });

  it('a known-free model is never refused (it costs nothing)', async () => {
    state.spend = BUDGET + 1;
    const call = vi.fn(async () => ({ result: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }));
    await expect(trackedCompletion({ agentId: 't', provider: 'google', model: 'gemma-4-31b-it', call })).resolves.toBe('ok');
  });

  it('generateWithFallback refuses over budget before any provider is called', async () => {
    state.spend = BUDGET + 1;
    await expect(generateWithFallback({ ref: 'smart', prompt: 'hi' })).rejects.toSatisfy(isAiBudgetError);
  });

  it('routes turn the refusal into a plain 503 message', async () => {
    const res = aiBudgetResponse(new AiBudgetExceededError(BUDGET + 1, BUDGET));
    expect(res?.status).toBe(503);
    const body = await res!.json();
    expect(body).toEqual({ error: AI_BUDGET_MESSAGE, code: 'AI_BUDGET_EXCEEDED' });
    expect(aiBudgetResponse(new Error('other'))).toBeNull();
  });
});
