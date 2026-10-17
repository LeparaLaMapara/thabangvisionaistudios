import { SHOOT_PLAN_POLICY, type RentalCategorySlug } from '@/lib/constants';
import type { PlanMode } from '@/lib/ubunye/plan-mode';

/**
 * Shoot types: ONE catalogue for every kind of shoot, so one engine plans a
 * traditional wedding, a music video or a Netflix-scale series. Adding a
 * type is adding one entry here. Pure data and pure helpers (no Supabase,
 * no model call), fully unit-tested.
 *
 * What an entry says is only what a shoot like this TYPICALLY needs. What we
 * can really supply is never decided here: plan_outline reads every part's
 * live state from our data (the roles table, the listed people, the listed
 * gear). A part whose role does not exist in the roles table yet (a director,
 * a full film crew) is listed in FUTURE_ROLES, so it reads as "not offered"
 * and is said plainly, never booked.
 *
 * Words the client sees (names, questions, steps, notes) are plain English,
 * with no dashes used as punctuation.
 */

export const SHOOT_GROUPS = [
  { slug: 'weddings', name: 'Weddings and ceremonies' },
  { slug: 'celebrations', name: 'Celebrations and events' },
  { slug: 'music', name: 'Music' },
  { slug: 'business', name: 'Business and brands' },
  { slug: 'film', name: 'Film and TV' },
  { slug: 'sport', name: 'Sport' },
  { slug: 'content', name: 'Content and live' },
  { slug: 'other', name: 'Something else' },
] as const;
export type ShootGroup = (typeof SHOOT_GROUPS)[number]['slug'];

/**
 * Roles a shoot can need that are not in the roles table yet. They resolve to
 * "not offered" until a role with that slug exists. Kept apart so a test can
 * prove every person part is either a real role or one of these.
 */
export const FUTURE_ROLES: Record<string, string> = {
  director: 'Director',
  producer: 'Producer',
  'film-crew': 'Full film crew',
  'livestream-operator': 'Livestream operator',
  'food-stylist': 'Food stylist',
};

export type GearCategory = Exclude<RentalCategorySlug, 'studios'>;

/**
 * What a gear or studio part is for (the plan mode, lib/ubunye/plan-mode.ts):
 *   crew   the kit the people shooting it use (cameras, lenses, lights for the
 *          crew, grip, drones, cards and drives, sound kit for recording).
 *          Only for a client who shoots it themselves; a hired person brings
 *          their own.
 *   event  something the occasion itself needs whoever shoots it (a PA for
 *          speeches, microphones for the speakers, the studio as the place).
 *          Always optional, and labelled for what it is for.
 */
export type PartUse = 'crew' | 'event';

export type ShootPart =
  | { kind: 'person'; role: string; optional?: boolean }
  | { kind: 'gear'; category: GearCategory; label: string; use: PartUse; optional?: boolean }
  | { kind: 'studio'; label: string; use: PartUse; optional?: boolean };

/** What the client is asked when it is missing. `key` decides how "answered" is checked. */
export type QuestionKey = 'date' | 'place' | 'guests' | 'hours' | 'days' | 'locations' | 'coverage' | 'items' | 'people';
export interface ShootQuestion {
  key: QuestionKey;
  text: string;
}

export type SizeKnob = 'guests' | 'hours' | 'days' | 'locations';

/**
 * One step on the plan's timeline, in days from the (first) shoot day:
 * negative before, 0 on the day, positive after. `part` ties a step to a
 * plan part (a role slug, a gear category, or "studios") so that part gets
 * this "do by" date.
 */
export interface ShootStep {
  at: number;
  label: string;
  part?: string;
}

export interface ShootType {
  slug: string;
  name: string;
  group: ShootGroup;
  /** Lower-case words and phrases a client uses for it (English and South African terms). */
  keywords: readonly string[];
  parts: readonly ShootPart[];
  sizes: readonly SizeKnob[];
  /** At most SHOOT_PLAN_POLICY.maxQuestions, most useful first; asked only when missing. */
  questions: readonly ShootQuestion[];
  timeline: readonly ShootStep[];
  /** How far ahead people usually book this, in plain words. */
  leadNote: string;
  /** For big productions: what we can and cannot supply, honestly. */
  scaleNote?: string;
  /** Sad occasions: gentle, brief wording. */
  gentle?: boolean;
  /** Who usually shoots it, when the client's words do not say. */
  defaultMode: PlanMode;
}

// ── Building blocks (keep entries short) ────────────────────────────────────

const person = (role: string, optional = false): ShootPart => (optional ? { kind: 'person', role, optional } : { kind: 'person', role });
/** Crew kit: only when the client shoots it themselves. */
const kit = (category: GearCategory, label: string, optional = false): ShootPart =>
  optional ? { kind: 'gear', category, label, use: 'crew', optional } : { kind: 'gear', category, label, use: 'crew' };
/** An event extra: the occasion needs it whoever shoots. Always optional, labelled for what it is for. */
const extra = (category: GearCategory, label: string): ShootPart => ({ kind: 'gear', category, label, use: 'event', optional: true });
/** The studio as the place to shoot: an event extra. */
const place = (label = 'The studio'): ShootPart => ({ kind: 'studio', label, use: 'event', optional: true });

