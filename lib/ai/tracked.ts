import { createAdminClient } from '@/lib/supabase/server';
import { estimateCostZAR } from './pricing';
import { assertAiBudget } from './budget';

export interface TrackedUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TrackedCompletionParams<T> {
  agentId: string;
  provider: 'anthropic' | 'google' | 'openai' | string;
  model: string;
  userId?: string | null;
  /** Worst-case rand cost of this call, charged against the monthly budget. */
  estimatedCost?: number;
  call: () => Promise<{ result: T; usage: TrackedUsage }>;
}

/** Rough worst-case size of one non-streaming call, used when the caller gives none. */
const DEFAULT_ESTIMATE_TOKENS = { input: 4000, output: 1500 };

function fireAndForgetInsert(row: {
  user_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
}): void {
  if (row.total_tokens <= 0) return;
  try {
    const admin = createAdminClient();
    admin.from('ai_token_usage').insert(row).then(
      ({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[tracked-completion] insert:', error.message);
      },
    );
  } catch (err) {
    console.error('[tracked-completion] insert threw:', err);
  }
}

/**
 * Wraps an AI call, enforces the monthly AI budget, writes one row to
 * `ai_token_usage`, and logs latency. Throws AiBudgetExceededError (before any
 * tokens are spent) when the month's ceiling is crossed; never fails the
 * caller if logging fails.
 */
export async function trackedCompletion<T>(
  params: TrackedCompletionParams<T>,
): Promise<T> {
  const estimate = params.estimatedCost
    ?? estimateCostZAR(params.model, DEFAULT_ESTIMATE_TOKENS.input, DEFAULT_ESTIMATE_TOKENS.output);
  // A known-free model (estimate 0) costs nothing, so it is never refused.
  if (estimate > 0) await assertAiBudget(estimate);

  const started = Date.now();
  const { result, usage } = await params.call();
  const latencyMs = Date.now() - started;

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = estimateCostZAR(params.model, inputTokens, outputTokens);

  fireAndForgetInsert({
    user_id: params.userId ?? null,
    model: params.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_cost: estimatedCost,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[ai] ${params.agentId} · ${params.provider}/${params.model} · ` +
      `${totalTokens} tok · R${estimatedCost.toFixed(4)} · ${latencyMs}ms`,
    );
  }

  return result;
}

/**
 * Log usage without wrapping the call (for streaming APIs that deliver
 * tokens via an onFinish callback after the response has started).
 */
export function logTokenUsage(params: {
  agentId: string;
  provider: string;
  model: string;
  userId?: string | null;
  usage: TrackedUsage;
}): void {
  const { inputTokens, outputTokens } = params.usage;
  const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  if (totalTokens <= 0) return;

  fireAndForgetInsert({
    user_id: params.userId ?? null,
    model: params.model,
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    total_tokens: totalTokens,
    estimated_cost: estimateCostZAR(params.model, inputTokens ?? 0, outputTokens ?? 0),
  });
}
