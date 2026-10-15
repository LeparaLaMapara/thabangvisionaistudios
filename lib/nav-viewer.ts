/** Footer links only for people signed in: a stranger has no dashboard or bug to report yet. */
export const SIGNED_IN_ONLY_LINKS: readonly string[] = ['/dashboard', '/support/report-bug'];

/** The footer a visitor sees: signed-in-only links dropped for strangers. Pure. */
export function footerForViewer<T extends { links: readonly { href: string }[] }>(sections: readonly T[], signedIn: boolean): T[] {
  if (signedIn) return [...sections];
  return sections.map((s) => ({ ...s, links: s.links.filter((l) => !SIGNED_IN_ONLY_LINKS.includes(l.href)) }));
}
