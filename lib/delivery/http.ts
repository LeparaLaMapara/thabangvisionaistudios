import type { ProviderCallResult } from '@/lib/core/ports';

/**
 * Shared HTTP plumbing for courier adapters (spec Phase 4 §4.15). Server only.
 *
 * Every courier call is classified by what we KNOW happened, so the core can
 * tell a refusal from an unknown outcome:
 *
 *   2xx                          → ok
 *   401 / 403                    → rejected (credentials or account set-up; a config problem)
 *   other 4xx (except below)     → rejected (the provider refused; nothing was done)
 *   408 / 409 / 425 / 429 / 5xx  → unknown  (it may or may not have happened)
 *   network error / timeout      → unknown
 *   circuit open                 → unknown  (we did not call; the core reconciles before any retry)
 *
 * 409 is "unknown", not "rejected": a conflict on create can mean "you already
 * created this", and calling that a refusal would fail a leg (and refund the
 * fee) while a courier is on the way.
 *
 * No retries happen here. A create is never repeated by an adapter: the core
 * reconciles by merchant reference first (lib/core/delivery/use-cases.ts).
 *
 * Nothing in this module logs request or response bodies: they carry names,
 * phone numbers and addresses. Error messages returned to the core are short
 * and come only from the provider's own `message`/`error` fields.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type HttpResult = ProviderCallResult<{ status: number; body: unknown }> & { status?: number };

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** Already-serialised body (JSON or form). */
  body?: string;
  timeoutMs: number;
  /** Defaults to the global fetch, read at call time (so tests can stub it). */
  fetchImpl?: FetchLike;
  breaker?: CircuitBreaker;
}

/** Statuses whose outcome is unknown: the request may have been applied. */
const UNKNOWN_STATUSES = new Set([408, 409, 425, 429]);

export function classifyHttpStatus(status: number): 'ok' | 'rejected' | 'unknown' {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 500 || UNKNOWN_STATUSES.has(status)) return 'unknown';
  if (status >= 400) return 'rejected';
  // 1xx/3xx from a JSON API: we cannot tell what happened.
  return 'unknown';
}

/** A short, PII-free message from a provider error body. */
export function providerMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const k of ['message', 'error_description', 'error', 'code']) {
      const v = b[k];
      if (typeof v === 'string' && v.trim()) return `HTTP ${status}: ${v.trim().slice(0, 160)}`;
    }
  }
  return `HTTP ${status}`;
}

/**
 * One HTTP call with a hard timeout and classification. Never throws.
 * On a definite answer the result carries `status` so callers can special-case
 * (e.g. 404 = "no such job").
 */
export async function deliveryHttp(req: HttpRequest): Promise<HttpResult> {
  const breaker = req.breaker;
  if (breaker && !breaker.allow()) {
    return { ok: false, kind: 'unknown', message: `circuit open for ${breaker.name}: not called` };
  }
  const fetchImpl: FetchLike = req.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    clearTimeout(timer);
    breaker?.recordFailure();
    const aborted = controller.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));
    return { ok: false, kind: 'unknown', message: aborted ? `timed out after ${req.timeoutMs} ms` : 'network error' };
  }
  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON or a body cut off by the timeout: judge by the status alone.
    body = null;
  } finally {
    clearTimeout(timer);
  }
  const kind = classifyHttpStatus(res.status);
  if (kind === 'ok') {
    breaker?.recordSuccess();
    return { ok: true, value: { status: res.status, body }, status: res.status };
  }
  if (kind === 'unknown') {
    breaker?.recordFailure();
    return { ok: false, kind: 'unknown', message: providerMessage(body, res.status), status: res.status };
  }
  // A definite refusal says the provider is up: it does not trip the breaker.
  breaker?.recordSuccess();
  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'rejected', message: `HTTP ${res.status}: the provider refused our credentials (check the provider configuration)`, status: res.status };
  }
  return { ok: false, kind: 'rejected', message: providerMessage(body, res.status), status: res.status };
}

/**
 * A simple per-provider circuit breaker (spec §4.15).
 *
 * After `failureThreshold` consecutive unknown outcomes (timeouts, 5xx,
 * network errors) the circuit opens for `cooldownMs`: calls return "unknown"
 * without touching the network, so a provider that is down is skipped quickly
 * and the selection engine offers the alternatives (D20). After the cool-down
 * one trial call is let through (half-open); success closes the circuit.
 *
 * Limits: state is per server instance and in memory. On serverless each warm
 * instance has its own breaker and a cold start resets it, so it sheds load
 * from one instance but is not a global health switch. Disabling a provider
 * for everyone is done with DELIVERY_PROVIDER_<ID>_ENABLED.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    readonly name: string,
    private readonly opts: { failureThreshold: number; cooldownMs: number; now?: () => number } = { failureThreshold: 5, cooldownMs: 60_000 },
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get state(): 'closed' | 'open' | 'half_open' {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.opts.cooldownMs ? 'half_open' : 'open';
  }

  allow(): boolean {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'open') return false;
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  recordFailure(): void {
    this.trialInFlight = false;
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.opts.failureThreshold) this.openedAt = this.now();
  }
}

const breakers = new Map<string, CircuitBreaker>();

/** The process-wide breaker for one provider and mode. */
export function breakerFor(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name);
    breakers.set(name, b);
  }
  return b;
}

// ── Small helpers shared by adapters ────────────────────────────────────────

export type Json = Record<string, unknown>;

export const asObject = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
export const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

/** A valid ISO timestamp, or null. */
export function asIsoTime(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** First name only: the customer sees who is coming, we store no more than that. */
export function firstNameOnly(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  return s.split(/\s+/)[0].slice(0, 40) || null;
}

/** Coordinates a courier API can use. */
export function validCoords(p: { lat: number; lng: number }): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

export const notConfigured = (what: string): { ok: false; kind: 'rejected'; message: string } => ({
  ok: false,
  kind: 'rejected',
  message: `${what} is not configured (credentials missing); nothing was sent`,
});
