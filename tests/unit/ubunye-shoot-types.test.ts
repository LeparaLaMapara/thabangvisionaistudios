import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminClient: () => ({}),
}));

import { GEAR_RENTAL_CATEGORIES, SHOOT_PLAN_POLICY } from '@/lib/constants';
import {
  clientWords,
  FUTURE_ROLES,
  GENERAL_SHOOT,
  keywordWords,
  matchShootType,
  partKey,
  partLeadDays,
  SHOOT_GROUPS,
  SHOOT_TYPES,
  shootTypeBySlug,
} from '@/lib/ubunye/shoot-types';
import { createOutlineTools, mentionedParts, planOutline, type OutlineDeps, type PlanOutlineResult } from '@/lib/agents/tools/outline';
import { createPeopleTools, type FindPeopleDeps } from '@/lib/agents/tools/people';
import { getToolsForAgent } from '@/lib/agents/runtime';
import { findIdentityFields, type Role } from '@/lib/roles';
import type { ProfileCard } from '@/lib/supabase/queries/roles';
import evalSet from '../eval/ubunye-outcomes.json';

/**
 * One engine, one catalogue: every shoot type is well formed against our
 * real data (role slugs from the roles seed, real rental categories), the
 * keyword matcher hits the expected type for every sentence of the eval set,
 * and plan_outline reads live states, real dates, too-late warnings and
 * stays blind, with fake data (no database, no model).
 */

// Saturday 17 October 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-10-17T08:00:00Z');

