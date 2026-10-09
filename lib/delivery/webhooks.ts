import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { DELIVERY_OPS } from '@/lib/constants';
import { systemClock } from '@/lib/core/ports';
import { createAdminClient } from '@/lib/supabase/server';
import { receiveDeliveryWebhook, type DeliveryWebhookParser, type InboxDeps, type WebhookReceipt } from './inbox';
import { SupabaseDeliveryInbox, SupabaseDeliveryRepository } from './repos';

/**
 * Registry of delivery-provider webhook parsers (spec Phase 4 §4.15, D11–D13).
 *
 * The route `POST /api/webhooks/delivery/[provider]` is generic: it looks the
 * provider up here and hands the raw request to the core inbox
 * (`receiveDeliveryWebhook`): verify → store (minimal payload, unique dedupe
 * key) → acknowledge → process; failures are retried by the daily pipeline
 * (`drainDeliveryInbox`).
 *
 * A courier adapter adds webhooks in two steps:
 *
 *   1. In its own folder, a module that calls
 *        registerDeliveryWebhookParser('<provider_id>', (env) => {
 *          const secret = env.DELIVERY_PROVIDER_<ID>_WEBHOOK_SECRET;
 *          if (!secret) return null;            // not configured → 503, nothing stored
 *          return {
 *            providerId: '<provider_id>',
 *            verify: (raw, headers) => constantTimeEqual(hmacSha256(secret, raw, 'hex'), headers['x-signature'] ?? ''),
 *            parse: (raw) => ({ ...ParsedDeliveryEvent, minimal: { ids, state, times only } }),
 *          };
 *        });
 *   2. One side-effect import of that module in lib/delivery/webhook-adapters.ts.
 *
 * Rules for a parser: `verify` checks the provider's signature over the RAW
 * body in constant time (use `constantTimeEqual`); it must not throw on bad
 * input (a throw counts as a failed check). `parse` returns null for events
 * we do not use, and its `minimal` copy holds ids, states and timestamps
 * only — never addresses, names, phone numbers or photos.
 */

type Env = Record<string, string | undefined>;

/** Builds the parser from env (secrets are read at request time). Null = not configured. */
export type DeliveryWebhookParserFactory = (env: Env) => DeliveryWebhookParser | null;

const PROVIDER_ID = /^[a-z0-9][a-z0-9_]{0,39}$/;
const factories = new Map<string, DeliveryWebhookParserFactory>();

export function isValidDeliveryProviderId(id: string): boolean {
  return PROVIDER_ID.test(id);
}

/** Register a provider's parser. One registration per provider id. */
export function registerDeliveryWebhookParser(providerId: string, factory: DeliveryWebhookParserFactory): void {
  if (!isValidDeliveryProviderId(providerId)) throw new Error(`invalid delivery provider id: ${providerId}`);
  if (factories.has(providerId)) throw new Error(`delivery webhook parser already registered: ${providerId}`);
  factories.set(providerId, factory);
}

export function registeredDeliveryWebhookProviders(): string[] {
  return [...factories.keys()].sort();
}

/** Tests only. */
export function _resetDeliveryWebhookParsers(): void {
  factories.clear();
}

export type ParserLookup = { kind: 'unknown' } | { kind: 'not_configured' } | { kind: 'ok'; parser: DeliveryWebhookParser };

export function resolveDeliveryWebhookParser(providerId: string, env: Env = process.env): ParserLookup {
  if (!isValidDeliveryProviderId(providerId)) return { kind: 'unknown' };
  const factory = factories.get(providerId);
  if (!factory) return { kind: 'unknown' };
  let parser: DeliveryWebhookParser | null = null;
  try {
    parser = factory(env);
  } catch {
    parser = null;
  }
  // A parser that claims another provider's id would let one provider's
  // signature move another provider's shipments: refuse it.
  if (!parser || parser.providerId !== providerId) return { kind: 'not_configured' };
  return { kind: 'ok', parser };
}

// ── Signature helpers for adapters ───────────────────────────────────────────

/**
 * Constant-time string comparison. Both sides are hashed first, so the time
 * taken does not depend on where they differ or on their lengths.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db) && a.length === b.length && a.length > 0;
}

export function hmacSha256(secret: string, rawBody: string, encoding: 'hex' | 'base64'): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest(encoding);
}

// ── Request handling ─────────────────────────────────────────────────────────

/**
 * Deps for the webhook: the inbox and only what applying a provider event
 * needs (repository, clock, ids). Building them does no I/O, so an
 * unverified request costs nothing beyond the signature check.
 */
export function webhookInboxDeps(): InboxDeps {
  const db = createAdminClient();
  return { store: new SupabaseDeliveryInbox(db), useCases: { repo: new SupabaseDeliveryRepository(db), clock: systemClock, newId: () => crypto.randomUUID() } };
}

export type DeliveryWebhookResult = { status: 200 | 400 | 401 | 404 | 413 | 500 | 503; outcome: string };

/**
 * One webhook request, end to end. Pure apart from its deps.
 *  - unknown provider → 404; known but not configured → 503 (nothing stored);
 *  - body over the limit → 413 (nothing stored);
 *  - signature fails → 401: nothing stored, nothing applied (D11). Checked
 *    here BEFORE any deps are built, then again inside the core inbox;
 *  - stored (or a replay: duplicate, D12) → 200. A failed processing attempt
 *    still answers 200: the event is durable and the drain retries it.
 *  - store failed → 500 so the provider sends it again.
 * Out-of-order events never regress a leg: the core applies provider states
 * forward only (D13).
 */
export async function handleDeliveryWebhook(p: {
  providerId: string;
  rawBody: string;
  headers: Readonly<Record<string, string>>;
  env?: Env;
  deps?: () => InboxDeps;
}): Promise<DeliveryWebhookResult> {
  const found = resolveDeliveryWebhookParser(p.providerId, p.env);
  if (found.kind === 'unknown') return { status: 404, outcome: 'unknown_provider' };
  if (found.kind === 'not_configured') return { status: 503, outcome: 'not_configured' };
  if (Buffer.byteLength(p.rawBody, 'utf8') > DELIVERY_OPS.webhookMaxBodyBytes) return { status: 413, outcome: 'too_large' };

  let verified = false;
  try {
    verified = (await found.parser.verify(p.rawBody, p.headers)) === true;
  } catch {
    verified = false;
  }
  if (!verified) return { status: 401, outcome: 'invalid_signature' };

  let deps: InboxDeps;
  try {
    deps = (p.deps ?? webhookInboxDeps)();
  } catch {
    return { status: 500, outcome: 'unavailable' };
  }
  let parsedOk = true;
  const parser: DeliveryWebhookParser = {
    providerId: found.parser.providerId,
    verify: (raw, headers) => found.parser.verify(raw, headers),
    parse: (raw) => {
      try {
        return found.parser.parse(raw);
      } catch {
        parsedOk = false;
        return null;
      }
    },
  };
  const receipt: WebhookReceipt = await receiveDeliveryWebhook({ rawBody: p.rawBody, headers: p.headers, parser, deps });
  if (!parsedOk) return { status: 400, outcome: 'invalid_payload' };
  return receipt;
}

/** Lower-cased header map (signature headers are looked up in lower case). */
export function headerRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Read a request body without ever holding more than `maxBytes` of it: a
 * declared Content-Length over the limit is refused before reading, and the
 * stream is cut off as soon as it passes the limit (a missing or false
 * Content-Length cannot get a large body into memory). Null = too large.
 */
export async function readBodyWithin(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
