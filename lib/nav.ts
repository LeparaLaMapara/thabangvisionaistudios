import { getFlags, type FeatureKey } from '@/lib/features';

type HrefEntry = { href: string } & Record<string, unknown>;

const HREF_TO_FLAG: Array<{ pattern: RegExp; flag: FeatureKey }> = [
  { pattern: /^\/smart-production(\/|$)/, flag: 'smart_productions' },
];

function isGatedHref(href: string, flagsState: Record<FeatureKey, boolean>): boolean {
  for (const { pattern, flag } of HREF_TO_FLAG) {
    if (pattern.test(href) && !flagsState[flag]) return true;
  }
  return false;
}

/**
 * Returns the subset of nav items whose href is not gated by a disabled flag.
 * Pure helper — also tested directly in unit tests.
 */
export function filterNavSync<T extends HrefEntry>(
  items: readonly T[],
  flagsState: Record<FeatureKey, boolean>,
): T[] {
  return items.filter((item) => !isGatedHref(item.href, flagsState));
}

/**
 * Fetches current flag state and filters. Use at server-component call sites.
 */
export async function filterNavForFlags<T extends HrefEntry>(
  items: readonly T[],
): Promise<T[]> {
  const flagsState = await getFlags(['smart_productions']);
  return filterNavSync(items, flagsState);
}

type LinkEntry = { link: string } & Record<string, unknown>;

export async function filterCapabilitiesForFlags<T extends LinkEntry>(
  items: readonly T[],
): Promise<T[]> {
  const flagsState = await getFlags(['smart_productions']);
  return items.filter((item) => !isGatedHref(item.link, flagsState));
}
