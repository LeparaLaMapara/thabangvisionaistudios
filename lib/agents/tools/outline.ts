import { jsonSchema } from 'ai';
import { ROLES_POLICY, SHOOT_PLAN_POLICY, STUDIO } from '@/lib/constants';
import { addDays, daysBetween, formatSaDay, isIsoDate, resolveDate, saToday, type ResolvedDate } from '@/lib/dates/johannesburg';
import { areaFit, resolveArea } from '@/lib/roles/areas';
import { meetsLeadTime } from '@/lib/rental/leadTime';
import { formatRand, formatRate } from '@/lib/format/money';
import { whatsappLink } from '@/lib/payments/eft';
import { sanitiseForPrompt } from '@/lib/ubunye/sanitise';
import { isPlanMode, modeOverride, PLAN_MODES, type PlanMode } from '@/lib/ubunye/plan-mode';
import {
  FUTURE_ROLES,
  SHOOT_TYPES,
  matchShootType,
  partKey,
  shootTypeBySlug,
  type GearCategory,
  type PartUse,
  type QuestionKey,
  type ShootPart,
  type ShootType,
} from '@/lib/ubunye/shoot-types';
import { peopleShortNotice, REQUEST_PREFILL_MAX_DAYS_AHEAD } from './people';

/**
 * plan_outline: Ubunye's read-only first step for any outcome with more than
 * one part (flags roles_v1 and ubunye_projects). One engine for every kind of
 * shoot: the type comes from the shoot type catalogue
 * (lib/ubunye/shoot-types.ts, keywords, no model call), and every part's
 * state comes from OUR data, read now:
 *
 *   People   the role is live with N listed / live but nobody listed /
 *            coming soon / not offered (a role that does not exist yet)
 *   Gear     N listed in that category and the cheapest real day price
 *   Studio   the same, for the studio
 *
 * Plus the questions worth asking (only those not answered yet, at most
 * SHOOT_PLAN_POLICY.maxQuestions), the timeline with real dates from the
 * shoot date, and warnings when a step is already too late (the gear notice
 * checkout enforces, the People reply window).
 *
 * Who is shooting it (the mode, lib/ubunye/plan-mode.ts) decides which parts
 * show: hire = people (they bring their own kit) plus event extras; rent =
 * gear only; produce = everything. A gear estimate is summed here, by code,
 * only from real cheapest day prices; people are never in it.
 *
 * Blind People rule: counts and areas only, never a person, a name, a user id
 * or a price for a person (find_people shows those). Nothing is written.
 */

export interface PlanOutlineInput {
  outcome?: string;
  type?: string;
  /** Who is shooting it: 'hire', 'rent' or 'produce', as the model read it. */
  mode?: string;
  place?: string;
  date?: string;
  days?: number;
  hours?: number;
  guests?: number;
  budget?: number;
}

export interface OutlineRole {
  slug: string;
  name: string;
  status: string;
}

export interface OutlineDeps {
  getRoles: () => Promise<OutlineRole[]>;
  /** Approved people, blind: role and the public area text only. */
  listedPeople: () => Promise<{ roleSlug: string; area: string | null }[]>;
  /** Published listings per category and the cheapest day price in rands. */
  gearSummary: (categories: string[]) => Promise<Map<string, { count: number; cheapestPerDay: number | null }>>;
  now: () => Date;
}

export type OutlinePartState = 'listed' | 'nobody_listed' | 'coming_soon' | 'not_offered' | 'available' | 'none_listed' | 'unknown';

export interface OutlinePart {
  key: string;
  kind: 'person' | 'gear' | 'studio' | 'other';
  label: string;
  state: OutlinePartState;
  /** People listed in the role, or listings in the category. */
  count: number | null;
  /** People whose area serves the place asked for (when a place is known). */
  in_area: number | null;
  /** Gear and studio only: the cheapest real day price. Never for people. */
  from_price: string | null;
  /** "Send the request by Saturday 31 October 2026", from the timeline. */
  do_by: { iso: string; label: string; too_late: boolean } | null;
  line: string;
  /** What to call next for this part, with arguments, or null. */
  next: { tool: 'find_people'; role: string } | { tool: 'search_gear'; category: string } | null;
  /** Gear and studio only: crew kit (only when the client shoots it) or an event extra. */
  use?: PartUse;
  /** An event extra (a PA for speeches): always optional on the card. */
  extra?: true;
}

export interface OutlineStep {
  iso: string | null;
  label: string;
  when: string;
  too_late: boolean;
}

