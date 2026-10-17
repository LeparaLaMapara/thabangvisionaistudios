/**
 * Who is shooting it: the plan mode (flag ubunye_projects). Pure and
 * browser-safe, so the chat card's switch and plan_outline share one list.
 *
 *   hire     someone shoots it for me: people only, they bring their own kit
 *   rent     I am shooting it: gear only, no people
 *   produce  I am producing it: people and gear
 *
 * A family wanting graduation photos wants a photographer, not a camera. The
 * model picks the mode from the client's words; the few signals here are
 * high precision only (a named gear brand or model, "I'm shooting it myself",
 * "my crew", "my camera guy") and decide "rent" unless people are asked for too.
 */

export const PLAN_MODES = ['hire', 'rent', 'produce'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export function isPlanMode(v: unknown): v is PlanMode {
  return typeof v === 'string' && (PLAN_MODES as readonly string[]).includes(v);
}

/**
 * The exact sentences the chat card's switch sends. The system prompt tells
 * the model to call plan_outline again with the matching mode, and
 * plan_outline also reads them itself when they are in the words.
 */
export const MODE_SWITCH_SENTENCES: Record<PlanMode, string> = {
  hire: 'Someone else shoots it for me.',
  rent: 'I am shooting it myself, I only need the gear.',
  produce: 'I am producing it, I need people and gear.',
};

/** Short plain names for each mode, for a card or a line of text. */
export const MODE_NAMES: Record<PlanMode, string> = {
  hire: 'Someone shoots it for you',
  rent: 'You shoot it, you need the gear',
  produce: 'You produce it, you need people and gear',
};

function norm(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The mode a switch sentence asks for, when the words hold one of them. */
export function modeFromSwitch(text: unknown): PlanMode | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = norm(text);
  for (const mode of PLAN_MODES) if (t.includes(norm(MODE_SWITCH_SENTENCES[mode]))) return mode;
  return null;
}

/** "I'm shooting it myself", "my crew", "I have a camera guy": the client brings the people. */
const SELF_CREW: readonly RegExp[] = [
  /\b(im|i am|ill|i will|i ll) (shooting|filming|shoot|film)\b/,
  /\b(shoot|shooting|film|filming|record|recording)\b (?:(?!of |for |me )\w+ ){0,3}(myself|ourselves)\b/,
  /\b(my|our) (own )?(crew|camera crew|film crew|camera guy|camera guys|cameraman|camera man|camera person|camera people|dop|cinematographer)\b/,
  /\b(i|we) (have|got) (a |an |my |our )?(own )?(crew|camera crew|camera guy|camera guys|cameraman|camera man|camera person|dop|cinematographer|videographer|photographer)\b/,
  /\b(my|our) own (camera|cameras|gear|kit|equipment)\b/,
];

/** Gear named by brand or model ("two 600d lights", "a Sony FX3"): someone who knows kit. */
const GEAR_NAMES =
  /\b(canon|nikon|sony|fujifilm|panasonic|lumix|blackmagic|bmpcc|ursa|arri|alexa|komodo|dji|ronin|mavic|godox|aputure|amaran|nanlite|sennheiser|rode|sigma|tamron|manfrotto|sachtler|atomos|gopro|insta360|a7s|a7siii|a7iii|a7iv|fx3|fx6|fx30|gh5|gh6|c70|c300|(?:60|120|200|300|600|1200)d|(?:60|150|300|600|1200)x)\b/;

/** Words that clearly ask for a person (after "my crew" and the like are taken out). */
const PEOPLE_ASK =
  /\b(photographer|photographers|videographer|videographers|cameraman|camera man|camera guy|camera person|someone to (film|shoot|take|record|edit)|make ?up|mua|hair ?stylist|hairdresser|hair|driver|models?|editor|gaffer|sound (recordist|guy|person)|boom operator|stylist|director|producer|drone pilot|crew|dop|cinematographer|people to)\b/;

export interface ModeSignals {
  /** A switch sentence was in the words. */
  switched: PlanMode | null;
  /** They shoot it themselves or name gear by brand or model. */
  selfOrGear: boolean;
  /** They also ask for a person. */
  asksPeople: boolean;
}

/** The deterministic signals in plain words. */
export function modeSignals(text: unknown): ModeSignals {
  const raw = typeof text === 'string' ? text.slice(0, 600) : '';
  const switched = modeFromSwitch(raw);
  let t = norm(raw);
  const self = SELF_CREW.some((r) => r.test(t));
  const gear = GEAR_NAMES.test(t);
  for (const r of SELF_CREW) t = t.replace(new RegExp(r.source, 'g'), ' ');
  return { switched, selfOrGear: self || gear, asksPeople: PEOPLE_ASK.test(t) };
}

/**
 * The high precision override, or null when the model's choice stands:
 * a switch sentence wins; then a self-shoot or named-gear signal means rent,
 * unless people are asked for too.
 */
export function modeOverride(text: unknown): PlanMode | null {
  const s = modeSignals(text);
  if (s.switched) return s.switched;
  if (s.selfOrGear && !s.asksPeople) return 'rent';
  return null;
}
