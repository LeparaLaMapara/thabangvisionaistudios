/**
 * Gauteng place names, and whether a person's area serves the place a
 * client asked for. Pure.
 *
 * A person's area is free text ("Joburg north", "Soweto and Joburg south",
 * "Pretoria and Joburg"), and a substring check could not see that "Joburg"
 * is Johannesburg or that Soweto is in Johannesburg. This is a small,
 * fixed alias map of Gauteng places grouped by metro. It is matching
 * vocabulary, not a business value: where we work is STUDIO.serviceArea.
 */

export type Metro = 'johannesburg' | 'tshwane' | 'ekurhuleni' | 'west-rand' | 'sedibeng';

interface Place {
  /** Canonical name, as we say it back. */
  name: string;
  metro: Metro;
  /** Lower-case words people type for it (the name included). */
  words: readonly string[];
  /** True for the metro's own city name: a person there serves the whole metro. */
  city?: boolean;
}

const PLACES: readonly Place[] = [
  { name: 'Johannesburg', metro: 'johannesburg', city: true, words: ['johannesburg', 'joburg', 'jozi', 'jhb', 'jnb', 'egoli', 'joburg cbd'] },
  { name: 'Soweto', metro: 'johannesburg', words: ['soweto'] },
  { name: 'Sandton', metro: 'johannesburg', words: ['sandton'] },
  { name: 'Randburg', metro: 'johannesburg', words: ['randburg'] },
  { name: 'Roodepoort', metro: 'johannesburg', words: ['roodepoort'] },
  { name: 'Fourways', metro: 'johannesburg', words: ['fourways', 'dainfern'] },
  { name: 'Midrand', metro: 'johannesburg', words: ['midrand'] },
  { name: 'Rosebank', metro: 'johannesburg', words: ['rosebank'] },
  { name: 'Braamfontein', metro: 'johannesburg', words: ['braamfontein'] },
  { name: 'Alexandra', metro: 'johannesburg', words: ['alexandra'] },
  { name: 'Lenasia', metro: 'johannesburg', words: ['lenasia'] },
  { name: 'Melville', metro: 'johannesburg', words: ['melville'] },
  { name: 'Bryanston', metro: 'johannesburg', words: ['bryanston'] },
  { name: 'Diepsloot', metro: 'johannesburg', words: ['diepsloot'] },
  { name: 'Pretoria', metro: 'tshwane', city: true, words: ['pretoria', 'pta', 'tshwane', 'pitori'] },
  { name: 'Centurion', metro: 'tshwane', words: ['centurion'] },
  { name: 'Soshanguve', metro: 'tshwane', words: ['soshanguve'] },
  { name: 'Mamelodi', metro: 'tshwane', words: ['mamelodi'] },
  { name: 'Atteridgeville', metro: 'tshwane', words: ['atteridgeville'] },
  { name: 'Hatfield', metro: 'tshwane', words: ['hatfield'] },
  { name: 'Menlyn', metro: 'tshwane', words: ['menlyn'] },
  { name: 'Akasia', metro: 'tshwane', words: ['akasia'] },
  { name: 'East Rand', metro: 'ekurhuleni', city: true, words: ['east rand', 'ekurhuleni'] },
  { name: 'Germiston', metro: 'ekurhuleni', words: ['germiston'] },
  { name: 'Benoni', metro: 'ekurhuleni', words: ['benoni'] },
  { name: 'Boksburg', metro: 'ekurhuleni', words: ['boksburg'] },
  { name: 'Kempton Park', metro: 'ekurhuleni', words: ['kempton park', 'kempton'] },
  { name: 'Tembisa', metro: 'ekurhuleni', words: ['tembisa'] },
  { name: 'Springs', metro: 'ekurhuleni', words: ['springs'] },
  { name: 'Alberton', metro: 'ekurhuleni', words: ['alberton'] },
  { name: 'Edenvale', metro: 'ekurhuleni', words: ['edenvale'] },
  { name: 'Brakpan', metro: 'ekurhuleni', words: ['brakpan'] },
  { name: 'Katlehong', metro: 'ekurhuleni', words: ['katlehong'] },
  { name: 'West Rand', metro: 'west-rand', city: true, words: ['west rand', 'mogale city', 'mogale'] },
  { name: 'Krugersdorp', metro: 'west-rand', words: ['krugersdorp'] },
  { name: 'Randfontein', metro: 'west-rand', words: ['randfontein'] },
  { name: 'Vaal', metro: 'sedibeng', city: true, words: ['vaal', 'sedibeng'] },
  { name: 'Vereeniging', metro: 'sedibeng', words: ['vereeniging'] },
  { name: 'Vanderbijlpark', metro: 'sedibeng', words: ['vanderbijlpark'] },
];