export type PlanOutlineResult =
  | {
      kind: 'plan_outline';
      type: { slug: string; name: string; group: string; confidence: number; sure: boolean; matched: string[]; alternatives: string[] };
      date: ResolvedDate | null;
      date_note: string | null;
      days: number;
      place: string | null;
      /** Who is shooting it. */
      mode: PlanMode;
      /** False when the model gave no mode and no clear signal decided it (the type's usual mode). */
      mode_sure: boolean;
      /** A gear sum from real cheapest day prices, by code, or null when nothing is honest to sum. */
      estimate: { text: string } | null;
      parts: OutlinePart[];
      also_possible: string[];
      not_offered: string[];
      questions: string[];
      timeline: OutlineStep[];
      warnings: string[];
      scale_note: string | null;
      lead_note: string;
      plan_hint: 'plan' | 'single' | 'nothing_we_offer' | 'unclear';
      whatsapp_url: string;
      gentle: boolean;
      say: string;
    }
  | { kind: 'plan_outline_unavailable'; message: string };

// ── Words that name a part, so "lights" in a birthday adds lights ─────────

/** Phrases first: the longest match wins and is taken out ("camera guy" is a person, not a camera). */
export const PART_WORDS: Record<string, readonly string[]> = {
  'photographer-videographer': ['director of photography', 'dop', 'cinematographer', 'photographer', 'videographer', 'camera guy', 'camera person', 'cameraman', 'camera man', 'camera people', 'someone to film', 'someone to take pics', 'film the', 'film it', 'photos', 'photo', 'pics', 'pictures', 'video', 'filming', 'shoot it'],
  'makeup-artist': ['make-up', 'makeup', 'make up', 'mua', 'beat face'],
  hairstylist: ['hairstylist', 'hair stylist', 'hairdresser', 'hair'],
  'driver-with-vehicle': ['driver', 'wedding car', 'a car', 'transport', 'shuttle', 'chauffeur'],
  model: ['models', 'model'],
  editor: ['editor', 'editing', 'edit the', 'edit it'],
  'drone-pilot': ['drone pilot'],
  gaffer: ['gaffer', 'lighting person', 'lighting guy'],
  'sound-recordist': ['sound recordist', 'sound guy', 'sound person', 'boom operator'],
  'wardrobe-stylist': ['wardrobe stylist', 'wardrobe', 'stylist'],
  director: ['director'],
  producer: ['producer'],
  'film-crew': ['full crew', 'film crew', 'whole crew', 'full film crew', 'crew'],
  'livestream-operator': ['livestream', 'live stream', 'stream it', 'streaming'],
  'food-stylist': ['food stylist'],
  'lighting-power': ['lights', 'lighting', 'light'],
  audio: ['microphones', 'microphone', 'mics', 'mic', 'mixer', 'sound kit', 'audio', 'sound'],
  'sound-reinforcement': ['pa system', 'speakers', 'speaker', 'sound system', 'pa'],
  'grip-motion': ['gimbal', 'tripod', 'slider', 'grip'],
  'aerial-support': ['drone shots', 'drones', 'drone', 'aerial'],
  'cameras-optics': ['long lenses', 'lenses', 'lens', 'cameras', 'camera'],
  'data-storage': ['memory cards', 'memory card', 'hard drive', 'drives'],
  'specialized-solutions': ['radios', 'walkie talkies'],
  studios: ['the studio', 'a studio', 'in studio', 'studio'],
};

/** Things we do not offer, said plainly and kept on a plan as "not offered". */
export const NOT_OFFERED_WORDS: readonly { label: string; words: readonly string[] }[] = [
  { label: 'Catering', words: ['catering', 'caterer', 'caterers', 'food for the guests'] },
  { label: 'A venue', words: ['venue'] },
  { label: 'Decor', words: ['decor', 'decoration', 'decorations', 'flowers', 'tents', 'tent hire', 'chairs and tables'] },
  { label: 'A DJ', words: ['dj', 'deejay'] },
  { label: 'An MC', words: ['mc', 'master of ceremonies'] },
  { label: 'Security', words: ['security guards', 'bouncers'] },
  { label: 'Shares or investing', words: ['shares', 'investing', 'invest', 'stocks', 'crypto'] },
  { label: 'Flights', words: ['flights', 'flight'] },
];

const GEAR_KEYS = new Set(['lighting-power', 'audio', 'sound-reinforcement', 'grip-motion', 'aerial-support', 'cameras-optics', 'data-storage', 'specialized-solutions']);
const GEAR_LABELS: Record<string, string> = {
  'lighting-power': 'Lights',
  audio: 'Microphones and sound kit',
  'sound-reinforcement': 'PA and speakers',
  'grip-motion': 'Gimbal or tripod',
  'aerial-support': 'Drone',
  'cameras-optics': 'Camera and lenses',
  'data-storage': 'Cards and drives',
  'specialized-solutions': 'Specialist kit',
};

