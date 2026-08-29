import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAiBudget, __resetBudgetCache } from '@/lib/ai/budget';
import { estimateCostZAR } from '@/lib/ai/pricing';
import { STUDIO } from '@/lib/constants';

/** A minimal Supabase-like stub whose ai_token_usage sum is fixed. */
function dbWithSpend(total: number, onRead?: () => void) {
  return {
    from() {
      return {
        select() {
          return {
            gte() {
              onRead?.();
              // one row carrying the whole total
              return Promise.resolve({ data: [{ estimated_cost: total }], error: null });
            },
          };
        },
      };
    },
  } as never;
}

const NOW = new Date('2026-08-29T10:00:00.000Z');

describe('checkAiBudget', () => {
  beforeEach(() => __resetBudgetCache());

  it('allows a call when spend is under budget', async () => {
    const v = await checkAiBudget(dbWithSpend(100), 1, NOW);
    expect(v.allowed).toBe(true);
    expect(v.budget).toBe(STUDIO.ai.budget.monthlyBudgetZAR);
  });

  it('refuses a call once spend has reached the ceiling', async () => {
    const over = STUDIO.ai.budget.monthlyBudgetZAR + 1;
    const v = await checkAiBudget(dbWithSpend(over), 1, NOW);
    expect(v.allowed).toBe(false);
    expect(v.ratio).toBeGreaterThan(1);
  });

  it('refuses exactly at the budget, not only past it', async () => {
    const v = await checkAiBudget(dbWithSpend(STUDIO.ai.budget.monthlyBudgetZAR), 0, NOW);
    expect(v.allowed).toBe(false);
  });

  it('reads once, then serves from cache within the window', async () => {
    const reads = vi.fn();
    const db = dbWithSpend(50, reads);
    await checkAiBudget(db, 0, NOW);
    await checkAiBudget(db, 0, new Date(NOW.getTime() + 1000));
    await checkAiBudget(db, 0, new Date(NOW.getTime() + 2000));
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the cache window expires', async () => {
    const reads = vi.fn();
    const db = dbWithSpend(50, reads);
    await checkAiBudget(db, 0, NOW);
    await checkAiBudget(db, 0, new Date(NOW.getTime() + 61_000));
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('trends the cached figure up between reads, so a burst converges on the ceiling', async () => {
    // Start just under budget, then charge repeatedly without re-reading.
    const near = STUDIO.ai.budget.monthlyBudgetZAR - 10;
    const db = dbWithSpend(near);
    const first = await checkAiBudget(db, 20, NOW);
    expect(first.allowed).toBe(true);
    // Next call sees near+20, now over budget, still inside the cache window.
    const second = await checkAiBudget(db, 20, new Date(NOW.getTime() + 500));
    expect(second.allowed).toBe(false);
  });

  it('fails open on a read error rather than taking the assistant down', async () => {
    const db = {
      from() {
        return { select() { return { gte() {
          return Promise.resolve({ data: null, error: { message: 'boom' } });
        } }; } };
      },
    } as never;
    const v = await checkAiBudget(db, 0, NOW);
    expect(v.allowed).toBe(true);
  });
});

describe('estimateCostZAR — accounting cannot be blinded', () => {
  it('prices a known model from the table', () => {
    const cost = estimateCostZAR('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });

  it('charges an UNKNOWN model at worst case, never zero', () => {
    // The bug this replaces: an unpriced model recorded R0 and blinded the
    // budget. A new/misconfigured model id must over-count, not vanish.
    const unknown = estimateCostZAR('some-new-model-2027', 1_000_000, 1_000_000);
    const known = estimateCostZAR('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeGreaterThanOrEqual(known);
  });

  it('keeps a deliberately free model at zero', () => {
    expect(estimateCostZAR('gemma-4-31b-it', 1_000_000, 1_000_000)).toBe(0);
  });

  it('treats negative or non-finite token counts as zero tokens', () => {
    expect(estimateCostZAR('gemini-2.0-flash', -5, Number.NaN)).toBe(0);
  });
});