// The role slugs the roles table is seeded with (090), read from the migration itself.
const SEED = readFileSync(path.resolve(__dirname, '../../lib/migrations/090-roles-and-proof.sql'), 'utf8');
const SEEDED_ROLES = new Set([...SEED.matchAll(/\(\s*'([a-z-]+)',\s*'[A-Z][^']*'/g)].map((m) => m[1]));
const GEAR = new Set(GEAR_RENTAL_CATEGORIES.map((c) => c.value as string));
const DASHES = /[‒–—―]| - | -- /;

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
  { slug: 'location-studio', name: 'Location or studio', status: 'coming_soon' },
];

// People rows carry identity on purpose: none of it may reach the output.
const PEOPLE = [
  { roleSlug: 'photographer-videographer', area: 'Soweto and Joburg south', user_id: 'u-secret-1', display_name: 'Thandi Mokoena', email: 'thandi@example.com' },
  { roleSlug: 'photographer-videographer', area: 'Pretoria east', user_id: 'u-secret-2', phone: '0821234567' },
  { roleSlug: 'makeup-artist', area: 'Joburg', face_url: 'https://x/face.jpg' },
  { roleSlug: 'model', area: 'Sandton' },
] as unknown as { roleSlug: string; area: string | null }[];

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
const part = (o: Outline, key: string) => o.parts.find((p) => p.key === key);

// ── The catalogue ───────────────────────────────────────────────────────────

describe('shoot type catalogue', () => {
  it('is wide: at least 30 types across every group, unique slugs', () => {
    expect(SHOOT_TYPES.length).toBeGreaterThanOrEqual(30);
    const slugs = SHOOT_TYPES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain('general');
    const groups = new Set(SHOOT_TYPES.map((t) => t.group));
    for (const g of SHOOT_GROUPS.filter((x) => x.slug !== 'other')) expect(groups.has(g.slug)).toBe(true);
  });

  it('every person part is a seeded role or a named future role; future roles are not seeded yet', () => {
    expect(SEEDED_ROLES.size).toBeGreaterThanOrEqual(11);
    for (const slug of Object.keys(FUTURE_ROLES)) expect(SEEDED_ROLES.has(slug)).toBe(false);
    for (const t of [...SHOOT_TYPES, GENERAL_SHOOT]) {
      for (const p of t.parts) {
        if (p.kind === 'person') expect(SEEDED_ROLES.has(p.role) || p.role in FUTURE_ROLES, `${t.slug}: ${p.role}`).toBe(true);
        if (p.kind === 'gear') expect(GEAR.has(p.category), `${t.slug}: ${p.category}`).toBe(true);
      }
    }
  });

  it('every entry is well formed: a required part, 1 to 3 questions, a shoot day, steps tied to its own parts', () => {
    for (const t of SHOOT_TYPES) {
      expect(t.parts.some((p) => !p.optional), t.slug).toBe(true);
      expect(t.keywords.length, t.slug).toBeGreaterThan(0);
      for (const k of t.keywords) expect(keywordWords(k), `${t.slug}: ${k}`).toBe(keywordWords(k).toLowerCase());
      expect(t.questions.length).toBeGreaterThanOrEqual(1);
      expect(t.questions.length).toBeLessThanOrEqual(SHOOT_PLAN_POLICY.maxQuestions);
      expect(t.timeline.some((s) => s.at === 0), t.slug).toBe(true);
      const keys = new Set(t.parts.map(partKey));
      for (const s of t.timeline) if (s.part) expect(keys.has(s.part), `${t.slug}: step for ${s.part}`).toBe(true);
      expect(t.leadNote.length).toBeGreaterThan(10);
      expect(shootTypeBySlug(t.slug)).toBe(t);
    }
  });

  it('no dashes as punctuation in anything a client can read', () => {
    for (const t of [...SHOOT_TYPES, GENERAL_SHOOT]) for (const w of clientWords(t)) expect(DASHES.test(w), `${t.slug}: ${w}`).toBe(false);
  });

  it('big productions carry an honest scale note; a funeral is gentle', () => {
    for (const slug of ['feature-film', 'series-streaming', 'tv-commercial', 'short-film']) expect(shootTypeBySlug(slug)?.scaleNote, slug).toMatch(/not bookable/);
    expect(shootTypeBySlug('memorial')?.gentle).toBe(true);
  });

  it('lead days: the step for the part, else the defaults', () => {
    const tw = shootTypeBySlug('traditional-wedding')!;
    expect(partLeadDays(tw, 'photographer-videographer', 'person')).toBe(-28);
    expect(partLeadDays(tw, 'makeup-artist', 'person')).toBe(-14);
    expect(partLeadDays(tw, 'editor', 'person')).toBe(-SHOOT_PLAN_POLICY.defaultPeopleLeadDays);
    expect(partLeadDays(tw, 'audio', 'gear')).toBe(-SHOOT_PLAN_POLICY.defaultGearLeadDays);
  });
});

// ── Matching words to a type ────────────────────────────────────────────────

describe('matchShootType', () => {
  it.each(evalSet.cases.map((c) => [c.id, c.text, c.type]))('%s: "%s" is %s', (_id, text, type) => {
    expect(matchShootType(text).type.slug).toBe(type);
  });

  it.each([
    ['umembeso on Saturday', 'umembeso'],
    ['umabo for my brother', 'umabo-kgoroso'],
    ['kgoroso ko Ga-Rankuwa', 'umabo-kgoroso'],
    ['lobola negotiations next month', 'lobola'],
    ['magadi', 'lobola'],
    ['umgidi wase Eastern Cape', 'cultural-ceremony'],
    ['imbeleko for the baby', 'cultural-ceremony'],
    ['matric dance photos', 'matric-dance'],
    ['our white wedding', 'white-wedding'],
    ['traditional wedding in Limpopo', 'traditional-wedding'],
    ['a 24 April wedding', 'white-wedding'],
    ['Netflix series', 'series-streaming'],
    ['tombstone unveiling for my father', 'memorial'],
  ])('South African words: "%s" is %s', (text, type) => {
    expect(matchShootType(text).type.slug).toBe(type);
  });

  it('a specific word beats a shared one (umembeso beats bride), a phrase beats a word', () => {
    expect(matchShootType('Umembeso, make-up for the bride').type.slug).toBe('umembeso');
    const m = matchShootType('traditional wedding');
    expect(m.type.slug).toBe('traditional-wedding');
    expect(m.confidence).toBeGreaterThanOrEqual(SHOOT_PLAN_POLICY.sureConfidence);
  });

  it('nothing matches: the general fallback with confidence 0', () => {
    for (const t of ['', 'hello', 'Can you help me buy shares?', 12 as unknown as string]) {
      const m = matchShootType(t);
      expect(m.type).toBe(GENERAL_SHOOT);
      expect(m.confidence).toBe(0);
    }
  });
});

// ── plan_outline ────────────────────────────────────────────────────────────

describe('plan_outline: live states from our data, never invented', () => {
  it('music video in Soweto next weekend: people listed, editor coming soon, lights with the real cheapest price', async () => {
    const o = await outline({ outcome: 'I need a videographer, lights and an editor for my music video in Soweto next weekend' });
    expect(o.type.slug).toBe('music-video');
    expect(o.date?.iso).toBe('2026-10-24');
    expect(o.place).toBe('Soweto');
    expect(part(o, 'photographer-videographer')).toMatchObject({ state: 'listed', count: 2, in_area: 1, from_price: null, next: { tool: 'find_people', role: 'photographer-videographer' } });
    expect(part(o, 'makeup-artist')).toMatchObject({ state: 'listed', count: 1 });
    expect(part(o, 'editor')).toMatchObject({ state: 'coming_soon', next: null });
    expect(part(o, 'lighting-power')).toMatchObject({ state: 'available', count: 4, from_price: 'R450 a day', next: { tool: 'search_gear', category: 'lighting-power' } });
    expect(o.plan_hint).toBe('plan');
    expect(o.questions).not.toContain('Which day is it?');
    expect(o.questions).not.toContain('Where is it (the area or suburb)?');
    // The card shows "coming soon"; the text must not repeat the parts.
    expect(o.say).toMatch(/do not list the parts/);
    expect(o.say).not.toMatch(/list each part/);
    expect(o.say).toMatch(/propose_plan/);
  });

  it('timeline: real dates from the shoot date; "do by" on each part; steps too late are flagged', async () => {
    const o = await outline({ outcome: 'traditional wedding in Soweto, photos and make-up', date: '2026-11-07' });
    expect(part(o, 'photographer-videographer')?.do_by).toEqual({ iso: '2026-10-10', label: 'Saturday 10 October 2026', too_late: true });
    expect(part(o, 'makeup-artist')?.do_by).toEqual({ iso: '2026-10-24', label: 'Saturday 24 October 2026', too_late: false });
    const day = o.timeline.find((s) => s.label === 'Wedding day');
    expect(day?.iso).toBe('2026-11-07');
    expect(o.timeline.find((s) => s.label.startsWith('Edited'))?.iso).toBe('2026-11-28');
    expect(o.timeline[0].too_late).toBe(true);
    expect(o.warnings.join(' ')).toMatch(/already late/);
  });

  it('short notice: the gear rule checkout enforces and the People reply window', async () => {
    const o = await outline({ outcome: 'music video tomorrow in Soweto with lights' });
    expect(o.date?.iso).toBe('2026-10-18');
    expect(o.warnings.join(' ')).toMatch(/48 hours' notice/);
    expect(o.warnings.join(' ')).toMatch(/very short notice for people/);
  });

  it('not offered: catering, a DJ and a venue are said plainly, never booked', async () => {
    const o = await outline({ outcome: 'my 30th birthday party in Sandton for 80 people, photos, a DJ, catering and a venue' });
    expect(o.not_offered).toEqual(expect.arrayContaining(['A DJ', 'Catering', 'A venue']));
    expect(o.parts.filter((p) => p.kind === 'other').every((p) => p.state === 'not_offered' && p.next === null)).toBe(true);
    expect(o.say).toMatch(/we do not offer/);
    expect(o.questions).not.toContain('About how many guests?');
  });

  it('a Netflix-scale series: the crew, director and producer are not offered, with the honest scale note', async () => {
    const o = await outline({ outcome: 'We are shooting a Netflix series in Joburg next year, 6 episodes, the whole crew and equipment' });
    expect(o.type.slug).toBe('series-streaming');
    for (const k of ['film-crew', 'director', 'producer']) expect(part(o, k)?.state, k).toBe('not_offered');
    expect(part(o, 'film-crew')?.label).toBe('Full film crew');
    expect(o.scale_note).toMatch(/full film crew/i);
    expect(o.say).toMatch(/Say this honestly/);
  });

  it('one person only: a single part, no plan', async () => {
    const o = await outline({ outcome: 'graduation photographer at Wits tomorrow' });
    expect(o.type.slug).toBe('graduation');
    expect(o.plan_hint).toBe('single');
    expect(o.say).toMatch(/no plan/);
  });

  it('not about a shoot: no guessed parts and no questions', async () => {
    const o = await outline({ outcome: 'Can you help me buy shares in Naspers?' });
    expect(o.type.slug).toBe('general');
    expect(o.parts.map((p) => p.label)).toEqual(['Shares or investing']);
    expect(o.plan_hint).toBe('nothing_we_offer');
    expect(o.questions).toEqual([]);
    expect(o.timeline).toEqual([]);
  });

  it('outside Gauteng: said plainly', async () => {
    const o = await outline({ outcome: 'white wedding in Cape Town, photos and make-up' });
    expect(o.warnings.join(' ')).toMatch(/We work in Gauteng/);
  });

  it('a failed read is "could not check", never "none"; no roles at all is unavailable', async () => {
    const o = await outline({ outcome: 'music video in Soweto with lights' }, { gearSummary: async () => { throw new Error('down'); }, listedPeople: async () => { throw new Error('down'); } });
    expect(part(o, 'lighting-power')?.state).toBe('unknown');
    expect(part(o, 'photographer-videographer')?.state).toBe('unknown');
    const none = await planOutline({ outcome: 'music video' }, deps({ getRoles: async () => { throw new Error('down'); } }));
    expect(none.kind).toBe('plan_outline_unavailable');
  });

  it('a past or unreadable date is noted, not used', async () => {
    const past = await outline({ outcome: 'umembeso', date: '2026-10-01' });
    expect(past.date).toBeNull();
    expect(past.date_note).toMatch(/has passed/);
    const bad = await outline({ outcome: 'umembeso', date: 'sometime soon' });
    expect(bad.date_note).toMatch(/could not read/);
  });

  it('every eval sentence: an outline with the expected type, at most 3 questions, blind, no price for a person', async () => {
    for (const c of evalSet.cases) {
      const o = await outline({ outcome: c.text });
      expect(o.type.slug, c.id).toBe(c.type);
      expect(o.questions.length).toBeLessThanOrEqual(SHOOT_PLAN_POLICY.maxQuestions);
      const json = JSON.stringify(o);
      expect(findIdentityFields(o), c.id).toEqual([]);
      expect(json, c.id).not.toMatch(/Thandi|Mokoena|u-secret|thandi@|0821234567|face\.jpg/);
      for (const p of o.parts.filter((x) => x.kind === 'person')) {
        expect(p.from_price, `${c.id} ${p.key}`).toBeNull();
        expect(p.line, `${c.id} ${p.key}`).not.toMatch(/R\s?\d/);
      }
      for (const p of o.parts.filter((x) => x.from_price)) expect(['R450 a day', 'R300 a day', 'R900 a day', 'R2 500 a day', 'R800 a day']).toContain(p.from_price);
      // What the reply must say is backed by a part state the outline really returned.
      if (c.must_say_any) {
        const backed = c.must_say_any.some((w) => (w.includes('coming soon') ? o.parts.some((p) => p.state === 'coming_soon') : o.parts.some((p) => p.state === 'not_offered')));
        expect(backed, c.id).toBe(true);
      }
      if (c.first_tool === 'find_people') expect(o.plan_hint, c.id).toBe('single');
      expect(DASHES.test(o.say), c.id).toBe(false);
    }
  });

  it('mentioned parts: the longest phrase wins ("camera guy" is a person, "sound recordist" is not audio)', () => {
    const m = mentionedParts('camera guy, a sound recordist and a PA system, no DJ');
    expect([...m.keys].sort()).toEqual(['photographer-videographer', 'sound-recordist', 'sound-reinforcement']);
    expect(m.notOffered).toEqual(['A DJ']);
  });

  it('the tool never throws: a broken dependency gives a plain message', async () => {
    const tools = createOutlineTools(deps({ getRoles: () => { throw new Error('boom'); } }));
    const out = await tools.plan_outline.execute({ outcome: 'music video' });
    expect(out.kind).toBe('plan_outline_unavailable');
  });
});

// ── Flags: nothing changes for customers with plans off ─────────────────────

describe('flag off behaviour', () => {
  const base = { smart_productions: true, roles_v1: true };
  it('plan_outline only with People and plans on; plan moves only for signed-in clients', () => {
    expect(getToolsForAgent('assistant', {}, true, { ...base, ubunye_projects: false })).not.toHaveProperty('plan_outline');
    expect(getToolsForAgent('assistant', {}, true, { ...base, ubunye_projects: false })).not.toHaveProperty('plan_move_check');
    expect(getToolsForAgent('assistant', {}, true, { smart_productions: true, roles_v1: false, ubunye_projects: true })).not.toHaveProperty('plan_outline');
    const guest = getToolsForAgent('assistant', {}, false, { ...base, ubunye_projects: true });
    expect(guest).toHaveProperty('plan_outline');
    expect(guest).not.toHaveProperty('plan_move_check');
    expect(guest).not.toHaveProperty('propose_plan_move');
    const client = getToolsForAgent('booking', {}, true, { ...base, ubunye_projects: true });
    expect(client).toHaveProperty('plan_outline');
    expect(client).toHaveProperty('plan_move_check');
    expect(client).toHaveProperty('propose_plan_move');
  });
});

// ── "Add to my plan" on chat People cards ───────────────────────────────────

describe('find_people with an open plan in the chat', () => {
  const PLAN = '00000000-0000-4000-8000-0000000000a1';
  const NEED = '00000000-0000-4000-8000-0000000000b1';
  const PERSON = '340c1c52-0000-4000-8000-000000000011';
  const role = { slug: 'photographer-videographer', name: 'Photographer or videographer', status: 'live', description: 'x', pricing_unit: 'day', suggested_price_cents: { typical: 150_000, low: 1, high: 2 } } as unknown as Role;
  const card = { id: PERSON, roleSlug: role.slug, roleName: role.name, label: 'x', headline: null, cover: null, priceCents: 250_000, perKmCents: null, unit: 'day', verified: true, record: 'New', comesWith: null, area: 'Soweto', availableDays: [], workCount: 1, recordFacts: { jobs: 0 } } as unknown as ProfileCard;
  const peopleDeps: FindPeopleDeps = { getRoles: async () => [role], listProfiles: async () => [card], now: () => NOW };

  it('each card also carries the request link with the plan and the need it fills', async () => {
    const tools = createPeopleTools(peopleDeps, async () => ({ id: PLAN, needs: [{ itemId: NEED, roleSlug: role.slug }] }));
    const out = await tools.find_people.execute({ role: 'photographer', area: 'Soweto', date: '2026-11-07' });
    expect(out.matches[0].plan_request_url).toBe(`/people/${PERSON}/request?date=2026-11-07&area=Soweto&plan=${PLAN}&need=${NEED}`);
  });

  it('no open plan, or the lookup fails: no plan link, the search still works', async () => {
    const none = await createPeopleTools(peopleDeps, async () => null).find_people.execute({ role: 'photographer' });
    expect(none.matches[0].plan_request_url).toBeUndefined();
    const broken = await createPeopleTools(peopleDeps, async () => { throw new Error('down'); }).find_people.execute({ role: 'photographer' });
    expect(broken.status).toBe('found');
    expect(broken.matches[0].plan_request_url).toBeUndefined();
  });
});

describe('plan_outline type: the model picks from the fixed list', () => {
  it('offers every shoot type slug as an enum, so the model cannot invent one', async () => {
    const { createOutlineTools } = await import('@/lib/agents/tools/outline');
    const { SHOOT_TYPES } = await import('@/lib/ubunye/shoot-types');
    const schema = (createOutlineTools().plan_outline.inputSchema as unknown as { jsonSchema: { properties: { type: { enum: string[] } } } }).jsonSchema;
    expect(schema.properties.type.enum).toEqual(SHOOT_TYPES.map((t) => t.slug));
  });
});