/** Gear named outside the type's own list: a PA serves the event; the rest is crew kit. */
const GEAR_USE: Record<string, PartUse> = { 'sound-reinforcement': 'event' };

/**
 * Who is shooting it. A switch sentence or a high precision signal (gear
 * named by brand or model, "I'm shooting it myself", "my crew", without
 * asking for people) decides; else the model's choice; else, with nothing
 * from the model, only gear named means they shoot it, otherwise the type's
 * usual mode (and then the mode is not sure).
 */
export function resolvePlanMode(given: unknown, outcome: string, type: ShootType, named: ReadonlySet<string>): { mode: PlanMode; sure: boolean } {
  const override = modeOverride(outcome);
  if (override) return { mode: override, sure: true };
  if (isPlanMode(given)) return { mode: given, sure: true };
  const keys = [...named];
  if (keys.length && keys.every((k) => k === 'studios' || GEAR_KEYS.has(k))) return { mode: 'rent', sure: false };
  return { mode: type.defaultMode, sure: false };
}

/** Whether a part belongs on the list in this mode: hire has no crew kit, rent has no people. */
export function partFitsMode(p: ShootPart, mode: PlanMode): boolean {
  if (p.kind === 'person') return mode !== 'rent';
  return p.use === 'event' || mode !== 'hire';
}

/**
 * The gear estimate, by code: only when every counted gear or studio part
 * (crew kit, and event extras the client named) has a real cheapest day
 * price, summed in cents for the days known. People are never in it.
 */
export function gearEstimate(
  parts: readonly OutlinePart[],
  prices: ReadonlyMap<string, { count: number; cheapestPerDay: number | null }> | null,
  named: ReadonlySet<string>,
  days: number,
): { text: string } | null {
  if (!prices) return null;
  const counted = parts.filter((p) => (p.kind === 'gear' || p.kind === 'studio') && (!p.extra || named.has(p.key)));
  if (!counted.length) return null;
  let cents = 0;
  for (const p of counted) {
    const perDay = prices.get(p.key)?.cheapestPerDay;
    if (p.state !== 'available' || typeof perDay !== 'number' || !Number.isFinite(perDay) || perDay <= 0) return null;
    cents += Math.round(perDay * 100) * days;
  }
  const hasStudio = counted.some((p) => p.kind === 'studio');
  const hasGear = counted.some((p) => p.kind === 'gear');
  const what = hasStudio && hasGear ? 'Gear and the studio' : hasStudio ? 'The studio' : 'Gear';
  const people = parts.filter((p) => p.kind === 'person');
  const peopleNote = people.some((p) => p.state === 'listed') ? ' People prices are on their cards.' : people.length ? ' People are not included.' : '';
  return { text: `${what} from ${formatRand(cents / 100)} for ${days} day${days === 1 ? '' : 's'}.${peopleNote}` };
}

/** The one short clause said when the mode was not given and is only the usual one. */
export const MODE_UNSURE_LINE: Record<PlanMode, string> = {
  hire: 'I have set this up as someone shooting it for you; switch it if you are shooting it yourself.',
  rent: 'I have set this up as you shooting it yourself, so gear only; switch it if you want someone to shoot it for you.',
  produce: 'I have set this up as you producing it, with people and gear; switch it if someone else shoots it for you.',
};

function norm(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, '').replace(/make-up/g, 'makeup').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The part keys and not-offered labels plain words mention. Longest phrase first, each taken out once matched. */
export function mentionedParts(text: string): { keys: Set<string>; notOffered: string[] } {
  let t = norm(text);
  const phrases: { key: string; phrase: string }[] = [];
  for (const [key, words] of Object.entries(PART_WORDS)) for (const w of words) phrases.push({ key, phrase: norm(w) });
  for (const n of NOT_OFFERED_WORDS) for (const w of n.words) phrases.push({ key: `x:${n.label}`, phrase: norm(w) });
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  const keys = new Set<string>();
  const notOffered: string[] = [];
  for (const p of phrases) {
    if (p.phrase.trim() === '' || !t.includes(p.phrase)) continue;
    t = t.split(p.phrase).join(' ');
    if (p.key.startsWith('x:')) {
      const label = p.key.slice(2);
      if (!notOffered.includes(label)) notOffered.push(label);
    } else {
      keys.add(p.key);
    }
  }
  // A drone is flown legally only by a licensed pilot: asking for one asks for both.
  if (keys.has('aerial-support')) keys.add('drone-pilot');
  return { keys, notOffered };
}

