import { readCatalogFresh } from '@/lib/discovery/catalog';
import { allEntries } from '@/lib/discovery/registry';
import { pingIndexNow, type PingResult } from '@/lib/discovery/notify';
import type { Catalog } from '@/lib/discovery/types';

/**
 * The daily safety net for notifyDiscovery: any indexable page whose real
 * last change (lastmod) falls in the last day is pinged to IndexNow again.
 * It catches changes no write path announced (a row edited in the SQL
 * editor, a cron publish, a ping that timed out). Run by the daily
 * maintenance cron. Capped, so a bulk import cannot send a flood.
 */

export const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SWEEP_MAX_URLS = 500;

/** Paths whose lastmod is within the window, newest first, capped. */
export function changedPaths(c: Catalog, now: Date, windowMs = SWEEP_WINDOW_MS, cap = SWEEP_MAX_URLS): string[] {
  const since = now.getTime() - windowMs;
  const seen = new Set<string>();
  return allEntries(c)
    .filter((e) => {
      if (!e.lastModified) return false;
      const t = Date.parse(e.lastModified);
      return Number.isFinite(t) && t >= since && t <= now.getTime() + 60_000;
    })
    .sort((a, b) => Date.parse(b.lastModified as string) - Date.parse(a.lastModified as string))
    .map((e) => e.path)
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .slice(0, cap);
}

export interface SweepDeps {
  read: () => Promise<Catalog>;
  ping: (paths: readonly string[]) => Promise<PingResult>;
}

/** Reads the catalogue fresh, finds what changed in the last day and pings it. Never throws. */
export async function runDiscoverySweep(
  now: Date = new Date(),
  deps: SweepDeps = { read: readCatalogFresh, ping: (p) => pingIndexNow(p) },
): Promise<{ changed: number; result: PingResult | { error: string } }> {
  try {
    const catalog = await deps.read();
    const paths = changedPaths(catalog, now);
    if (paths.length === 0) return { changed: 0, result: { sent: 0, skipped: 'nothing-to-send' } };
    return { changed: paths.length, result: await deps.ping(paths) };
  } catch (err) {
    return { changed: 0, result: { error: err instanceof Error ? err.message : String(err) } };
  }
}
