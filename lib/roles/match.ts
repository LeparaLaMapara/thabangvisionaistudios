/**
 * Match words (and one photo) to what the platform has. Pure.
 *
 *   Offer: "I do make-up for weddings" -> make-up artist;
 *          "I have a Quantum and drive crews" -> driver with vehicle;
 *          "Sony camera to rent out" -> gear (cameras).
 *   Find:  "make-up artist for a wedding in Soweto" -> make-up artist;
 *          "Sony camera for 2 days" -> gear (cameras).
 *
 * Candidates are the role slugs in the `roles` table plus the rental
 * categories, written "gear:<category>". The AI suggests
 * (lib/roles/match-ai.ts); these functions build its prompt, keep its answer
 * to those candidates, and give a keyword answer when there is no AI at all.
 * A suggestion is never an assignment: the person taps to confirm.
 */

export interface MatchRole {
  slug: string;
  name: string;
  description: string;
}

export type MatchMode = 'find' | 'offer';

/** The prefix that marks a rental category among the candidates. */
export const GEAR_PREFIX = 'gear:';
export const isGearSlug = (slug: string): boolean => slug.startsWith(GEAR_PREFIX);
export const gearCategoryOf = (slug: string): string => slug.slice(GEAR_PREFIX.length);

/** Roles plus rental categories, as one candidate list. */
export function matchCandidates(
  roles: readonly MatchRole[],
  categories: readonly { value: string; label: string; description: string }[],
): MatchRole[] {
  return [
    ...roles,
    ...categories.map((c) => ({ slug: `${GEAR_PREFIX}${c.value}`, name: `${c.label} (gear)`, description: c.description })),
  ];
}

export interface RoleSuggestion {
  slug: string;
  /** 0..1, rough. */
  confidence: number;
}

/** Most suggestions shown: one, or two when unsure. */
export const MAX_SUGGESTIONS = 2;
/** What we send of the person's words. */
export const MAX_MATCH_TEXT = 300;

/**
 * Words that point at a role, in the ways people in South Africa say them.
 * Matching vocabulary, not a business value: the roles themselves (names,
 * prices, rules) live in the `roles` table.
 */
export const ROLE_KEYWORDS: Record<string, readonly string[]> = {
  'photographer-videographer': ['photographer', 'photography', 'take pictures', 'take photos', 'pics of', 'shoot weddings', 'videographer', 'filming', 'film my', 'cinematographer', 'content creator', 'portraits', 'shoot my', 'photos', 'videos'],
  'makeup-artist': ['makeup', 'make-up', 'make up', 'mua', 'beat face', 'glam', 'bridal makeup', 'lashes', 'brows', 'contour', 'foundation'],
  model: ['model', 'modelling', 'modeling', 'runway', 'catwalk', 'pose', 'posing', 'brand ambassador', 'extra', 'promoter'],
  'driver-with-vehicle': ['driver', 'drive', 'driving', 'quantum', 'van', 'taxi', 'minibus', 'bakkie', 'car', 'vehicle', 'transport', 'shuttle', 'uber', 'bolt', 'prdp', 'kombi', 'sprinter'],
  gaffer: ['gaffer', 'lighting', 'lights', 'grip', 'electrician'],
  'sound-recordist': ['sound', 'audio', 'boom', 'mic', 'microphone', 'recordist', 'sound engineer'],
  hairstylist: ['hair', 'braids', 'braiding', 'wig', 'wigs', 'barber', 'stylist hair', 'locs', 'dreadlocks', 'weave'],
  'wardrobe-stylist': ['wardrobe', 'stylist', 'styling', 'fashion', 'clothes', 'outfits', 'costume'],
  editor: ['edit', 'editor', 'editing', 'premiere', 'davinci', 'resolve', 'final cut', 'retouch', 'lightroom', 'photoshop', 'colour grade', 'color grade'],
  'drone-pilot': ['drone', 'aerial', 'dji', 'mavic', 'uav', 'rpas'],
  'location-studio': ['studio space', 'my studio', 'venue', 'location', 'house for shoots', 'space for shoots', 'garden venue'],
  // Rental categories (lib/constants.ts RENTAL_CATEGORIES).
  'gear:cameras-optics': ['camera', 'cameras', 'lens', 'lenses', 'canon', 'nikon', 'sony', 'fujifilm', 'blackmagic', 'gopro', 'mirrorless', 'dslr', 'filter'],
  'gear:lighting-power': ['light', 'lights', 'led panel', 'softbox', 'flash', 'strobe', 'reflector', 'v-mount', 'battery', 'power bank', 'generator'],
  'gear:audio': ['mic', 'microphone', 'lapel', 'rode', 'recorder', 'zoom h', 'mixer', 'wireless mic'],
  'gear:grip-motion': ['gimbal', 'tripod', 'slider', 'ronin', 'stabiliser', 'stabilizer', 'monopod'],
  'gear:data-storage': ['sd card', 'memory card', 'hard drive', 'ssd', 'cfexpress'],
  'gear:specialized-solutions': ['radio', 'walkie', 'teleprompter'],
  'gear:aerial-support': ['drone', 'dji', 'mavic', 'aerial'],
  'gear:sound-reinforcement': ['pa system', 'speaker', 'speakers', 'sound system'],
};

