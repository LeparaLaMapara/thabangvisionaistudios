import type { SupabaseClient } from '@supabase/supabase-js';
import { STUDIO } from '@/lib/constants';

/**
 * The enforced spend ceiling for AI.
 *
 * Before this, the only guard was a cron that ran once a day and sent an email
 * at 80% and 100%. Between runs, spend was uncapped: a runaway loop or someone
 * rotating IPs past the per-minute guest limit could drive the bill arbitrarily
 * high, and nobody would know until noon. An alert is not a control.
 *
 * This is the control. It reads month-to-date spend from ai_token_usage and
 * refuses new calls once the hard ceiling is crossed. It is a backstop against
 * catastrophe, not a billing meter — so it trades perfect precision for being
 * cheap enough to run on every request:
 *
 *   - The monthly sum is cached per-lambda for a short window, so a burst of
 *     requests does not become a burst of COUNT queries.
 *   - Each allowed request optimistically adds its own estimate to the cached
 *     figure, so the cache trends up between refreshes rather than sitting
 *     stale. Overshoot is bounded by (concurrent instances x one request),
 *     which against a monthly rand cap is immaterial.
 *
 * Precise cross-instance enforcement would need an atomic counter like the
 * durable rate limiter. For a monthly budget backstop that is over-engineering;
 * this catches the runaway and the abuse, which is the point.
 */

/** Fraction of the monthly budget at which new calls are refused. */
const HARD_CEILING = 1.0;

/** How long a fetched monthly total is trusted before re-reading, in ms. */
const CACHE_TTL_MS = 60_000;

interface BudgetState {
  /** Rand spent this billing month, as last read plus optimistic additions. */
  spent: number;
  /** Epoch ms when `spent` was last read from the database. */
  readAt: number;
  /** The month key the cache belongs to, so a month rollover invalidates it. */
  monthKey: string;
}

// Per-lambda. Deliberately module-level, like the in-memory rate-limit fallback.
let cache: BudgetState | null = null;

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
}

function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface BudgetVerdict {
  allowed: boolean;
  spent: number;
  budget: number;
  /** 0..1+, spent over budget. */
  ratio: number;
}

/**
 * Read month-to-date AI spend, using the cache when it is fresh.
 *
 * Never throws: a failed read returns the last known figure, or zero on a cold
 * cache. Failing open is the right call for a cost backstop — a database blip
 * must not take the assistant down — and the daily cron remains the belt to
 * this brace.
 */
async function readMonthlySpend(db: SupabaseClient, now: Date): Promise<number> {
  const key = monthKey(now);

  if (cache && cache.monthKey === key && now.getTime() - cache.readAt < CACHE_TTL_MS) {
    return cache.spent;
  }

  try {
    // A backstop must never become the thing that hangs a request. If the read
    // does not return quickly, treat it as unavailable and fail open — the
    // daily cron still measures spend across instances.
    const read = db
      .from('ai_token_usage')
      .select('estimated_cost')
      .gte('created_at', monthStartIso(now));

    const timeout = new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: 'budget read timed out' } }), 2_000),
    );

    const { data, error } = await Promise.race([read, timeout]);

    if (error) {
      console.error('[ai/budget] read failed, using cached/zero:', error.message);
      return cache?.monthKey === key ? cache.spent : 0;
    }

    const spent = (data ?? []).reduce(
      (sum, r) => sum + (Number((r as { estimated_cost: number }).estimated_cost) || 0),
      0,
    );
    cache = { spent, readAt: now.getTime(), monthKey: key };
    return spent;
  } catch (err) {
    console.error('[ai/budget] read threw, using cached/zero:', err);
    return cache?.monthKey === key ? cache.spent : 0;
  }
}

/**
 * Whether an AI call may proceed under the monthly ceiling.
 *
 * Call BEFORE spending tokens. `estimatedCost` is this call's own worst-case
 * cost; it is added to the running figure whether or not the call is allowed to
 * proceed, so a series of borderline requests converges on the ceiling instead
 * of each seeing the same stale total.
 */
export async function checkAiBudget(
  db: SupabaseClient,
  estimatedCost = 0,
  now: Date = new Date(),
): Promise<BudgetVerdict> {
  const budget = STUDIO.ai.budget.monthlyBudgetZAR;
  const spent = await readMonthlySpend(db, now);
  const ratio = budget > 0 ? spent / budget : 0;
  const allowed = budget <= 0 || spent < budget * HARD_CEILING;

  // Trend the cache upward so concurrent requests do not all read the same
  // pre-call figure. Bounded and self-correcting: the next real read replaces it.
  if (cache && cache.monthKey === monthKey(now)) {
    cache.spent += Math.max(0, estimatedCost);
  }

  return { allowed, spent, budget, ratio };
}

/** Test seam: drop the per-lambda cache. */
export function __resetBudgetCache(): void {
  cache = null;
}
