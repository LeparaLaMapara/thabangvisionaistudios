import { APICallError } from 'ai';
import type { ModelEntry, Provider } from './registry';

/**
 * Which errors hand a request to the next provider, and a short memory of
 * providers that just failed.
 *
 * The rule is "any configured provider takes over": an error from provider A
 * says nothing about provider B. The one exception is a request that is itself
 * broken (a genuine 400 about the prompt), which would fail everywhere.
 *
 * Anthropic reports an empty credit balance as a 400 "invalid_request_error";
 * treating every 400 as "the request is broken" is exactly what stopped the
 * live assistant from failing over on 2026-09-27. Account problems (billing,
 * credit, quota, keys, permissions, unknown model) are recognised by their
 * message and always fail over.
 */

const ACCOUNT_PROBLEM = /credit|billing|balance|quota|insufficient|payment|plan|exceeded|limit|permission|forbidden|unauthori[sz]ed|api key|not[ _-]?found|model|deprecated|disabled|suspended/i;

export function errorText(err: unknown): string {
  if (APICallError.isInstance(err)) return `${err.statusCode ?? ''} ${err.message} ${err.responseBody ?? ''}`;
  return err instanceof Error ? err.message : String(err);
}

/** Should the request move on to the next provider? */
export function shouldFailover(err: unknown): boolean {
  if (APICallError.isInstance(err) && err.statusCode === 400) {
    return ACCOUNT_PROBLEM.test(errorText(err));
  }
  return true; // 401/403/404/429/5xx, timeouts, network, config: another provider may work
}

/**
 * How long to put a provider at the back of the queue after an error.
 * Account problems last until someone acts (10 minutes, then it is tried again);
 * rate limits and outages are usually short.
 */
export function cooldownMs(err: unknown): number {
  const text = errorText(err);
  if (APICallError.isInstance(err)) {
    const s = err.statusCode ?? 0;
    if (s === 401 || s === 403 || (s === 400 && ACCOUNT_PROBLEM.test(text))) return 10 * 60_000;
    if (s === 429) return 60_000;
    if (s >= 500) return 2 * 60_000;
  }
  if (/credit|billing|quota|api key|not set/i.test(text)) return 10 * 60_000;
  return 30_000;
}

// Per server instance. Enough to stop every chat message from first paying a
// failed round trip to a provider that is out of credit.
const downUntil = new Map<Provider, { until: number; reason: string }>();

export function markFailed(provider: Provider, err: unknown, now = Date.now()): void {
  downUntil.set(provider, { until: now + cooldownMs(err), reason: errorText(err).slice(0, 200) });
}

export function markHealthy(provider: Provider): void {
  downUntil.delete(provider);
}

export function isCoolingDown(provider: Provider, now = Date.now()): boolean {
  const d = downUntil.get(provider);
  return !!d && d.until > now;
}

/** Healthy providers first, in their configured order; ones that just failed go last (never dropped). */
export function byHealth(entries: ModelEntry[], now = Date.now()): ModelEntry[] {
  const healthy = entries.filter((e) => !isCoolingDown(e.provider, now));
  const cooling = entries.filter((e) => isCoolingDown(e.provider, now));
  return [...healthy, ...cooling];
}

export function resetHealth(): void {
  downUntil.clear();
}

/** The message a customer sees when every provider failed. Never a provider's raw error. */
export const ASSISTANT_UNAVAILABLE =
  'Ubunye is unavailable right now. You can still browse and book gear and creators on the site, or contact us and a person will help.';