// ── Questions: asked only when the words do not answer them ────────────────

const NUM = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
const ANSWERED: Record<QuestionKey, (t: string, i: PlanOutlineInput) => boolean> = {
  date: () => false, // decided from the date read
  place: () => false, // decided from the place read
  guests: (t, i) => Number(i.guests) > 0 || new RegExp(`\\b\\d+\\s*(guests|people|pax|staff|members|attendees|learners)\\b`).test(t),
  hours: (t, i) => Number(i.hours) > 0 || /\b\d+(\.\d+)?\s*(hours?|hrs?|h)\b/.test(t) || /\b(full|half|all) day\b/.test(t),
  days: (t, i) => Number(i.days) > 0 || new RegExp(`\\b${NUM}\\s*(shoot\\s*)?days?\\b`).test(t),
  locations: (t) => new RegExp(`\\b${NUM}\\s*locations?\\b`).test(t),
  coverage: (t) => /\b(photo|photos|photographer|pictures|pics|video|videos|videographer|film|filming|both)\b/.test(t),
  items: (t) => /\b\d+\s*(products|items|looks|pieces|dishes|outfits|skus)\b/.test(t),
  people: (t, i) => Number(i.guests) > 0 || /\b\d+\s*(people|staff|persons|members|of us|employees)\b/.test(t),
};

function stepWhen(at: number): string {
  if (at === 0) return 'on the day';
  const n = Math.abs(at);
  const unit = n % 7 === 0 && n >= 14 ? `${n / 7} weeks` : `${n} day${n === 1 ? '' : 's'}`;
  return at < 0 ? `${unit} before` : `${unit} after`;
}

function replyWords(): string {
  const n = ROLES_POLICY.requests.replyWithinWorkingDays;
  return `${n} working day${n === 1 ? '' : 's'}`;
}

function personLine(label: string, state: OutlinePartState, count: number, inArea: number | null, place: string | null): string {
  switch (state) {
    case 'listed':
      return `${label}: ${count} listed${place && inArea !== null ? ` (${inArea} ${inArea === 1 ? 'works' : 'work'} in or near ${place})` : ''}. They are asked with a request and reply within ${replyWords()}.`;
    case 'nobody_listed':
      return `${label}: open on our site, but nobody is listed yet. Our team can look on WhatsApp.`;
    case 'coming_soon':
      return `${label}: coming soon, not bookable yet. It can be kept on the plan.`;
    case 'not_offered':
      return `${label}: not offered on ${STUDIO.shortName} yet.`;
    default:
      return `${label}: we could not check this just now.`;
  }
}

/**
 * A date inside a whole sentence. resolveDate reads at most 80 characters,
 * so a long message is read clause by clause, then in overlapping windows.
 */
export function dateInWords(text: string, now: Date): ResolvedDate | null {
  const whole = resolveDate(text, now);
  if (whole || text.length <= 80) return whole;
  for (const clause of text.split(/[,.;!?\n]+/)) {
    const d = clause.trim() ? resolveDate(clause, now) : null;
    if (d) return d;
  }
  for (let i = 40; i < text.length; i += 40) {
    const d = resolveDate(text.slice(i, i + 80), now);
    if (d) return d;
  }
  return null;
}

