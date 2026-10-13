import { after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { STUDIO } from '@/lib/constants';
import { DISCOVERY_CACHE_TAG } from '@/lib/discovery/catalog';
import { routeOf } from '@/lib/discovery/registry';

/**
 * Telling search engines and our own discovery surfaces that something
 * public changed.
 *
 * Call notifyDiscovery(paths) after a public entity is published, edited,
 * taken down or deleted. It:
 *   1. marks the cached catalogue stale (tag DISCOVERY_CACHE_TAG), so the
 *      sitemap, llms.txt, the markdown twins, /v1 and /mcp read fresh data on
 *      their next request;
 *   2. after the response is sent, pings IndexNow (Bing, Yandex, Seznam,
 *      Naver and others share it) with the changed URLs.
 *
 * It never throws and never delays the user's write: the ping runs in
 * after(), with a timeout, and failures are logged. URLs are batched (one
 * request per flush) and deduped. Pings are sent only in production
 * (VERCEL_ENV=production), only when INDEXNOW_KEY is set, and only for
 * paths that are indexable pages (a route in SITEMAP_ROUTES). Removed pages
 * are pinged too: IndexNow wants to hear about deletions, and the crawler then
 * finds the 404 or the redirect.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** IndexNow accepts up to 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;
export const INDEXNOW_TIMEOUT_MS = 5_000;

/** Paths, or a function that works them out later (after the response). */
export type DiscoveryTarget = readonly string[] | (() => Promise<readonly string[]>);

export interface IndexNowEnv {
  key?: string;
  vercelEnv?: string;
}

export type PingResult =
  | { sent: number; status: number }
  | { sent: 0; skipped: 'not-production' | 'no-key' | 'bad-key' | 'nothing-to-send' | 'failed'; error?: string };

/** An IndexNow key: 8 to 128 letters, digits or dashes. */
export function isValidIndexNowKey(key: string | undefined): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(key);
}

/** The key from the environment, trimmed, or undefined. */
export function indexNowKey(): string | undefined {
  const k = process.env.INDEXNOW_KEY?.trim();
  return k ? k : undefined;
}

const SITE = new URL(STUDIO.meta.url);

/**
 * Absolute, deduped URLs for the indexable paths among `paths`. Accepts paths
 * ("/rentals/x/y") or absolute URLs on our own host; anything else, and any
 * path that is not an indexable page route, is dropped.
 */
export function indexableUrls(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    let url: URL;
    try {
      url = new URL(raw, SITE);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, '');
    if (host !== SITE.hostname.replace(/^www\./, '')) continue;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!routeOf(path)) continue;
    out.add(`${SITE.origin}${path === '/' ? '' : path}`);
  }
  return [...out];
}

/**
 * Sends one IndexNow request. Never throws. `fetchImpl` and `env` are
 * injectable for tests; production uses fetch and process.env.
 */
export async function pingIndexNow(
  paths: readonly string[],
  env: IndexNowEnv = { key: indexNowKey(), vercelEnv: process.env.VERCEL_ENV },
  fetchImpl: typeof fetch = fetch,
): Promise<PingResult> {
  try {
    if (env.vercelEnv !== 'production') return { sent: 0, skipped: 'not-production' };
    if (!env.key) return { sent: 0, skipped: 'no-key' };
    if (!isValidIndexNowKey(env.key)) return { sent: 0, skipped: 'bad-key' };
    const urlList = indexableUrls(paths).slice(0, INDEXNOW_MAX_URLS);
    if (urlList.length === 0) return { sent: 0, skipped: 'nothing-to-send' };

    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: SITE.host,
        key: env.key,
        keyLocation: `${SITE.origin}/${env.key}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
    });
    // 200 and 202 are both success (202: key still being checked).
    if (!res.ok) {
      console.warn('[discovery] IndexNow answered', res.status, 'for', urlList.length, 'URLs');
      return { sent: 0, skipped: 'failed', error: `HTTP ${res.status}` };
    }
    return { sent: urlList.length, status: res.status };
  } catch (err) {
    console.warn('[discovery] IndexNow ping failed:', err instanceof Error ? err.message : String(err));
    return { sent: 0, skipped: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Batching ────────────────────────────────────────────────────────────────

export interface NotifyDeps {
  revalidate: (tag: string) => void;
  schedule: (task: () => Promise<void>) => void;
  ping: (paths: readonly string[]) => Promise<PingResult>;
}

const defaultDeps: NotifyDeps = {
  revalidate: (tag) => revalidateTag(tag, 'max'),
  schedule: (task) => {
    try {
      after(task);
    } catch {
      // Outside a request (a script): run it now, unawaited.
      void task();
    }
  },
  ping: (paths) => pingIndexNow(paths),
};

const pending = { paths: new Set<string>(), resolvers: [] as (() => Promise<readonly string[]>)[], scheduled: false };

async function flush(deps: NotifyDeps): Promise<void> {
  pending.scheduled = false;
  const resolvers = pending.resolvers.splice(0);
  const paths = new Set(pending.paths);
  pending.paths.clear();
  for (const resolve of resolvers) {
    try {
      for (const p of await resolve()) paths.add(p);
    } catch (err) {
      console.warn('[discovery] could not work out changed URLs:', err instanceof Error ? err.message : String(err));
    }
  }
  if (paths.size === 0) return;
  const result = await deps.ping([...paths]);
  if ('skipped' in result && result.skipped !== 'nothing-to-send') {
    console.log('[discovery] IndexNow ping skipped:', result.skipped, `(${paths.size} paths)`);
  }
}

/**
 * Something public changed at these paths. Fire and forget: returns at once,
 * never throws. See the top of this file.
 */
export function notifyDiscovery(target: DiscoveryTarget, deps: NotifyDeps = defaultDeps): void {
  try {
    try {
      deps.revalidate(DISCOVERY_CACHE_TAG);
    } catch (err) {
      console.warn('[discovery] cache not revalidated:', err instanceof Error ? err.message : String(err));
    }
    if (typeof target === 'function') pending.resolvers.push(target);
    else for (const p of target) pending.paths.add(p);
    if (!pending.scheduled) {
      pending.scheduled = true;
      deps.schedule(() => flush(deps).catch((err) => console.warn('[discovery] flush failed:', err)));
    }
  } catch (err) {
    pending.scheduled = false;
    console.warn('[discovery] notify failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Test helper: forget anything queued. */
export function resetDiscoveryQueue(): void {
  pending.paths.clear();
  pending.resolvers.length = 0;
  pending.scheduled = false;
}
