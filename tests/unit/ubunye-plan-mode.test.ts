import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminClient: () => ({}),
}));

import { formatRand } from '@/lib/format/money';
import { GENERAL_SHOOT, SHOOT_TYPES, partKey, shootTypeBySlug, type ShootType } from '@/lib/ubunye/shoot-types';
import { isPlanMode, modeFromSwitch, modeOverride, MODE_SWITCH_SENTENCES, PLAN_MODES, type PlanMode } from '@/lib/ubunye/plan-mode';
import { createOutlineTools, gearEstimate, MODE_UNSURE_LINE, planOutline, resolvePlanMode, type OutlineDeps, type PlanOutlineResult } from '@/lib/agents/tools/outline';
import { planRules } from '@/lib/ubunye/system-prompt';
import evalSet from '../eval/ubunye-outcomes.json';

/**
 * Who is shooting it (flag ubunye_projects): a family that wants graduation
 * photos gets a photographer who brings their own camera, never cameras.
 * Every gear part is tagged crew or event, the mode filters the parts, the
 * high precision overrides hold, and the gear estimate is summed by code
 * from real prices only, never with a person in it.
 */

// Saturday 17 October 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-10-17T08:00:00Z');

const ROLES = [
  { slug: 'photographer-videographer', name: 'Photographer or videographer', status: 'live' },
  { slug: 'makeup-artist', name: 'Make-up artist', status: 'live' },
  { slug: 'model', name: 'Model', status: 'live' },
  { slug: 'driver-with-vehicle', name: 'Driver with vehicle', status: 'live' },
  { slug: 'editor', name: 'Editor', status: 'coming_soon' },
  { slug: 'gaffer', name: 'Gaffer (lighting)', status: 'coming_soon' },
  { slug: 'hairstylist', name: 'Hairstylist', status: 'coming_soon' },
  { slug: 'wardrobe-stylist', name: 'Wardrobe stylist', status: 'coming_soon' },
  { slug: 'drone-pilot', name: 'Drone pilot', status: 'coming_soon' },
  { slug: 'sound-recordist', name: 'Sound recordist', status: 'coming_soon' },
];
const PEOPLE = [
  { roleSlug: 'photographer-videographer', area: 'Soweto and Joburg south' },
  { roleSlug: 'makeup-artist', area: 'Joburg' },
  { roleSlug: 'model', area: 'Sandton' },
];
const GEAR_ROWS = new Map([
  ['lighting-power', { count: 4, cheapestPerDay: 450 }],
  ['audio', { count: 2, cheapestPerDay: 300 }],
  ['cameras-optics', { count: 3, cheapestPerDay: 900 }],
  ['studios', { count: 1, cheapestPerDay: 2500 }],
  ['sound-reinforcement', { count: 1, cheapestPerDay: 800 }],
]);

function deps(over: Partial<OutlineDeps> = {}): OutlineDeps {
  return {
    getRoles: async () => ROLES,
    listedPeople: async () => PEOPLE,
    gearSummary: async (cats) => new Map([...GEAR_ROWS].filter(([k]) => cats.includes(k))),
    now: () => NOW,
    ...over,
  };
}

type Outline = Extract<PlanOutlineResult, { kind: 'plan_outline' }>;
async function outline(input: Parameters<typeof planOutline>[0], over: Partial<OutlineDeps> = {}): Promise<Outline> {
  const out = await planOutline(input, deps(over));
  if (out.kind !== 'plan_outline') throw new Error(`no outline: ${out.message}`);
  return out;
}

const CREW_CATEGORIES = new Set(['cameras-optics', 'lighting-power', 'grip-motion', 'aerial-support', 'data-storage', 'audio', 'specialized-solutions']);
const ALL_TYPES: ShootType[] = [...SHOOT_TYPES, GENERAL_SHOOT];
const crewParts = (o: Outline) => o.parts.filter((p) => p.use === 'crew');

// ── Tagging ─────────────────────────────────────────────────────────────────