/** Big places outside Gauteng, so "Cape Town" is answered honestly, not as "unknown". */
const OUTSIDE: readonly string[] = [
  'cape town', 'durban', 'port elizabeth', 'gqeberha', 'bloemfontein', 'polokwane', 'nelspruit', 'mbombela',
  'rustenburg', 'east london', 'kimberley', 'pietermaritzburg', 'george', 'mahikeng', 'mafikeng', 'stellenbosch',
  'western cape', 'kwazulu-natal', 'kzn', 'limpopo', 'mpumalanga', 'free state', 'north west', 'eastern cape', 'northern cape',
];

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/jo'?burg/g, 'joburg').replace(/[^a-z-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function has(t: string, word: string): boolean {
  return t.includes(` ${word} `);
}

/** Every known Gauteng place a piece of text mentions. */
export function placesIn(text: string | null | undefined): Place[] {
  if (!text) return [];
  const t = normalise(text);
  return PLACES.filter((p) => p.words.some((w) => has(t, w)));
}

export type AreaAsked =
  | { kind: 'place'; name: string; metro: Metro; city: boolean }
  | { kind: 'gauteng' }
  | { kind: 'outside'; name: string }
  | { kind: 'unknown' };

/** What a client's place words mean. The first Gauteng place wins. */
export function resolveArea(text: string | null | undefined): AreaAsked {
  if (!text || !text.trim()) return { kind: 'unknown' };
  const t = normalise(text);
  const places = placesIn(text);
  if (places.length) {
    // Prefer a specific place over the city name ("Soweto, Joburg" is Soweto).
    const p = places.find((x) => !x.city) ?? places[0];
    return { kind: 'place', name: p.name, metro: p.metro, city: !!p.city };
  }
  if (has(t, 'gauteng')) return { kind: 'gauteng' };
  const out = OUTSIDE.find((w) => has(t, w));
  if (out) return { kind: 'outside', name: out.replace(/\b\w/g, (c) => c.toUpperCase()) };
  return { kind: 'unknown' };
}

/**
 * How well a person's area serves what the client asked for:
 *   same_place   they name that place (Joburg for Johannesburg), or a place
 *                inside the city that was asked for (Soweto for Johannesburg)
 *   same_city    they name somewhere in the same metro (Midrand for Johannesburg)
 *   all_gauteng  they say they cover Gauteng
 *   unknown      their area, or the client's, is not a place we know
 *   none         a different part of Gauteng (Pretoria for Soweto)
 */
export type AreaFit = 'same_place' | 'same_city' | 'all_gauteng' | 'unknown' | 'none';

export function areaFit(personArea: string | null | undefined, asked: AreaAsked): AreaFit {
  if (asked.kind === 'unknown' || asked.kind === 'outside') return 'unknown';
  const theirs = placesIn(personArea);
  const saysGauteng = !!personArea && has(normalise(personArea), 'gauteng');
  if (asked.kind === 'gauteng') return theirs.length || saysGauteng ? 'all_gauteng' : 'unknown';
  if (theirs.some((p) => p.name === asked.name)) return 'same_place';
  // Asked for the city itself: anywhere in it counts (Soweto is in Johannesburg).
  if (asked.city && theirs.some((p) => p.metro === asked.metro)) return 'same_place';
  if (theirs.some((p) => p.metro === asked.metro)) return 'same_city';
  if (saysGauteng) return 'all_gauteng';
  return theirs.length ? 'none' : 'unknown';
}

/** Best first: used to order results before ranking breaks ties. */
export const AREA_FIT_ORDER: Record<AreaFit, number> = { same_place: 0, same_city: 1, all_gauteng: 2, unknown: 3, none: 4 };

/** Plain words for a fit, for the card and the model. */
export function areaFitWords(fit: AreaFit, askedName: string): string {
  switch (fit) {
    case 'same_place':
      return `Works in ${askedName}`;
    case 'same_city':
      return `Works nearby, in the same metro as ${askedName}`;
    case 'all_gauteng':
      return 'Works across Gauteng';
    case 'unknown':
      return 'Check the area on their profile';
    default:
      return `Works in another part of Gauteng, not ${askedName}`;
  }
}