const Q = {
  date: { key: 'date', text: 'Which day is it?' },
  place: { key: 'place', text: 'Where is it (the area or suburb)?' },
  guests: { key: 'guests', text: 'About how many guests?' },
  hours: { key: 'hours', text: 'How many hours should we cover?' },
  days: { key: 'days', text: 'How many shoot days?' },
  locations: { key: 'locations', text: 'How many locations?' },
  coverage: { key: 'coverage', text: 'Photos, video or both?' },
  items: { key: 'items', text: 'About how many products or looks?' },
  people: { key: 'people', text: 'How many people need photos?' },
} as const satisfies Record<string, ShootQuestion>;

const PV = 'photographer-videographer';
const MUA = 'makeup-artist';
const EDIT_AFTER = (days: number): ShootStep => ({ at: days, label: `Edited photos and video ready, about ${days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} days`} after` });
const SHOOT_DAY = (label = 'Shoot day'): ShootStep => ({ at: 0, label });
const SCALE_FILM = 'We can supply gear and some crew (camera people, make-up, drivers). A full film crew, a director and a producer are not bookable on our site yet.';

export const SHOOT_TYPES: readonly ShootType[] = [
  // ── Weddings and ceremonies ──────────────────────────────────────────────
  {
    slug: 'traditional-wedding',
    name: 'Traditional wedding',
    group: 'weddings',
    keywords: ['traditional wedding', 'traditional ceremony', 'cultural wedding', 'african wedding', 'umshado', 'lenyalo', 'mokete wa lenyalo', '~traditional attire', '~traditional', 'setswana wedding', 'zulu wedding', 'xhosa wedding', 'sotho wedding', 'pedi wedding', 'venda wedding', 'tsonga wedding'],
    parts: [person(PV), person(MUA), person('hairstylist', true), person('driver-with-vehicle', true), person('editor', true), kit('lighting-power', 'Lights', true), extra('sound-reinforcement', 'PA for speeches')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours', 'locations'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -28, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -14, label: 'Send requests for make-up and hair', part: MUA },
      { at: -14, label: 'Book a driver for the family', part: 'driver-with-vehicle' },
      { at: -7, label: 'Book any lights or a PA', part: 'lighting-power' },
      { at: -7, label: 'Book any lights or a PA', part: 'sound-reinforcement' },
      SHOOT_DAY('Wedding day'),
      EDIT_AFTER(21),
    ],
    leadNote: 'Most families book the photographer one to two months ahead, and make-up two weeks ahead.',
  },
  {
    slug: 'white-wedding',
    name: 'White wedding',
    group: 'weddings',
    keywords: ['white wedding', 'church wedding', 'wedding', 'wedding day', '~reception', '~bride', '~groom', '~bridal', 'wedding photographer', 'wedding videographer', 'wedding video', 'wedding photos', '~vows', 'getting married', 'court wedding'],
    parts: [person(PV), person(MUA), person('hairstylist', true), person('driver-with-vehicle', true), person('editor', true), person('drone-pilot', true), extra('sound-reinforcement', 'PA for speeches')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours', 'locations'],
    questions: [Q.date, Q.place, Q.coverage],
    timeline: [
      { at: -42, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -21, label: 'Send requests for make-up and hair', part: MUA },
      { at: -14, label: 'Book the wedding car and driver', part: 'driver-with-vehicle' },
      { at: -7, label: 'Book a PA if you need one', part: 'sound-reinforcement' },
      SHOOT_DAY('Wedding day'),
      EDIT_AFTER(28),
    ],
    leadNote: 'Wedding photographers are often booked one to three months ahead, especially from September to April.',
  },
  {
    slug: 'umembeso',
    name: 'Umembeso',
    group: 'weddings',
    keywords: ['umembeso', 'membeso', 'gift giving ceremony', 'gift ceremony'],
    parts: [person(PV), person(MUA), person('driver-with-vehicle', true), kit('lighting-power', 'Lights', true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -21, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -10, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book a driver if the family needs one', part: 'driver-with-vehicle' },
      SHOOT_DAY('Umembeso day'),
      EDIT_AFTER(14),
    ],
    leadNote: 'Usually booked two to four weeks ahead.',
  },
  {
    slug: 'lobola',
    name: 'Lobola or magadi negotiations',
    group: 'weddings',
    keywords: ['lobola', 'lobolo', 'magadi', 'bogadi', 'negotiations', 'lobola negotiations', 'bride price', 'go kopa', 'ukulobola', 'mahadi'],
    parts: [person(PV), person('driver-with-vehicle', true), person(MUA, true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.coverage],
    timeline: [
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Book a driver for the delegation', part: 'driver-with-vehicle' },
      SHOOT_DAY('Negotiation day'),
      EDIT_AFTER(14),
    ],
    leadNote: 'Usually booked two weeks ahead. Ask the families first whether the negotiations themselves may be filmed.',
  },
  {
    slug: 'umabo-kgoroso',
    name: 'Umabo or kgoroso (welcoming the bride)',
    group: 'weddings',
    keywords: ['umabo', 'kgoroso', 'go laya', 'welcoming the bride', 'bride welcoming', 'umgcagco', 'umtshato', 'ukwendisa', 'umakoti'],
    parts: [person(PV), person(MUA), person('driver-with-vehicle', true), extra('sound-reinforcement', 'PA for speeches')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -21, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -14, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book a PA if you need one', part: 'sound-reinforcement' },
      SHOOT_DAY('Ceremony day'),
      EDIT_AFTER(21),
    ],
    leadNote: 'Usually booked three to four weeks ahead.',
  },
  {
    slug: 'cultural-ceremony',
    name: 'Cultural ceremony',
    group: 'weddings',
    keywords: ['umgidi', 'imbeleko', 'umemulo', 'ancestral ceremony', 'ancestors', 'cultural ceremony', '~homecoming', 'initiation', 'koma', '~ceremony', '~ritual', '~thanksgiving'],
    parts: [person(PV), person('driver-with-vehicle', true), extra('sound-reinforcement', 'PA for speeches and music')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Book a PA if you need one', part: 'sound-reinforcement' },
      SHOOT_DAY('Ceremony day'),
      EDIT_AFTER(14),
    ],
    leadNote: 'Usually booked two weeks ahead. Check with the elders which parts may be photographed.',
  },
  {
    slug: 'engagement',
    name: 'Engagement or proposal',
    group: 'weddings',
    keywords: ['engagement', 'engaged', 'proposal', 'propose', 'pre wedding', 'prewedding', 'save the date', 'couple shoot', 'couples shoot'],
    parts: [person(PV), person(MUA, true), place('Studio, if you shoot inside')],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place],
    timeline: [
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book the studio if you want to shoot inside', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(10),
    ],
    leadNote: 'Usually booked one to two weeks ahead. A surprise proposal needs a clear plan with the photographer.',
  },
  {
    slug: 'memorial',
    name: 'Funeral or memorial',
    group: 'weddings',
    keywords: ['funeral', 'memorial', 'burial', 'unveiling', 'tombstone unveiling', 'umngcwabo', 'poloko', 'passed away', 'celebration of life', 'night vigil', 'after tears', '~remembrance'],
    parts: [person(PV), extra('sound-reinforcement', 'PA for the service'), person('driver-with-vehicle', true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.coverage],
    timeline: [
      { at: -3, label: 'Send a request to the photographer or videographer', part: PV },
      { at: -3, label: 'Book a PA if you need one', part: 'sound-reinforcement' },
      SHOOT_DAY('The service'),
      EDIT_AFTER(14),
    ],
    leadNote: 'Often arranged within a few days. For anything sooner than our reply time, WhatsApp us and we will help.',
    gentle: true,
  },
  // ── Celebrations and events ──────────────────────────────────────────────
  {
    slug: 'matric-dance',
    name: 'Matric dance',
    group: 'celebrations',
    keywords: ['matric dance', 'matric farewell', '~farewell', 'prom', 'matric ball', 'grade 12 dance', '~matric'],
    parts: [person(PV), person(MUA), person('hairstylist', true), person('driver-with-vehicle', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place],
    timeline: [
      { at: -21, label: 'Send requests for make-up', part: MUA },
      { at: -21, label: 'Book the arrival car and driver', part: 'driver-with-vehicle' },
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      SHOOT_DAY('Matric dance'),
      EDIT_AFTER(7),
    ],
    leadNote: 'Make-up artists and cars are busy on matric dance weekends: book three weeks ahead.',
  },
  {
    slug: 'graduation',
    name: 'Graduation',
    group: 'celebrations',
    keywords: ['graduation', 'graduate', 'graduating', '~grad', 'capping', 'diploma ceremony', 'degree ceremony', 'convocation'],
    parts: [person(PV), person(MUA, true), person('driver-with-vehicle', true)],
    defaultMode: 'hire',
    sizes: ['hours'],
    questions: [Q.date, Q.place],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Send a request for make-up', part: MUA },
      SHOOT_DAY('Graduation day'),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead. Graduation weeks fill up fast.',
  },
  {
    slug: 'birthday',
    name: 'Birthday party',
    group: 'celebrations',
    keywords: ['birthday', 'bday', '21st', '30th', '40th', '50th', '60th', '70th', '80th', '~party', '~celebration', 'surprise party', 'kids party', 'first birthday'],
    parts: [person(PV), extra('sound-reinforcement', 'PA for music and speeches'), person(MUA, true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.hours],
    timeline: [
      { at: -10, label: 'Send a request to the photographer or videographer', part: PV },
      { at: -5, label: 'Book a PA if you need one', part: 'sound-reinforcement' },
      SHOOT_DAY('Party day'),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  {
    slug: 'baby-shower',
    name: 'Baby shower or maternity shoot',
    group: 'celebrations',
    keywords: ['baby shower', 'maternity', 'gender reveal', 'bump shoot', 'pregnancy shoot', 'newborn', 'baby shoot'],
    parts: [person(PV), person(MUA, true), place('Studio, for a shoot inside')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Book the studio for a maternity shoot inside', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  {
    slug: 'anniversary',
    name: 'Anniversary or vow renewal',
    group: 'celebrations',
    keywords: ['anniversary', 'vow renewal', 'renew our vows', 'golden anniversary', 'silver anniversary'],
    parts: [person(PV), person(MUA, true), extra('sound-reinforcement', 'PA for speeches')],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -14, label: 'Send a request to the photographer or videographer', part: PV },
      { at: -7, label: 'Send a request for make-up', part: MUA },
      SHOOT_DAY(),
      EDIT_AFTER(14),
    ],
    leadNote: 'Usually booked two weeks ahead.',
  },
  // ── Music ────────────────────────────────────────────────────────────────
  {
    slug: 'music-video',
    name: 'Music video',
    group: 'music',
    keywords: ['music video', 'musicvideo', 'video for my song', 'video for my track', 'amapiano video', 'gqom video', 'hip hop video', 'rap video', 'gospel video', 'maskandi video', 'visualiser', 'visualizer', 'official video'],
    parts: [person(PV), person(MUA), person('model', true), person('gaffer', true), person('editor'), person('director', true), kit('lighting-power', 'Lights'), kit('grip-motion', 'Gimbal or tripod', true), kit('aerial-support', 'Drone', true), place('Studio, if you shoot inside')],
    defaultMode: 'produce',
    sizes: ['days', 'locations', 'hours'],
    questions: [Q.date, Q.place, Q.locations],
    timeline: [
      { at: -21, label: 'Send requests to the videographer', part: PV },
      { at: -10, label: 'Send requests for make-up and models', part: MUA },
      { at: -10, label: 'Send requests for models', part: 'model' },
      { at: -7, label: 'Book lights and any gimbal or drone', part: 'lighting-power' },
      { at: -7, label: 'Book the studio if you shoot inside', part: 'studios' },
      SHOOT_DAY(),
      { at: 14, label: 'Edit and colour, about 2 weeks after the shoot', part: 'editor' },
    ],
    leadNote: 'Most music videos are planned three to four weeks ahead.',
  },
  {
    slug: 'live-performance',
    name: 'Live performance or concert',
    group: 'music',
    keywords: ['concert', 'live performance', '~gig', 'live show', 'festival', '~show', '~stage', '~performance', 'live music', 'launch party', 'album launch'],
    parts: [person(PV), person('sound-recordist', true), person('editor', true), extra('sound-reinforcement', 'PA for the show'), extra('audio', 'Microphones and mixer for the stage'), extra('lighting-power', 'Stage lights'), person('livestream-operator', true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.guests],
    timeline: [
      { at: -21, label: 'Send requests to the videographer', part: PV },
      { at: -7, label: 'Book the PA, microphones and lights', part: 'sound-reinforcement' },
      { at: -7, label: 'Book microphones and a mixer', part: 'audio' },
      SHOOT_DAY('Show day'),
      EDIT_AFTER(14),
    ],
    leadNote: 'Usually planned three weeks ahead.',
    scaleNote: 'For a big stage or a festival we can supply some sound and lights and people to film it. Full stage production and crews are not bookable on our site yet.',
  },
  {
    slug: 'artist-shoot',
    name: 'Artist shoot or album cover',
    group: 'music',
    keywords: ['album cover', 'cover art', 'artwork for my single', 'ep cover', 'single cover', 'press shoot', 'artist shoot', 'press photos', 'epk', 'promo shoot', 'artist photos'],
    parts: [person(PV), person(MUA), person('wardrobe-stylist', true), place('Studio to shoot in'), kit('lighting-power', 'Lights', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place, Q.items],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Send a request for make-up', part: MUA },
      { at: -7, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  // ── Business and brands ──────────────────────────────────────────────────
  {
    slug: 'product-shoot',
    name: 'Product shoot',
    group: 'business',
    keywords: ['product shoot', 'product photos', 'product photography', 'packshot', 'pack shot', 'my products', 'product video', 'shoot my products', '~products'],
    parts: [person(PV), place('Studio to shoot in'), kit('lighting-power', 'Lights', true), person('editor', true)],
    defaultMode: 'hire',
    sizes: ['hours'],
    questions: [Q.date, Q.items, Q.coverage],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  {
    slug: 'ecommerce-catalogue',
    name: 'E-commerce catalogue',
    group: 'business',
    keywords: ['catalogue', 'catalog', 'ecommerce', 'e-commerce', 'online store', 'online shop', 'website photos', 'takealot', 'shopify', 'flat lay', 'flatlay', 'white background'],
    parts: [person(PV), place('Studio to shoot in'), person('model', true), kit('lighting-power', 'Lights', true), kit('data-storage', 'Cards and drives', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'days'],
    questions: [Q.date, Q.items, Q.days],
    timeline: [
      { at: -14, label: 'Send a request to the photographer', part: PV },
      { at: -10, label: 'Send requests for models', part: 'model' },
      { at: -7, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(10),
    ],
    leadNote: 'Usually booked two weeks ahead, longer for hundreds of items.',
  },
  {
    slug: 'brand-campaign',
    name: 'Brand campaign',
    group: 'business',
    keywords: ['brand campaign', '~campaign', 'brand shoot', 'brand content', 'marketing shoot', 'social media campaign', 'billboard', 'brand video', 'ad campaign', '~brands', '~brand'],
    parts: [person(PV), person('model'), person(MUA), person('wardrobe-stylist', true), person('editor', true), person('producer', true), place('Studio, if you shoot inside'), kit('lighting-power', 'Lights')],
    defaultMode: 'hire',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.place, Q.days],
    timeline: [
      { at: -28, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -14, label: 'Send requests for models and make-up', part: 'model' },
      { at: -14, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book the studio and lights', part: 'studios' },
      { at: -7, label: 'Book lights', part: 'lighting-power' },
      SHOOT_DAY(),
      EDIT_AFTER(14),
    ],
    leadNote: 'Campaigns are usually planned four weeks or more ahead.',
    scaleNote: 'For a large campaign we can supply people, gear and the studio. A full agency team or a producer is not bookable on our site yet.',
  },
  {
    slug: 'corporate-event',
    name: 'Corporate event',
    group: 'business',
    keywords: ['corporate event', 'company event', 'year end function', 'year-end function', 'end of year function', 'awards', 'gala', 'gala dinner', 'team building', 'staff party', 'product launch', 'launch event', '~function', '~corporate', 'business event', 'office party'],
    parts: [person(PV), extra('sound-reinforcement', 'PA for speeches'), extra('audio', 'Microphones for speeches'), person('editor', true), kit('lighting-power', 'Lights', true)],
    defaultMode: 'hire',
    sizes: ['guests', 'hours'],
    questions: [Q.date, Q.place, Q.hours],
    timeline: [
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Book the PA and microphones', part: 'sound-reinforcement' },
      { at: -7, label: 'Book microphones', part: 'audio' },
      SHOOT_DAY('Event day'),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked two to three weeks ahead; November and December fill up fast.',
  },
  {
    slug: 'conference',
    name: 'Conference or seminar',
    group: 'business',
    keywords: ['conference', 'summit', 'seminar', '~workshop', 'expo', 'exhibition', 'indaba', 'panel discussion', 'keynote', 'agm', '~webinar'],
    parts: [person(PV), extra('audio', 'Microphones for the speakers'), extra('sound-reinforcement', 'PA for the room'), person('sound-recordist', true), person('livestream-operator', true), person('editor', true)],
    defaultMode: 'hire',
    sizes: ['guests', 'days', 'hours'],
    questions: [Q.date, Q.place, Q.days],
    timeline: [
      { at: -21, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Book microphones, a mixer and a PA', part: 'audio' },
      { at: -7, label: 'Book a PA', part: 'sound-reinforcement' },
      SHOOT_DAY('First conference day'),
      EDIT_AFTER(10),
    ],
    leadNote: 'Usually planned three weeks ahead.',
  },
  {
    slug: 'corporate-headshots',
    name: 'Corporate headshots',
    group: 'business',
    keywords: ['headshots', 'headshot', 'profile photos', 'staff photos', 'team photos', 'linkedin', 'corporate portraits', 'company profile photos', 'id photos for staff'],
    parts: [person(PV), place('Studio, if not at your office'), person(MUA, true), kit('lighting-power', 'Lights', true)],
    defaultMode: 'hire',
    sizes: ['hours'],
    questions: [Q.date, Q.place, Q.people],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Book the studio, or plan to shoot at your office', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(5),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  {
    slug: 'real-estate',
    name: 'Property or real estate',
    group: 'business',
    keywords: ['real estate', '~property', 'house photos', 'listing photos', 'airbnb', 'estate agent', 'property video', '~interior', '~interiors', 'show house', 'guesthouse', '~lodge'],
    parts: [person(PV), person('drone-pilot', true), kit('aerial-support', 'Drone', true), kit('grip-motion', 'Tripod or gimbal', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place, Q.locations],
    timeline: [
      { at: -7, label: 'Send a request to the photographer', part: PV },
      { at: -5, label: 'Book a drone if you want photos from above', part: 'aerial-support' },
      SHOOT_DAY(),
      EDIT_AFTER(5),
    ],
    leadNote: 'Usually booked about a week ahead. Drones may only be flown legally by a licensed pilot.',
  },
  {
    slug: 'food-restaurant',
    name: 'Food or restaurant shoot',
    group: 'business',
    keywords: ['food shoot', 'food photos', 'food photography', 'menu photos', '~restaurant', '~menu', '~dishes', '~cafe', 'shisanyama', '~kitchen', '~chef', 'bakery', '~cakes'],
    parts: [person(PV), person('food-stylist', true), kit('lighting-power', 'Lights', true), place('Studio, if not at your place')],
    defaultMode: 'hire',
    sizes: ['hours'],
    questions: [Q.date, Q.place, Q.items],
    timeline: [
      { at: -10, label: 'Send a request to the photographer', part: PV },
      { at: -7, label: 'Book lights, or the studio', part: 'lighting-power' },
      SHOOT_DAY(),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked one to two weeks ahead.',
  },
  {
    slug: 'fashion-lookbook',
    name: 'Fashion shoot or lookbook',
    group: 'business',
    keywords: ['~fashion', 'lookbook', 'look book', 'clothing brand', 'editorial', 'fashion shoot', 'my clothing', 'new collection', '~apparel', 'streetwear', '~designer', 'fashion week', 'runway'],
    parts: [person(PV), person('model'), person(MUA), person('hairstylist', true), person('wardrobe-stylist', true), place('Studio, if you shoot inside'), kit('lighting-power', 'Lights', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place, Q.items],
    timeline: [
      { at: -14, label: 'Send requests to the photographer', part: PV },
      { at: -10, label: 'Send requests for models', part: 'model' },
      { at: -10, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(10),
    ],
    leadNote: 'Usually booked two weeks ahead.',
  },
  // ── Film and TV ──────────────────────────────────────────────────────────
  {
    slug: 'short-film',
    name: 'Short film',
    group: 'film',
    keywords: ['short film', 'student film', 'short movie', 'film school project', 'thesis film', '~skit', 'web series episode', '~short'],
    parts: [person(PV), person('sound-recordist'), person(MUA), person('gaffer', true), person('editor'), person('director', true), kit('cameras-optics', 'Camera and lenses'), kit('lighting-power', 'Lights'), kit('audio', 'Sound kit'), kit('grip-motion', 'Tripod or gimbal', true)],
    defaultMode: 'produce',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.days, Q.locations],
    timeline: [
      { at: -28, label: 'Send requests to camera and sound people', part: PV },
      { at: -21, label: 'Send requests for a sound recordist', part: 'sound-recordist' },
      { at: -14, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book the camera, lights and sound kit', part: 'cameras-optics' },
      { at: -7, label: 'Book lights', part: 'lighting-power' },
      { at: -7, label: 'Book sound kit', part: 'audio' },
      SHOOT_DAY('First shoot day'),
      { at: 21, label: 'Edit, about 3 weeks after the shoot', part: 'editor' },
    ],
    leadNote: 'Short films are usually planned four weeks or more ahead.',
    scaleNote: SCALE_FILM,
  },
  {
    slug: 'feature-film',
    name: 'Feature film',
    group: 'film',
    keywords: ['feature film', 'movie', 'film production', '~feature', 'full length film', 'cinema release', 'south african film', 'sa film', 'nollywood', 'film shoot', 'a film'],
    parts: [person('film-crew'), person('director'), person('producer'), person(PV), person('sound-recordist'), person(MUA), person('gaffer'), person('editor'), kit('cameras-optics', 'Camera and lenses'), kit('lighting-power', 'Lights'), kit('audio', 'Sound kit'), kit('grip-motion', 'Grip and motion')],
    defaultMode: 'produce',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.days, Q.place],
    timeline: [
      { at: -60, label: 'Plan the crew and the shoot days with our team' },
      { at: -21, label: 'Send requests to the camera people you need', part: PV },
      { at: -14, label: 'Book the camera, lights and sound kit', part: 'cameras-optics' },
      { at: -14, label: 'Book lights', part: 'lighting-power' },
      { at: -14, label: 'Book sound kit', part: 'audio' },
      SHOOT_DAY('First shoot day'),
    ],
    leadNote: 'Feature films are planned months ahead.',
    scaleNote: SCALE_FILM,
  },
  {
    slug: 'series-streaming',
    name: 'Series or streaming show',
    group: 'film',
    keywords: ['series', 'tv series', 'tv show', 'netflix', 'showmax', 'amazon prime', 'disney', 'streaming', '~episodes', '~season', 'sitcom', 'drama series', 'soapie', 'reality show', 'dstv', 'sabc', 'etv', 'mzansi magic'],
    parts: [person('film-crew'), person('director'), person('producer'), person(PV), person('sound-recordist'), person(MUA), person('gaffer'), person('editor'), kit('cameras-optics', 'Camera and lenses'), kit('lighting-power', 'Lights'), kit('audio', 'Sound kit'), kit('grip-motion', 'Grip and motion'), place('Studio, if you shoot inside')],
    defaultMode: 'produce',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.days, Q.place],
    timeline: [
      { at: -60, label: 'Plan the crew and the shoot days with our team' },
      { at: -21, label: 'Send requests to the camera people you need', part: PV },
      { at: -14, label: 'Book the camera, lights and sound kit', part: 'cameras-optics' },
      { at: -14, label: 'Book lights', part: 'lighting-power' },
      { at: -14, label: 'Book sound kit', part: 'audio' },
      SHOOT_DAY('First shoot day'),
    ],
    leadNote: 'Series are planned months ahead.',
    scaleNote: `${SCALE_FILM} For a streaming production, talk to our team on WhatsApp about gear for many days.`,
  },
  {
    slug: 'documentary',
    name: 'Documentary',
    group: 'film',
    keywords: ['documentary', 'doccie', 'docuseries', 'docu', '~interviews', '~interview', 'oral history', 'feature story'],
    parts: [person(PV), person('sound-recordist'), person('editor'), person('driver-with-vehicle', true), person('director', true), kit('audio', 'Sound kit'), kit('cameras-optics', 'Camera and lenses', true), kit('aerial-support', 'Drone', true)],
    defaultMode: 'produce',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.days, Q.locations],
    timeline: [
      { at: -21, label: 'Send requests to the videographer', part: PV },
      { at: -21, label: 'Send requests for a sound recordist', part: 'sound-recordist' },
      { at: -7, label: 'Book sound kit and any camera', part: 'audio' },
      SHOOT_DAY('First shoot day'),
      { at: 28, label: 'Edit, about 4 weeks after the shoot', part: 'editor' },
    ],
    leadNote: 'Usually planned three to four weeks ahead.',
    scaleNote: 'For a long documentary we can supply camera people, drivers and gear. A full crew, a director or a producer is not bookable on our site yet.',
  },
  {
    slug: 'tv-commercial',
    name: 'TV commercial',
    group: 'film',
    keywords: ['tv commercial', 'tvc', 'commercial', 'advert', 'advertisement', 'tv ad', 'radio and tv ad', 'ad shoot', 'promo video', 'explainer video', 'company video', 'corporate video'],
    parts: [person(PV), person('model'), person(MUA), person('gaffer'), person('sound-recordist', true), person('editor'), person('director'), person('producer', true), kit('cameras-optics', 'Camera and lenses'), kit('lighting-power', 'Lights'), place('Studio, if you shoot inside')],
    defaultMode: 'produce',
    sizes: ['days', 'locations'],
    questions: [Q.date, Q.days, Q.place],
    timeline: [
      { at: -28, label: 'Send requests to camera people', part: PV },
      { at: -14, label: 'Send requests for models and make-up', part: 'model' },
      { at: -14, label: 'Send requests for make-up', part: MUA },
      { at: -7, label: 'Book camera, lights and the studio', part: 'cameras-optics' },
      { at: -7, label: 'Book lights', part: 'lighting-power' },
      { at: -7, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      { at: 14, label: 'Edit and colour, about 2 weeks after', part: 'editor' },
    ],
    leadNote: 'Commercials are usually planned four weeks or more ahead.',
    scaleNote: SCALE_FILM,
  },
  // ── Sport ────────────────────────────────────────────────────────────────
  {
    slug: 'sports-event',
    name: 'Sports event',
    group: 'sport',
    keywords: ['~sport', '~sports', 'soccer', 'football', 'rugby', 'cricket', 'netball', 'athletics', 'marathon', '~race', 'tournament', '~match', 'boxing', 'golf day', 'school sports', 'derby', 'fun run', 'cycling'],
    parts: [person(PV), kit('cameras-optics', 'Long lenses', true), person('drone-pilot', true), kit('aerial-support', 'Drone', true), person('editor', true), person('livestream-operator', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'days'],
    questions: [Q.date, Q.place, Q.hours],
    timeline: [
      { at: -14, label: 'Send requests to the photographer or videographer', part: PV },
      { at: -7, label: 'Book long lenses or a drone', part: 'cameras-optics' },
      SHOOT_DAY('Match day'),
      EDIT_AFTER(5),
    ],
    leadNote: 'Usually booked two weeks ahead.',
  },
  // ── Content and live ─────────────────────────────────────────────────────
  {
    slug: 'podcast',
    name: 'Podcast',
    group: 'content',
    keywords: ['podcast', 'pod', 'podcast studio', 'record a podcast', 'podcast episode', 'video podcast', 'vodcast'],
    parts: [kit('audio', 'Microphones and mixer'), person(PV, true), person('sound-recordist', true), place('Studio to record in'), person('editor', true)],
    // Most people who ask about a podcast host and record it themselves.
    defaultMode: 'rent',
    sizes: ['hours', 'days'],
    questions: [Q.date, Q.place, Q.people],
    timeline: [
      { at: -7, label: 'Book microphones and a mixer', part: 'audio' },
      { at: -7, label: 'Book the studio if you record with us', part: 'studios' },
      { at: -7, label: 'Send a request to a videographer for a video podcast', part: PV },
      SHOOT_DAY('Recording day'),
      { at: 7, label: 'Edit, about a week after', part: 'editor' },
    ],
    leadNote: 'Usually booked about a week ahead.',
  },
  {
    slug: 'livestream',
    name: 'Livestream',
    group: 'content',
    keywords: ['livestream', 'live stream', 'stream live', 'streaming live', 'broadcast', 'go live', 'youtube live', 'facebook live', 'zoom', 'hybrid event'],
    parts: [person('livestream-operator'), person(PV), kit('cameras-optics', 'Cameras'), kit('audio', 'Microphones and mixer'), kit('specialized-solutions', 'Specialist kit', true)],
    // A stream needs both the people to run it and the kit to send it.
    defaultMode: 'produce',
    sizes: ['hours'],
    questions: [Q.date, Q.place, Q.hours],
    timeline: [
      { at: -14, label: 'Send requests to the videographer', part: PV },
      { at: -7, label: 'Book cameras and sound', part: 'cameras-optics' },
      { at: -7, label: 'Book microphones', part: 'audio' },
      { at: -1, label: 'Test the internet connection at the venue' },
      SHOOT_DAY('Stream day'),
    ],
    leadNote: 'Usually planned two weeks ahead.',
    scaleNote: 'We can supply cameras, sound and a camera person. Someone to run the stream itself is not bookable on our site yet.',
  },
  {
    slug: 'social-content',
    name: 'YouTube or social media content',
    group: 'content',
    keywords: ['youtube', 'tiktok', 'instagram', 'reels', 'content creation', 'content day', 'social media content', 'vlog', 'influencer', 'content creator', '~socials', 'ugc'],
    parts: [person(PV), kit('cameras-optics', 'Camera', true), kit('audio', 'Microphones', true), kit('lighting-power', 'Lights', true), place('Studio, if you shoot inside'), person('editor', true)],
    defaultMode: 'hire',
    sizes: ['hours', 'locations'],
    questions: [Q.date, Q.place, Q.hours],
    timeline: [
      { at: -7, label: 'Send a request to the videographer', part: PV },
      { at: -5, label: 'Book any camera, microphones or lights', part: 'cameras-optics' },
      { at: -5, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY('Content day'),
      { at: 7, label: 'Edit, about a week after', part: 'editor' },
    ],
    leadNote: 'Usually booked about a week ahead.',
  },
  {
    slug: 'studio-portrait',
    name: 'Studio portrait session',
    group: 'content',
    keywords: ['~portrait', '~portraits', '~photoshoot', '~photo shoot', 'family photos', 'family shoot', 'studio shoot', 'studio session', 'pictures of me', 'personal shoot', 'birthday shoot', 'model portfolio', 'portfolio shoot'],
    parts: [person(PV), place('The studio'), person(MUA, true)],
    defaultMode: 'hire',
    sizes: ['hours'],
    questions: [Q.date, Q.place, Q.people],
    timeline: [
      { at: -7, label: 'Send a request to the photographer', part: PV },
      { at: -5, label: 'Book the studio', part: 'studios' },
      SHOOT_DAY(),
      EDIT_AFTER(7),
    ],
    leadNote: 'Usually booked about a week ahead.',
  },
];

/** When nothing matches: the parts most shoots share, and the plain questions. */
export const GENERAL_SHOOT: ShootType = {
  slug: 'general',
  name: 'A shoot',
  group: 'other',
  keywords: [],
  parts: [person(PV), kit('lighting-power', 'Lights', true)],
  defaultMode: 'hire',
  sizes: ['hours'],
  questions: [Q.date, Q.place, Q.coverage],
  timeline: [{ at: -10, label: 'Send a request to the photographer or videographer', part: PV }, SHOOT_DAY(), EDIT_AFTER(7)],
  leadNote: 'Most shoots are booked one to two weeks ahead.',
};

const BY_SLUG = new Map<string, ShootType>([...SHOOT_TYPES, GENERAL_SHOOT].map((t) => [t.slug, t]));

/** A type by its slug, or null. */
export function shootTypeBySlug(slug: unknown): ShootType | null {
  return typeof slug === 'string' ? BY_SLUG.get(slug.trim().toLowerCase()) ?? null : null;
}

// ── Matching words to a type (keywords only, no model call) ────────────────

export interface ShootMatch {
  type: ShootType;
  /** 0..1. Below SHOOT_PLAN_POLICY.sureConfidence the model checks the type with the client. */
  confidence: number;
  /** The keywords that matched, for saying back. */
  matched: string[];
  /** The next best types, when close. */
  alternatives: string[];
}

function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/e-commerce/g, 'ecommerce')
    .replace(/year-end/g, 'year end')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** A keyword without its weak mark ("~party" is "party"). */
export function keywordWords(keyword: string): string {
  return keyword.replace(/^~/, '');
}

/**
 * Points for one keyword: longer phrases say more ("traditional wedding"
 * beats "wedding"). A weak keyword (marked "~", a word many shoots share,
 * like "party" or "bride") counts half, so "umembeso" beats "bride".
 */
function keywordPoints(t: string, keyword: string): number {
  const k = normalise(keywordWords(keyword));
  if (k.trim() === '' || !t.includes(k)) return 0;
  const words = k.trim().split(' ').length;
  return keyword.startsWith('~') ? words / 2 : words;
}

/**
 * The shoot type plain words mean. Every keyword found scores its word count;
 * a phrase that contains a shorter keyword of another type wins over it.
 * Nothing found: GENERAL_SHOOT with confidence 0.
 */
export function matchShootType(text: unknown): ShootMatch {
  const t = normalise(typeof text === 'string' ? text.slice(0, 600) : '');
  const scored = SHOOT_TYPES.map((type) => {
    const found = type.keywords.map((k) => ({ k: keywordWords(k), n: normalise(keywordWords(k)), p: keywordPoints(t, k) })).filter((h) => h.p > 0);
    // The same words twice ("year end function", "year-end function") count once.
    const hits = found.filter((h, i) => found.findIndex((o) => o.n === h.n) === i);
    // A shorter keyword inside a longer one already counted adds nothing.
    const kept = hits.filter((h) => !hits.some((o) => o !== h && o.n.length > h.n.length && o.n.includes(h.n)));
    return { type, score: kept.reduce((s, h) => s + h.p, 0), best: Math.max(0, ...kept.map((h) => h.p)), matched: kept.map((h) => h.k) };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.best - a.best || b.score - a.score);
  if (!scored.length) return { type: GENERAL_SHOOT, confidence: 0, matched: [], alternatives: [] };
  const [top, next] = scored;
  const margin = next ? top.best - next.best + (top.score - next.score) * 0.5 : top.best;
  // One plain word is a fair guess; a phrase or a clear lead is sure.
  const base = top.best >= 2 ? 0.75 : top.best >= 1 ? 0.55 : 0.4;
  const confidence = Math.min(0.95, Math.max(0.3, base + (next ? Math.min(margin, 2) * 0.1 - (margin <= 0 ? 0.15 : 0) : 0.1)));
  return {
    type: top.type,
    confidence: Math.round(confidence * 100) / 100,
    matched: top.matched,
    alternatives: scored.slice(1, 3).filter((s) => s.best >= top.best - 1).map((s) => s.type.slug),
  };
}

// ── Timeline helpers ────────────────────────────────────────────────────────

/** The key a plan part is known by on the timeline: role slug, gear category or "studios". */
export function partKey(p: ShootPart): string {
  return p.kind === 'person' ? p.role : p.kind === 'gear' ? p.category : 'studios';
}

/**
 * How many days before the shoot this part should be booked (negative), from
 * the type's timeline, or the defaults. A part with only an after-the-shoot
 * step (an editor) is asked before the shoot like any person.
 */
export function partLeadDays(type: ShootType, key: string, kind: ShootPart['kind']): number {
  const step = type.timeline.find((s) => s.part === key && s.at < 0);
  if (step) return step.at;
  return kind === 'person' ? -SHOOT_PLAN_POLICY.defaultPeopleLeadDays : -SHOOT_PLAN_POLICY.defaultGearLeadDays;
}

/** Every word a client could see from this type, for the plain-words test. */
export function clientWords(type: ShootType): string[] {
  return [
    type.name,
    type.leadNote,
    type.scaleNote ?? '',
    ...type.questions.map((q) => q.text),
    ...type.timeline.map((s) => s.label),
    ...type.parts.map((p) => (p.kind === 'person' ? '' : p.label)),
  ].filter(Boolean);
}