/** One plain-words outline for any outcome. Pure apart from the deps. */
export async function planOutline(input: PlanOutlineInput, deps: OutlineDeps): Promise<PlanOutlineResult> {
  const now = deps.now();
  const today = saToday(now);
  const outcome = typeof input.outcome === 'string' ? input.outcome.slice(0, 600) : '';
  const words = norm(outcome);

  // The type: the slug the model gave if it is ours, else the catalogue match.
  const matched = matchShootType(outcome);
  // The model picks from the fixed list (it reads wording the keywords have
  // never seen: a Nikah, umbondo, a company profile video); keywords are the
  // fallback, and win only when the model said "general" but they found one.
  const picked = shootTypeBySlug(input.type);
  const given = picked && picked.slug === 'general' && matched.type.slug !== 'general' ? null : picked;
  const type: ShootType = given ?? matched.type;
  const confidence = given ? Math.max(matched.type.slug === given.slug ? matched.confidence : 0.6, 0.6) : matched.confidence;

  // The date: as given, else read from the words.
  let date: ResolvedDate | null = null;
  let dateNote: string | null = null;
  const rawDate = typeof input.date === 'string' && input.date.trim() ? input.date.trim() : null;
  const read = rawDate ? (isIsoDate(rawDate) ? { iso: rawDate, label: formatSaDay(rawDate), rule: 'as given' } : resolveDate(rawDate, now)) : dateInWords(outcome, now);
  if (rawDate && !read) dateNote = `I could not read "${sanitiseForPrompt(rawDate, 40)}" as one date. Today is ${formatSaDay(today)}.`;
  else if (read && read.iso < today) dateNote = `${read.label} has passed. Today is ${formatSaDay(today)}.`;
  else if (read && daysBetween(today, read.iso) > REQUEST_PREFILL_MAX_DAYS_AHEAD) dateNote = `${read.label} is more than a year away; requests can be sent up to a year ahead.`;
  else date = read;
  const days = Math.max(1, Math.min(60, Math.floor(Number(input.days) || 1)));

  // The place: as given, else read from the words.
  const placeAsked = resolveArea(typeof input.place === 'string' && input.place.trim() ? input.place : outcome);
  const place = placeAsked.kind === 'place' ? placeAsked.name : placeAsked.kind === 'gauteng' ? 'Gauteng' : placeAsked.kind === 'outside' ? placeAsked.name : null;

  // Which parts: the type's required parts, its event extras, its optional
  // parts the client named, and anything else they named (lights at a
  // birthday), each only when it fits who is shooting it.
  const mentioned = mentionedParts(outcome);
  const { mode, sure: modeSure } = resolvePlanMode(input.mode, outcome, type, mentioned.keys);
  const chosen: ShootPart[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  const add = (p: ShootPart): void => {
    const k = partKey(p);
    if (seen.has(k)) return;
    if (!partFitsMode(p, mode)) {
      // Something they named that this mode leaves off, said once.
      if (mentioned.keys.has(k) && !dropped.includes(k)) dropped.push(k);
      return;
    }
    seen.add(k);
    chosen.push(p);
  };
  // Nothing matched and nothing named: no guessed parts (shares, a loan): say what we do.
  const unclear = type.slug === 'general' && mentioned.keys.size === 0;
  if (!unclear) for (const p of type.parts) if (!p.optional || (p.kind !== 'person' && p.use === 'event') || mentioned.keys.has(partKey(p))) add(p);
  for (const k of mentioned.keys) {
    if (seen.has(k)) continue;
    if (k === 'studios') add({ kind: 'studio', label: 'The studio', use: 'event', optional: true });
    else if (GEAR_KEYS.has(k)) {
      const use = GEAR_USE[k] ?? 'crew';
      add({ kind: 'gear', category: k as GearCategory, label: GEAR_LABELS[k] ?? k, use, ...(use === 'event' ? { optional: true } : {}) });
    } else add({ kind: 'person', role: k });
  }
  const alsoPossibleParts = unclear ? [] : type.parts.filter((p) => p.optional && !seen.has(partKey(p)) && partFitsMode(p, mode));

  // Live data. A failed read is "unknown", never "none".
  const categories = chosen.filter((p) => p.kind !== 'person').map(partKey);
  const [rolesRead, peopleRead, gearRead] = await Promise.allSettled([
    deps.getRoles(),
    deps.listedPeople(),
    categories.length ? deps.gearSummary(categories) : Promise.resolve(new Map<string, { count: number; cheapestPerDay: number | null }>()),
  ]);
  const roleList = rolesRead.status === 'fulfilled' ? rolesRead.value : [];
  if (!roleList.length) {
    return { kind: 'plan_outline_unavailable', message: 'Planning is not available just now. Ask for each part on its own (find_people, search_gear).' };
  }
  const peopleList = peopleRead.status === 'fulfilled' ? peopleRead.value : null;
  const gearMap = gearRead.status === 'fulfilled' ? gearRead.value : null;

  const shootIso = date?.iso ?? null;
  const dueFor = (key: string, kind: ShootPart['kind']): OutlinePart['do_by'] => {
    if (!shootIso) return null;
    const step = type.timeline.find((s) => s.part === key && s.at < 0);
    const at = step ? step.at : kind === 'person' ? -SHOOT_PLAN_POLICY.defaultPeopleLeadDays : -SHOOT_PLAN_POLICY.defaultGearLeadDays;
    const iso = addDays(shootIso, at);
    return { iso, label: formatSaDay(iso), too_late: iso < today };
  };

  const parts: OutlinePart[] = chosen.map((p): OutlinePart => {
    const key = partKey(p);
    if (p.kind === 'person') {
      const role = roleList.find((r) => r.slug === p.role);
      const label = role ? sanitiseForPrompt(role.name, 60) : FUTURE_ROLES[p.role] ?? p.role;
      let state: OutlinePartState;
      let count: number | null = null;
      let inArea: number | null = null;
      if (!role) state = 'not_offered';
      else if (role.status !== 'live') state = 'coming_soon';
      else if (peopleList === null) state = 'unknown';
      else {
        const mine = peopleList.filter((x) => x.roleSlug === role.slug);
        count = mine.length;
        state = count > 0 ? 'listed' : 'nobody_listed';
        if (place && placeAsked.kind !== 'outside' && count > 0) inArea = mine.filter((x) => areaFit(x.area, placeAsked) !== 'none').length;
      }
      return {
        key,
        kind: 'person',
        label,
        state,
        count,
        in_area: inArea,
        from_price: null,
        do_by: state === 'listed' || state === 'nobody_listed' ? dueFor(key, 'person') : null,
        line: personLine(label, state, count ?? 0, inArea, place),
        next: state === 'listed' && role ? { tool: 'find_people', role: role.slug } : null,
      };
    }
    const label = p.label;
    const summary = gearMap?.get(key) ?? null;
    const state: OutlinePartState = gearMap === null ? 'unknown' : summary && summary.count > 0 ? 'available' : 'none_listed';
    const price = summary?.cheapestPerDay ? formatRate(summary.cheapestPerDay, 'day') : null;
    const line =
      state === 'available'
        ? `${label}: ${summary!.count} listed${price ? `, from ${price}` : ''}.`
        : state === 'none_listed'
          ? `${label}: none listed right now.`
          : `${label}: we could not check this just now.`;
    return {
      key,
      kind: p.kind,
      label,
      state,
      count: summary?.count ?? (gearMap === null ? null : 0),
      in_area: null,
      from_price: state === 'available' ? price : null,
      do_by: state === 'available' ? dueFor(key, p.kind) : null,
      line,
      next: state === 'available' ? { tool: 'search_gear', category: key } : null,
      use: p.use,
      ...(p.use === 'event' ? { extra: true as const } : {}),
    };
  });
  for (const label of mentioned.notOffered) {
    parts.push({ key: `other:${label.toLowerCase()}`, kind: 'other', label, state: 'not_offered', count: null, in_area: null, from_price: null, do_by: null, line: `${label}: we do not offer this.`, next: null });
  }

  // Questions: the type's, only when the words or inputs do not answer them.
  const answered = (k: QuestionKey): boolean => (k === 'date' ? !!date : k === 'place' ? !!place : ANSWERED[k](words, input));
  // Someone shooting it themselves is not asked about guests, coverage or looks.
  const RENT_QUESTIONS: readonly QuestionKey[] = ['date', 'place', 'days'];
  const questions = unclear
    ? []
    : type.questions
        .filter((q) => !answered(q.key) && (mode !== 'rent' || RENT_QUESTIONS.includes(q.key)))
        .slice(0, SHOOT_PLAN_POLICY.maxQuestions)
        .map((q) => q.text);

  // Timeline: real dates once the day is known; post steps count from the last shoot day.
  // Someone shooting it themselves does their own edit: no "edited photos ready" step.
  const lastDay = shootIso ? addDays(shootIso, days - 1) : null;
  const relevant = unclear ? [] : type.timeline.filter((s) => (!s.part || seen.has(s.part)) && !(mode === 'rent' && !s.part && s.at > 0));
  const dated = relevant.map((s) => {
    const base = s.at > 0 ? lastDay : shootIso;
    const iso = base ? addDays(base, s.at) : null;
    return { at: s.at, step: { iso, label: s.label, when: iso ? `${formatSaDay(iso)} (${stepWhen(s.at)})` : stepWhen(s.at), too_late: !!iso && s.at < 0 && iso < today } };
  });
  const timeline: OutlineStep[] = dated
    .filter((d, i) => dated.findIndex((o) => o.step.label === d.step.label && o.at === d.at) === i)
    .sort((a, b) => a.at - b.at)
    .map((d) => d.step);

  // Warnings, from the rules our checkout and request loop enforce.
  const warnings: string[] = [];
  if (placeAsked.kind === 'outside') warnings.push(`We work in ${STUDIO.serviceArea.province}. ${STUDIO.serviceArea.outsideProvinceNote} Ask our team on WhatsApp.`);
  if (shootIso) {
    const late = timeline.filter((s) => s.too_late);
    if (late.length) warnings.push(`Some steps are already late (${late.map((s) => s.label.toLowerCase()).join('; ')}). Do them as soon as possible; it may still work, but nothing is promised.`);
    if (parts.some((p) => (p.kind === 'gear' || p.kind === 'studio') && p.state === 'available') && !meetsLeadTime(shootIso, now)) {
      warnings.push(`Gear and the studio need ${STUDIO.rental.minLeadTimeHours} hours' notice, so they cannot be booked online for ${date!.label}. WhatsApp us and we will say honestly whether it can be done.`);
    }
    if (parts.some((p) => p.kind === 'person' && p.state === 'listed') && peopleShortNotice(shootIso, now).short) {
      warnings.push(`${date!.label} is very short notice for people: a request is answered within ${replyWords()}, so it may not be confirmed in time. WhatsApp us for a faster answer.`);
    }
  }

  // An event extra nobody asked for is an option on the card, not a part to count.
  const countable = parts.filter((p) => p.state !== 'not_offered' && !(p.extra && !mentioned.keys.has(p.key)));
  const onlyExtras = parts.some((p) => p.extra);
  const plan_hint: 'plan' | 'single' | 'nothing_we_offer' | 'unclear' =
    countable.length === 0
      ? parts.some((p) => p.state === 'not_offered') && !onlyExtras ? 'nothing_we_offer' : 'unclear'
      : countable.length === 1 && countable[0].state !== 'coming_soon' ? 'single' : 'plan';
  const notOffered = parts.filter((p) => p.state === 'not_offered').map((p) => p.label);
  const sure = confidence >= SHOOT_PLAN_POLICY.sureConfidence;
  // They shoot it themselves, but nothing typical for this shoot is gear: ask what they need.
  const rentNothing = !unclear && mode === 'rent' && !countable.some((p) => p.kind === 'gear' || p.kind === 'studio');
  const estimate = unclear ? null : gearEstimate(parts, gearMap, mentioned.keys, days);

  const sayParts: string[] = [];
  if (!unclear) sayParts.push(
    sure
      ? `Say in a few words that this is ${type.slug === 'general' ? 'a shoot' : `a ${type.name.toLowerCase()}`}${date ? ` on ${date.label}` : ''}${place ? ` in ${place}` : ''}, so they can correct it.`
      : `You are not sure what kind of shoot this is (${type.slug === 'general' ? 'nothing matched' : `best guess: ${type.name.toLowerCase()}`}). Check it with them in one short question.`,
  );
  if (!unclear && !modeSure) sayParts.push(`Say this in one short clause: "${MODE_UNSURE_LINE[mode]}"`);
  if (!unclear && mode === 'hire') {
    sayParts.push(
      `They want it shot for them: the people bring their own kit, so never offer cameras, lenses, lights or other crew gear.${dropped.some((k) => GEAR_KEYS.has(k)) ? ' If they named gear, say in a few words that the person they book brings it.' : ''}`,
    );
  }
  if (!unclear && mode === 'rent') sayParts.push('They shoot it themselves: gear only, never offer people. Gear is chosen with search_gear.');
  // The chat shows these parts on a card (state, counts, gear prices), so the text stays short.
  if (parts.length) sayParts.push('The client sees a card with every part, its state and gear prices: do not list the parts, counts or prices again.');
  if (estimate) sayParts.push('The card also shows the gear estimate; never work out another total yourself.');
  if (notOffered.length) sayParts.push(`In one short sentence, say we do not offer ${notOffered.join(', ')}, with no partner, referral or price.`);
  if (type.scaleNote && mode !== 'rent') sayParts.push(`Say this honestly, in one sentence: ${type.scaleNote}`);
  if (warnings.length) sayParts.push(`Give the most important warning in one short sentence: ${warnings[0]}`);
  if (questions.length) sayParts.push(`Ask at most one question, this one: ${questions[0]}`);
  if (plan_hint === 'plan') {
    sayParts.push(
      mode === 'rent'
        ? 'Then call search_gear for the gear parts they want to choose and, for a signed-in client, propose_plan with every part. Do not wait for answers that are not needed to search.'
        : 'Then call find_people for each person part marked listed (role, place, date) and, for a signed-in client, propose_plan with every part (people, gear, and the coming soon or not offered ones as needs). Do not wait for answers that are not needed to search.',
    );
  } else if (plan_hint === 'single') {
    sayParts.push(countable[0].kind === 'person' ? 'Only one part is needed, so no plan: book it on its own with find_people.' : `Only one part is needed, so no plan: book it on its own with search_gear (category ${countable[0].key}).`);
  } else if (plan_hint === 'nothing_we_offer') sayParts.push('We offer none of this, so no plan. Mention what we do offer only if it could help.');
  else if (rentNothing) sayParts.push('They shoot it themselves and nothing typical for this shoot is gear: ask in one short question which gear they need, then use search_gear.');
  else if (!unclear) sayParts.push('Nothing typical for this shoot is needed the way it is set up: ask in one short question what they need (people, gear or the studio).');
  else sayParts.push('Nothing here matches what we offer (people, gear and the studio for shoots). If it is not about a shoot, say in one or two sentences that we do not offer it; otherwise ask in one short question what they are planning.');
  if (type.gentle) sayParts.push('This is a sad occasion: be gentle and brief, and offer condolences once.');

  return {
    kind: 'plan_outline',
    type: { slug: type.slug, name: type.name, group: type.group, confidence, sure, matched: matched.type.slug === type.slug ? matched.matched : [], alternatives: given ? [] : matched.alternatives },
    date,
    date_note: dateNote,
    days,
    place,
    mode,
    mode_sure: modeSure,
    estimate,
    parts,
    also_possible: alsoPossibleParts.map((p) => (p.kind === 'person' ? roleList.find((r) => r.slug === p.role)?.name ?? FUTURE_ROLES[p.role] ?? p.role : p.label)),
    not_offered: notOffered,
    questions,
    timeline,
    warnings,
    scale_note: type.scaleNote ?? null,
    lead_note: type.leadNote,
    plan_hint,
    whatsapp_url: whatsappLink(`Hi, I am planning ${type.slug === 'general' ? 'a shoot' : `a ${type.name.toLowerCase()}`}${place ? ` in ${place}` : ''}${date ? ` on ${date.label}` : ''}. Can you help?`),
    gentle: !!type.gentle,
    say: sayParts.join(' '),
  };
}

async function defaultDeps(): Promise<OutlineDeps> {
  const [roles, rentals] = await Promise.all([import('@/lib/supabase/queries/roles'), import('@/lib/supabase/queries/smartRentals')]);
  return {
    getRoles: async () => (await roles.getRoles()).map((r) => ({ slug: r.slug, name: r.name, status: r.status })),
    listedPeople: roles.listApprovedRoleAreas,
    gearSummary: (categories) => rentals.gearCategorySummary(categories),
    now: () => new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOutlineTools(deps?: OutlineDeps): Record<string, any> {
  return {
    plan_outline: {
      description:
        'FIRST STEP for any outcome with more than one part, or any occasion or production (a wedding, umembeso, lobola, matric dance, music video, product shoot, campaign, conference, film, series, sports day, podcast and so on). ' +
        'Read-only. Returns the shoot type, who is shooting it (mode), the date read, every typical part for that mode with its LIVE state from our data (people listed, coming soon, not offered; gear listed and the cheapest day price), a gear estimate worked out by code, the questions still worth asking, a timeline with real dates and warnings. ' +
        'Not for one person alone ("a photographer tomorrow"): use find_people for that.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          outcome: { type: 'string', description: 'What the client wants, in their own words (the whole sentence is best).' },
          type: {
            type: 'string',
            enum: SHOOT_TYPES.map((t) => t.slug),
            description: 'Always pick the closest kind of shoot from this list, judged from what they said, in any language (a Nikah or Hindu wedding is a traditional-wedding, umbondo or umemulo a cultural-ceremony, a company profile video a brand-campaign). Use "general" only when nothing fits.',
          },
          mode: {
            type: 'string',
            enum: [...PLAN_MODES],
            description:
              'Who is shooting it, judged from their words in any language. ' +
              '"hire": someone shoots it for them and brings their own kit ("someone to take photos", "a photographer for my graduation", a family or business that wants the result). ' +
              '"rent": they shoot it themselves and need gear only (gear named by brand or model, "I am shooting", "my crew", "I have a camera guy"). ' +
              '"produce": they need people and gear together (a film, a series, an advert, "crew and equipment", people plus named gear). ' +
              'If they sent "Someone else shoots it for me." it is hire; "I am shooting it myself, I only need the gear." is rent; "I am producing it, I need people and gear." is produce. Leave it out only when you cannot tell.',
          },
          place: { type: 'string', description: 'Where, in their words.' },
          date: { type: 'string', description: 'The day (or first day), YYYY-MM-DD or their words.' },
          days: { type: 'number', description: 'How many shoot days, if they said.' },
          hours: { type: 'number', description: 'How many hours, if they said.' },
          guests: { type: 'number', description: 'Guests or people, if they said.' },
          budget: { type: 'number', description: 'Their budget in rands, if they gave one.' },
        },
        required: ['outcome'],
      }),
      execute: async (input: PlanOutlineInput) => {
        try {
          return await planOutline(input, deps ?? (await defaultDeps()));
        } catch (err) {
          console.error('[plan_outline] failed:', err instanceof Error ? err.message : 'unknown error');
          return { kind: 'plan_outline_unavailable', message: 'Planning is not available just now. Ask for each part on its own (find_people, search_gear).' };
        }
      },
    },
  };
}
