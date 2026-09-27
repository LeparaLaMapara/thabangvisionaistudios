import { generateText, APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import { resolveEntry, buildModel, fallbackChain, providerDefault, type Provider, type ModelEntry } from './registry';
import { shouldFailover, markFailed, markHealthy, byHealth } from './health';

/**
 * Failover for AI calls — the reliability piece a gateway is supposed to have.
 *
 * The abstraction resolved one model and called it. If that provider was down,
 * rate-limiting, or timing out, the request simply died. Every real AI gateway
 * (LiteLLM, Portkey, Cloudflare, OpenRouter) fails over to another provider on a
 * retryable error; this is the local version of that.
 *
 * Applies to the NON-streaming path only, on purpose. Failing over a stream
 * cleanly means either buffering the first token or replaying a half-sent
 * response, both of which are their own risk; the streaming chat path keeps its
 * single-provider behaviour plus the budget gate. generateText callers — the
 * admin drafting routes, ratecard import, WhatsApp — get the resilience, which
 * is where a silent failure is worst because no human is watching.
 *
 * Each attempt is bounded by a timeout so one hung provider cannot hold the
 * function open to its maxDuration.
 */

/** Per-attempt ceiling. A model that has not started responding by here is dead to us. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ResilientParams {
  /** Model reference: a tier ("smart"/"fast"), provider, "provider:model", or "local". */
  ref?: string;
  system?: string;
  prompt?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Override the failover order; defaults to the configured chain. */
  providers?: Provider[];
}

export interface ResilientResult {
  text: string;
  /** Which provider actually served the response. */
  servedBy: Provider;
  modelId: string;
  /** Providers that failed before this one, with why. */
  attempts: { provider: Provider; error: string }[];
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Whether an error is worth failing over for.
 *
 * Retryable: timeouts, rate limits, and provider-side 5xx / network faults —
 * anything where a different provider might succeed. NOT retryable: a bad
 * request or an auth failure, which would fail identically everywhere and
 * should surface immediately rather than burn the whole chain.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true; // our timeout
  if (APICallError.isInstance(err)) {
    if (err.isRetryable) return true;
    const s = err.statusCode ?? 0;
    return s === 408 || s === 409 || s === 429 || s >= 500;
  }
  // Unknown/network errors: retryable. A clean provider will just answer.
  if (err instanceof Error) {
    return /timeout|network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(err.message);
  }
  return false;
}

/** The ordered list of entries to try: the requested model first, then the chain. */
function attemptOrder(ref: string | undefined, providers: Provider[]): ModelEntry[] {
  const first = resolveEntry(ref);
  const rest = providers
    .filter((p) => p !== first.provider)
    .map((p) => providerDefault(p));
  return byHealth([first, ...rest]);
}

async function callOnce(
  model: LanguageModel,
  params: ResilientParams,
  timeoutMs: number,
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await generateText({
      model,
      abortSignal: controller.signal,
      ...(params.system ? { system: params.system } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      ...(params.messages ? { messages: params.messages } : {}),
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });
    return {
      text: res.text,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a completion with timeout and provider failover.
 *
 * Throws only if EVERY provider in the chain fails — the last error is
 * re-thrown, with the full attempt log attached for the caller to record.
 */
export async function generateWithFallback(params: ResilientParams): Promise<ResilientResult> {
  const providers = params.providers ?? fallbackChain();
  const order = attemptOrder(params.ref, providers);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts: { provider: Provider; error: string }[] = [];

  let lastError: unknown;

  for (const entry of order) {
    try {
      const model = buildModel(entry);
      const out = await callOnce(model, params, timeoutMs);
      markHealthy(entry.provider);
      return {
        text: out.text,
        servedBy: entry.provider,
        modelId: entry.modelId,
        attempts,
        usage: out.usage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: entry.provider, error: message });
      lastError = err;

      markFailed(entry.provider, err);
      // Only a request that is itself broken stops the chain; an account
      // problem (credit, key, quota) at one provider hands over to the next.
      if (!shouldFailover(err)) break;
    }
  }

  const summary = attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ');
  throw new Error(`[ai] all providers failed — ${summary}`, { cause: lastError });
}