describe('tagging: every gear and studio part says what it is for', () => {
  it('every gear and studio part is crew or event; event extras are optional; the studio and a PA are never crew', () => {
    for (const t of ALL_TYPES) {
      for (const p of t.parts) {
        if (p.kind === 'person') continue;
        expect(['crew', 'event'], `${t.slug}: ${partKey(p)}`).toContain(p.use);
        if (p.use === 'event') expect(p.optional, `${t.slug}: ${partKey(p)} is an event extra`).toBe(true);
        if (p.use === 'crew') expect(CREW_CATEGORIES.has(partKey(p)), `${t.slug}: ${partKey(p)}`).toBe(true);
        if (p.kind === 'studio' || partKey(p) === 'sound-reinforcement') expect(p.use, `${t.slug}: ${partKey(p)}`).toBe('event');
      }
    }
  });

  it('every type has a usual mode: families, occasions and businesses hire; film, series, short film, documentary and adverts produce', () => {
    for (const t of ALL_TYPES) expect(isPlanMode(t.defaultMode), t.slug).toBe(true);
    for (const t of SHOOT_TYPES.filter((x) => ['weddings', 'celebrations', 'business', 'sport'].includes(x.group))) expect(t.defaultMode, t.slug).toBe('hire');
    for (const slug of ['feature-film', 'series-streaming', 'short-film', 'documentary', 'tv-commercial']) expect(shootTypeBySlug(slug)?.defaultMode, slug).toBe('produce');
  });

  it('the owner\'s cases: sports, social content, headshots and a traditional wedding have no crew kit when someone shoots it for you', async () => {
    for (const slug of ['sports-event', 'social-content', 'corporate-headshots', 'traditional-wedding', 'graduation']) {
      const o = await outline({ outcome: `${shootTypeBySlug(slug)!.name} with lights, a camera and a drone`, type: slug, mode: 'hire' });
      expect(crewParts(o), slug).toEqual([]);
      expect(o.parts.some((p) => p.kind === 'person'), slug).toBe(true);
    }
    const tw = await outline({ outcome: 'traditional wedding with speeches', type: 'traditional-wedding', mode: 'hire' });
    expect(tw.parts.find((p) => p.key === 'sound-reinforcement')).toMatchObject({ label: 'PA for speeches', extra: true, use: 'event' });
  });
});

// ── Overrides ───────────────────────────────────────────────────────────────

describe('mode overrides: high precision only', () => {
  it.each([
    ['I need two 600d lights from Friday to Monday', 'rent'],
    ['My crew needs a drone and a gimbal for Saturday', 'rent'],
    ["I'm shooting a short film myself, need a camera, lenses and sound", 'rent'],
    ['I have my own camera guy, we just need lights and a gimbal', 'rent'],
    ['Can I get a Sony FX3 and an Aputure for the weekend?', 'rent'],
    ['We will shoot it ourselves, we need a slider', 'rent'],
  ])('"%s" is %s', (text, mode) => {
    expect(modeOverride(text)).toBe(mode);
  });

  it.each([
    ["I'm shooting it myself but I need a make-up artist and lights"],
    ['A Canon camera and a photographer for Saturday'],
    ['graduation photos at Wits'],
    ['We are shooting a Netflix series, can you supply the whole crew and equipment?'],
    ['Photos for my birthday, budget R5 000'],
    ['Pictures of myself for my portfolio'],
    ['A photoshoot of myself in the studio'],
    ['TikTok videos for my shop'],
  ])('no override for "%s" (the model decides)', (text) => {
    expect(modeOverride(text)).toBeNull();
  });

  it('the three switch sentences map to their mode, and win over anything else', () => {
    for (const mode of PLAN_MODES) {
      expect(modeFromSwitch(MODE_SWITCH_SENTENCES[mode])).toBe(mode);
      expect(modeOverride(MODE_SWITCH_SENTENCES[mode])).toBe(mode);
      expect(modeOverride(`My crew needs lights for the music video. ${MODE_SWITCH_SENTENCES[mode]}`)).toBe(mode);
    }
    expect(modeFromSwitch('someone else')).toBeNull();
  });

  it('the system prompt names the three switch sentences exactly', () => {
    const rules = planRules();
    for (const mode of PLAN_MODES) expect(rules).toContain(`"${MODE_SWITCH_SENTENCES[mode]}"`);
    expect(rules).toMatch(/never offer cameras/);
    expect(rules).toMatch(/search_gear/);
  });

  it('resolve: an override beats the model, the model beats the usual mode, nothing given is not sure', () => {
    const grad = shootTypeBySlug('graduation')!;
    const named = new Set<string>(['photographer-videographer']);
    expect(resolvePlanMode('produce', 'graduation photos', grad, named)).toEqual({ mode: 'produce', sure: true });
    expect(resolvePlanMode('hire', 'my crew is shooting the graduation', grad, named)).toEqual({ mode: 'rent', sure: true });
    expect(resolvePlanMode(undefined, 'graduation photos', grad, named)).toEqual({ mode: 'hire', sure: false });
    expect(resolvePlanMode('nonsense', 'graduation photos', grad, named)).toEqual({ mode: 'hire', sure: false });
    // Nothing from the model and only gear named: they shoot it themselves.
    expect(resolvePlanMode(undefined, 'speakers for my party', shootTypeBySlug('birthday')!, new Set(['sound-reinforcement']))).toEqual({ mode: 'rent', sure: false });
  });
});

// ── Filtering per type ──────────────────────────────────────────────────────

