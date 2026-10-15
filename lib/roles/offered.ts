/**
 * Only promise the kinds of work someone can actually be booked for. Pure:
 * the pages pass in the live roles and the role slugs that have at least one
 * approved person (the same rule as the /people chips), and get plain words.
 */

export interface OfferedRole {
  slug: string;
  name: string;
}

/** How each known role reads in a list ("Book photographers and videographers"). */
const PLURALS: Record<string, string> = {
  'photographer-videographer': 'photographers and videographers',
  'makeup-artist': 'make-up artists',
  model: 'models',
  'driver-with-vehicle': 'drivers',
};

/** How each known role reads when someone asks for one ("Need make-up, a model or a driver?"). */
const ASKS: Record<string, string> = {
  'photographer-videographer': 'a photographer',
  'makeup-artist': 'make-up',
  model: 'a model',
  'driver-with-vehicle': 'a driver',
};

const lower = (name: string): string => name.trim().toLowerCase();

export function rolePlural(role: OfferedRole): string {
  return PLURALS[role.slug] ?? lower(role.name);
}

export function roleAsk(role: OfferedRole): string {
  return ASKS[role.slug] ?? lower(role.name);
}

/** "a", "a and b", "a, b and c" (or "or"). */
export function joinWords(items: readonly string[], last: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The live roles that have at least one approved person, in role order. */
export function offeredRoles<R extends OfferedRole>(liveRoles: readonly R[], approvedSlugs: Iterable<string>): R[] {
  const has = new Set(approvedSlugs);
  return liveRoles.filter((r) => has.has(r.slug));
}

/** Words for the home page and /people, from the roles someone can be booked for. */
export function peopleWords(offered: readonly OfferedRole[], liveRoles: readonly OfferedRole[]) {
  const plurals = offered.map(rolePlural);
  const list = joinWords(plurals);
  const missing = liveRoles.filter((r) => !offered.some((o) => o.slug === r.slug));
  return {
    /** Home hero line. */
    heroLine: plurals.length > 0 ? `Book ${list}, chosen on their work.` : 'Book people for your shoot, chosen on their work.',
    /** Home People tile subtitle. */
    tileSubtitle: plurals.length > 0 ? capitalise(list) : 'People for your shoot',
    /** Home "What we offer" line. */
    offerLine: plurals.length > 0 ? `Camera gear to rent, and ${list} to book.` : 'Camera gear to rent, and people to book for your shoot.',
    /** /people heading over the cards. */
    heading: plurals.length > 0 ? capitalise(list) : 'People',
    /** One honest line for everything nobody offers yet. */
    askLine:
      missing.length > 0
        ? `Need ${joinWords(missing.map(roleAsk), 'or')}? Tell us your date on WhatsApp and we will find someone.`
        : 'Need someone else for your shoot? Tell us your date on WhatsApp and we will find someone.',
  };
}
