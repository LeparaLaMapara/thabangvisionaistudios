import { getFlags, type FeatureKey } from '@/lib/features';
import { EARN, FOOTER_SECTIONS } from '@/lib/constants';

type HrefEntry = { href: string } & Record<string, unknown>;

const HREF_TO_FLAG: Array<{ pattern: RegExp; flag: FeatureKey }> = [
  { pattern: /^\/studio(\/|$)/, flag: 'smart_productions' },
  { pattern: /^\/tools(\/|$)/, flag: 'creative_tools' },
];

const NAV_FLAGS: readonly FeatureKey[] = ['smart_productions', 'creative_tools', 'roles_v1'];

// A flag missing from flagsState counts as off.
function isGatedHref(href: string, flagsState: Partial<Record<FeatureKey, boolean>>): boolean {
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
  flagsState: Partial<Record<FeatureKey, boolean>>,
): T[] {
  return items.filter((item) => !isGatedHref(item.href, flagsState));
}

/**
 * Fetches current flag state and filters. Use at server-component call sites.
 */
export async function filterNavForFlags<T extends HrefEntry>(
  items: readonly T[],
): Promise<T[]> {
  const flagsState = await getFlags(NAV_FLAGS);
  return applyPeopleNaming(filterNavSync(items, flagsState), !!flagsState.roles_v1);
}

/**
 * roles_v1 (TASK-085): the menu reads People, Rentals, Plan, Apps, Help. "People"
 * replaces "Studio": everyone bookable is on one page (/people), and "Studio"
 * sounded like a place to hire. With the flag off the menu is unchanged.
 */
export function applyPeopleNaming<T extends HrefEntry>(items: readonly T[], rolesOn: boolean): T[] {
  if (!rolesOn) return [...items];
  const out = items.filter((i) => i.href !== '/studio');
  return [{ ...(items.find((i) => i.href === '/studio') ?? out[0]), label: 'People', href: '/people', children: undefined } as T, ...out];
}

export type FooterSection = { title: string; links: { label: string; href: string }[] };

/** Footer links with roles_v1 on: "Creators" becomes People; the offer door is Earn with ThabangVision. */
export function footerSectionsSync(rolesOn: boolean): FooterSection[] {
  const sections = FOOTER_SECTIONS as unknown as FooterSection[];
  if (!rolesOn) return sections;
  return sections.map((sec) => ({
    ...sec,
    links: sec.links.map((l) =>
      l.href === '/smart-creators' ? { label: 'People', href: '/people' } : l.label === EARN.label || l.href === '/onboarding' ? { label: EARN.label, href: EARN.href } : l,
    ),
  }));
}

export async function footerSectionsForFlags(): Promise<FooterSection[]> {
  const flags = await getFlags(['roles_v1']);
  return footerSectionsSync(!!flags.roles_v1);
}

type LinkEntry = { link: string } & Record<string, unknown>;

export async function filterCapabilitiesForFlags<T extends LinkEntry>(
  items: readonly T[],
): Promise<T[]> {
  const flagsState = await getFlags(NAV_FLAGS);
  return items.filter((item) => !isGatedHref(item.link, flagsState));
}