describe('the parts follow the mode, for every shoot type', () => {
  it.each(SHOOT_TYPES.map((t) => [t.slug]))('%s: hire has no crew kit, rent no people, produce every required part', async (slug) => {
    const t = shootTypeBySlug(slug)!;
    const hire = await outline({ outcome: t.name, type: slug, mode: 'hire' });
    expect(hire.mode).toBe('hire');
    expect(crewParts(hire)).toEqual([]);
    for (const p of hire.parts.filter((x) => x.kind === 'gear' || x.kind === 'studio')) expect(p.extra, `${slug}: ${p.key}`).toBe(true);
    expect(hire.also_possible.filter((label) => t.parts.some((p) => p.kind !== 'person' && p.use === 'crew' && p.label === label))).toEqual([]);

    const rent = await outline({ outcome: t.name, type: slug, mode: 'rent' });
    expect(rent.mode).toBe('rent');
    expect(rent.parts.filter((p) => p.kind === 'person')).toEqual([]);
    for (const p of t.parts.filter((x) => x.kind !== 'person' && !x.optional)) expect(rent.parts.some((x) => x.key === partKey(p)), `${slug}: ${partKey(p)}`).toBe(true);

    const produce = await outline({ outcome: t.name, type: slug, mode: 'produce' });
    for (const p of t.parts.filter((x) => !x.optional)) expect(produce.parts.some((x) => x.key === partKey(p)), `${slug}: ${partKey(p)}`).toBe(true);
    // Event extras are on the card in every mode, always as extras.
    for (const o of [hire, rent, produce]) {
      for (const p of t.parts.filter((x) => x.kind !== 'person' && x.use === 'event')) expect(o.parts.find((x) => x.key === partKey(p))?.extra, `${slug}: ${partKey(p)}`).toBe(true);
    }
  });

  it('school sports day photos: a photographer, never cameras, lenses or a drone', async () => {
    const o = await outline({ outcome: 'School sports day in Centurion on Friday, I want someone to take photos of the kids' });
    expect(o.type.slug).toBe('sports-event');
    expect(o.mode).toBe('hire');
    expect(o.mode_sure).toBe(false);
    expect(crewParts(o)).toEqual([]);
    expect(o.also_possible).not.toContain('Long lenses');
    expect(o.also_possible).not.toContain('Drone');
    expect(o.plan_hint).toBe('single');
    expect(o.say).toMatch(/never offer cameras/);
  });

  it('a hire client who names gear: the gear is left off and the reply says the person brings it', async () => {
    const o = await outline({ outcome: 'School sports day in Randburg, need a photographer with long lenses', mode: 'hire' });
    expect(o.parts.map((p) => p.key)).toEqual(['photographer-videographer']);
    expect(o.say).toMatch(/brings it/);
  });

  it('rent with one gear part: book it on its own with search_gear', async () => {
    const o = await outline({ outcome: 'I need two 600d lights from Friday to Monday', days: 4 });
    expect(o.mode).toBe('rent');
    expect(o.mode_sure).toBe(true);
    expect(o.parts.map((p) => p.key)).toEqual(['lighting-power']);
    expect(o.plan_hint).toBe('single');
    expect(o.say).toMatch(/search_gear \(category lighting-power\)/);
    expect(o.say).not.toContain(MODE_UNSURE_LINE.rent);
  });

  it('rent where nothing typical is gear (a graduation): ask which gear, never "nothing we offer"', async () => {
    const o = await outline({ outcome: 'my sister graduates at Wits, graduation day', type: 'graduation', mode: 'rent' });
    expect(o.parts).toEqual([]);
    expect(o.plan_hint).toBe('unclear');
    expect(o.say).toMatch(/which gear they need/);
  });

  it('produce keeps people and gear; a switch sentence in the words beats the model', async () => {
    const mv = await outline({ outcome: 'We are producing a music video, need a videographer, lights and an editor', mode: 'produce' });
    expect(mv.parts.some((p) => p.kind === 'person')).toBe(true);
    expect(mv.parts.some((p) => p.use === 'crew')).toBe(true);
    const switched = await outline({ outcome: `music video in Soweto. ${MODE_SWITCH_SENTENCES.rent}`, type: 'music-video', mode: 'hire' });
    expect(switched.mode).toBe('rent');
    expect(switched.parts.filter((p) => p.kind === 'person')).toEqual([]);
  });

  it('the say mentions the mode in one clause only when it is not sure', async () => {
    const unsure = await outline({ outcome: 'graduation photographer and make-up at Wits next Friday' });
    expect(unsure.mode_sure).toBe(false);
    expect(unsure.say).toContain(MODE_UNSURE_LINE.hire);
    const sure = await outline({ outcome: 'graduation photographer and make-up at Wits next Friday', mode: 'hire' });
    expect(sure.mode_sure).toBe(true);
    expect(sure.say).not.toContain(MODE_UNSURE_LINE.hire);
  });

  it('the tool schema offers the three modes as an enum', () => {
    const schema = (createOutlineTools().plan_outline.inputSchema as unknown as { jsonSchema: { properties: { mode: { enum: string[]; description: string } } } }).jsonSchema;
    expect(schema.properties.mode.enum).toEqual([...PLAN_MODES]);
    for (const mode of PLAN_MODES) expect(schema.properties.mode.description).toContain(MODE_SWITCH_SENTENCES[mode]);
  });
});