/** Words that say "I have things to rent out" in an offer. */
const GEAR_OFFER_HINTS = ['rent out', 'to rent', 'for hire', 'hire out', 'i own', 'my gear', 'my kit', 'lend'];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(\+?\d[\d\s-]{7,}\d)/g;
const URL_LIKE = /https?:\/\/\S+/gi;

/**
 * The person's words, cut to MAX_MATCH_TEXT, with emails, phone numbers and
 * links removed: only what they do goes to the model.
 */
export function cleanMatchText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(EMAIL, ' ')
    .replace(URL_LIKE, ' ')
    .replace(PHONE, ' ')
    .replace(/[<>{}`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MATCH_TEXT);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The keyword answer: no AI needed. Best one or two, strongest first. */
export function keywordMatch(text: string, roles: readonly MatchRole[], mode: MatchMode = 'offer'): RoleSuggestion[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ')} `;
  if (!t.trim()) return [];
  const offersGear = mode === 'offer' && GEAR_OFFER_HINTS.some((h) => t.includes(h));
  const scored: RoleSuggestion[] = [];
  for (const role of roles) {
    const ownName = isGearSlug(role.slug) ? [] : [role.name.toLowerCase()];
    const words = [...(ROLE_KEYWORDS[role.slug] ?? []), ...ownName];
    let hits = 0;
    for (const w of words) {
      if (new RegExp(`(^|[^a-z])${escapeRe(w.toLowerCase())}`, 'i').test(t)) hits += w.includes(' ') ? 2 : 1;
    }
    if (hits > 0 && offersGear && isGearSlug(role.slug)) hits += 2;
    if (hits > 0) scored.push({ slug: role.slug, confidence: Math.min(0.9, 0.35 + hits * 0.15) });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  if (scored.length > 1 && scored[0].confidence - scored[1].confidence >= 0.3) return scored.slice(0, 1);
  return scored.slice(0, MAX_SUGGESTIONS);
}

/** The prompt. Only the role list and the person's cleaned words; nothing about who they are. */
export function buildMatchPrompt(text: string, roles: readonly MatchRole[], hasPhoto: boolean, mode: MatchMode = 'offer'): string {
  const list = roles.map((r) => `- "${r.slug}": ${r.name}. ${r.description}`).join('\n');
  const said = text ? `They wrote: """${text}"""` : 'They wrote nothing.';
  const photo = hasPhoto ? 'They also added one photo (attached).' : 'There is no photo.';
  const task =
    mode === 'find'
      ? 'A client in South Africa is looking for someone or something for a film or photo shoot or an event. Pick what they need.'
      : 'A person in South Africa wants to offer their skill, service or gear for film and photo shoots. Pick what they offer. A vehicle they drive means "driver-with-vehicle"; equipment they rent out means a "gear:" option.';
  return [
    task,
    'Choose ONLY from these slugs:',
    list,
    '',
    said,
    photo,
    '',
    `Return ONLY JSON like {"roles":[{"slug":"makeup-artist","confidence":0.9}]} with 0 to ${MAX_SUGGESTIONS} roles, best first.`,
    'Use an empty list if nothing fits. Never invent a slug. No other text.',
  ].join('\n');
}

/** Keep a model's answer to real slugs: deduped, at most MAX_SUGGESTIONS, confidence 0..1. */
export function parseMatchAnswer(answer: unknown, allowedSlugs: readonly string[]): RoleSuggestion[] {
  const allowed = new Set(allowedSlugs);
  const list = answer && typeof answer === 'object' && Array.isArray((answer as { roles?: unknown }).roles)
    ? ((answer as { roles: unknown[] }).roles)
    : [];
  const out: RoleSuggestion[] = [];
  for (const item of list) {
    const slug = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { slug?: unknown }).slug : null;
    if (typeof slug !== 'string' || !allowed.has(slug) || out.some((o) => o.slug === slug)) continue;
    const raw = item && typeof item === 'object' ? Number((item as { confidence?: unknown }).confidence) : NaN;
    out.push({ slug, confidence: Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5 });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Profile skills as the words to match ("photography, video editing"). */
export function skillsAsText(skills: unknown, specializations: unknown): string {
  const words = [skills, specializations]
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return cleanMatchText([...new Set(words)].join(', '));
}