// ── The estimate ────────────────────────────────────────────────────────────

describe('estimate: by code, from real prices, never a person', () => {
  it('rent: the cheapest day price times the days, written with the money formatter', async () => {
    const o = await outline({ outcome: 'I have my own camera guy, need lights for my music video', type: 'music-video', days: 2 });
    expect(o.mode).toBe('rent');
    expect(o.estimate).toEqual({ text: `Gear from ${formatRand(900)} for 2 days.` });
  });

  it('several gear parts are summed in cents', async () => {
    const o = await outline({ outcome: "I'm shooting a short film myself, need a camera, lenses and sound", type: 'short-film' });
    // Camera 900 + lights 450 + sound kit 300, one day.
    expect(o.estimate).toEqual({ text: `Gear from ${formatRand(1650)} for 1 day.` });
  });

  it('people are never in the sum: produce says their prices are on their cards', async () => {
    const o = await outline({ outcome: 'We are producing a music video, need a videographer, lights and an editor', mode: 'produce' });
    expect(o.estimate?.text).toBe(`Gear from ${formatRand(450)} for 1 day. People prices are on their cards.`);
  });

  it('hire with people only, an unpriced gear part, or a failed price read: no estimate', async () => {
    expect((await outline({ outcome: 'graduation photographer and make-up at Wits', mode: 'hire' })).estimate).toBeNull();
    // A gimbal has no listing in the fake data: nothing honest to sum.
    expect((await outline({ outcome: 'My crew needs lights and a gimbal for Saturday' })).estimate).toBeNull();
    expect((await outline({ outcome: 'I need two 600d lights' }, { gearSummary: async () => { throw new Error('down'); } })).estimate).toBeNull();
  });

  it('an event extra nobody asked for is not counted; one they named is', async () => {
    const quiet = await outline({ outcome: 'traditional wedding, photographer and make-up', mode: 'hire' });
    expect(quiet.estimate).toBeNull();
    const named = await outline({ outcome: 'traditional wedding, photographer and a PA for the speeches', mode: 'hire' });
    expect(named.estimate?.text).toBe(`Gear from ${formatRand(800)} for 1 day. People prices are on their cards.`);
  });

  it('gearEstimate never reads a person, even one with a price-like field', () => {
    const parts = [
      { key: 'photographer-videographer', kind: 'person', label: 'P', state: 'listed', count: 2, in_area: null, from_price: 'R9 999 a day', do_by: null, line: '', next: null },
    ] as unknown as Parameters<typeof gearEstimate>[0];
    expect(gearEstimate(parts, new Map([['photographer-videographer', { count: 1, cheapestPerDay: 9999 }]]), new Set(), 1)).toBeNull();
  });
});

// ── The eval set ────────────────────────────────────────────────────────────

describe('tuning set mode labels', () => {
  type Case = { id: string; text: string; type: string; first_tool: string; mode?: string; mode_any?: string[]; no_gear_for_hire?: boolean };
  const cases = evalSet.cases as Case[];

  it('every case has a mode label; ids are unique; nogear only on hire cases', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(isPlanMode(c.mode), c.id).toBe(true);
      for (const m of c.mode_any ?? []) expect(isPlanMode(m), c.id).toBe(true);
      if (c.no_gear_for_hire) expect(c.mode, c.id).toBe('hire');
    }
    expect(cases.filter((c) => c.no_gear_for_hire).length).toBeGreaterThanOrEqual(6);
  });

  it('given the labelled mode, no override contradicts it and a hire case never gets crew kit', async () => {
    for (const c of cases.filter((x) => x.type !== 'general' || x.first_tool !== 'none')) {
      const o = await outline({ outcome: c.text, mode: c.mode });
      expect([c.mode, ...(c.mode_any ?? [])], c.id).toContain(o.mode);
      if (c.no_gear_for_hire) expect(crewParts(o), c.id).toEqual([]);
      if (c.first_tool === 'search_gear') expect(o.plan_hint, c.id).toBe('single');
    }
  });

  it('the deterministic part alone: high precision rent signals in the set are read as rent with no model', async () => {
    for (const id of ['mo-5', 'mo-6', 'mo-7', 'mo-14']) {
      const c = cases.find((x) => x.id === id)!;
      const o = await outline({ outcome: c.text });
      expect(o.mode, id).toBe('rent' as PlanMode);
      expect(o.mode_sure, id).toBe(true);
    }
  });
});
