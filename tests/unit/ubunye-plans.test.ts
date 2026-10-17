import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminClient: () => ({}),
}));

import { createPeopleTools, resolveRole, type FindPeopleDeps } from '@/lib/agents/tools/people';
import { createSearchTools } from '@/lib/agents/tools/search';
import { createPlanTools, type PlanToolDeps } from '@/lib/agents/tools/plans';
import { recordToolRefs } from '@/lib/agents/tool-refs';
import { getToolsForAgent } from '@/lib/agents/runtime';
import { commitAction, describeAction, issueToken, type AgentActionRecord, type AgentActionRepository, type AgentDeps } from '@/lib/core/agent/use-cases';
import type { PlanLookups, PlanRole } from '@/lib/core/projects/propose';
import { checkRefs, createProject, validatePayload, type ProjectStore } from '@/lib/core/projects/use-cases';
import { partView, planNeeded, planNextAction, type LivePart, type PlanPart } from '@/lib/core/projects/plan';
import { resolveDate } from '@/lib/dates/johannesburg';
import { findIdentityFields, IDENTITY_FIELDS, type Role } from '@/lib/roles';
import type { ProfileCard } from '@/lib/supabase/queries/roles';

/**
 * Slice C: propose_plan and the approval that saves a plan. The model can
 * only point at ids our tools returned, never at someone else's booking,
 * never a plan for one thing, never with the flag off, and nothing it sees
 * names a person. Ends with the scripted music-video transcript, from the
 * real code path with fake storage (the live model is not called).
 */

// Saturday 17 October 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-10-17T08:00:00Z');
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const CONVERSATION = '00000000-0000-4000-8000-0000000000d1';
const VIDEOGRAPHER = '340c1c52-0000-4000-8000-000000000011';
const LIGHT = '5e1f0000-0000-4000-8000-000000000021';
const MY_REQ = '00000000-0000-4000-8000-0000000000e2';
const OTHER_REQ = '00000000-0000-4000-8000-0000000000e1';

const role = (slug: string, name: string, status: 'live' | 'coming_soon', unit: Role['pricing_unit'] = 'day', typical = 150_000): Role => ({
  slug, name, status, role_group: 'camera', description: name, min_age: null, legal_requirements: [], proof_task: [], guidelines: '',
  pricing_unit: unit, suggested_price_cents: { typical, low: typical / 2, high: typical * 2 }, existing_flow_href: null, sort: 1, proof_format: 'portfolio', code_prefix: null,
} as unknown as Role);

const ROLES: Role[] = [
  role('photographer-videographer', 'Photographer or videographer', 'live'),
  role('makeup-artist', 'Make-up artist', 'live', 'look', 65_000),
  role('gaffer', 'Gaffer (lighting)', 'coming_soon'),
  role('editor', 'Editor', 'coming_soon'),
];

const record = { jobs: 0, onTime: 0, rebooked: 0, reviewCount: 0, averageRating: 0, vouches: 0, bookedCredits: [], line: 'New on ThabangVision' };
// The row carries identity on purpose: none of it may reach the model or the card.
const SOWETO_CARD: ProfileCard = {
  id: VIDEOGRAPHER, roleSlug: 'photographer-videographer', roleName: 'Photographer or videographer', label: 'Photographer or videographer in Soweto and Joburg south',
  headline: 'Music videos', cover: 'https://res.cloudinary.com/demo/work.jpg', priceCents: 250_000, perKmCents: null, unit: 'day', verified: true,
  record: 'New on ThabangVision', comesWith: null, area: 'Soweto and Joburg south', availableDays: [], workCount: 8, recordFacts: record,
  ...({ user_id: 'u-secret-999', display_name: 'Thandi Mokoena', first_name: 'Thandi', email: 'thandi@example.com', phone: '0821234567', face_url: 'https://x/face.jpg' } as object),
} as ProfileCard;

const peopleDeps: FindPeopleDeps = { getRoles: async () => ROLES, listProfiles: async (slug) => [SOWETO_CARD].filter((c) => c.roleSlug === slug), now: () => NOW };

/** A chainable stand-in for the Supabase query builder: every call returns itself; awaiting gives the rows. */
function fakeSupabase(rows: unknown[]): unknown {
  const q: Record<string, unknown> = {};
  const self = new Proxy(q, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return () => self;
    },
  });
  return { from: () => self };
}
const LIGHT_ROW = { id: LIGHT, title: 'Aputure LS 300d II kit', brand: 'Aputure', model: '300d II', price_per_day: 450, price_per_week: 2250, deposit_amount: 2000, is_available: true, category: 'lighting-power', slug: 'aputure-300d', description: 'x' };

// ── Fakes for the approval store and the plan store ────────────────────────

function memoryActions(): AgentActionRepository & { rows: Map<string, AgentActionRecord> } {
  const rows = new Map<string, AgentActionRecord>();
  return {
    rows,
    insertPrepared: async (a) => {
      for (const r of rows.values()) if (r.userId === a.userId && r.conversationId === a.conversationId && r.kind === a.kind && r.state === 'prepared') r.state = 'superseded';
      rows.set(a.id, { ...a, state: 'prepared' });
    },
    get: async (id) => rows.get(id) ?? null,
    pending: async (userId, conversationId) => [...rows.values()].find((r) => r.userId === userId && r.conversationId === conversationId && r.state === 'prepared') ?? null,
    rotateNonce: async (id, userId, nonceHash) => {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.state !== 'prepared') return false;
      r.nonceHash = nonceHash;
      return true;
    },
    claim: async (id, userId, nonceHash) => {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.state !== 'prepared' || r.nonceHash !== nonceHash) return false;
      r.state = 'committing';
      return true;
    },
    finish: async (id, state) => {
      const r = rows.get(id);
      if (r) r.state = state;
    },
  };
}

let seq = 0;
function agentDepsFake(repo: AgentActionRepository): AgentDeps {
  return {
    repo,
    signer: { sign: (p) => `sig:${p.length}:${p.slice(-6)}`, verify: (p, s) => s === `sig:${p.length}:${p.slice(-6)}` },
    clock: { now: () => NOW },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    newNonce: () => `nonce-${++seq}`,
    hash: (s) => `h:${s}`,
  };
}

function planStore(over: Partial<ProjectStore> = {}): ProjectStore & { plans: { id: string; title: string; brief: unknown; parts: PlanPart[] }[] } {
  const plans: { id: string; title: string; brief: unknown; parts: PlanPart[] }[] = [];
  return {
    plans,
    flagOn: async () => true,
    ownsRef: async (client, _k, id) => client === CLIENT && id === MY_REQ,
    refInPlan: async () => false,
    create: async (p) => {
      const id = '00000000-0000-4000-8000-0000000000a1';
      plans.push({ id, title: p.title, brief: p.brief, parts: p.parts });
      return id;
    },
    link: async () => ({ ok: true, itemId: 'i' }),
    addNeed: async () => 'n',
    close: async () => true,
    ...over,
  };
}

function lookups(store: ProjectStore, prior: Set<string> = new Set()): PlanLookups {
  return {
    store,
    roles: async () => ROLES.map((r) => ({ slug: r.slug, name: r.name, status: r.status })),
    resolveRole: (words, roles) => {
      const r = resolveRole(words, ROLES);
      return r ? (roles.find((x) => x.slug === r.slug) as PlanRole) ?? null : null;
    },
    personRole: async (id) => (id === VIDEOGRAPHER ? { id, roleSlug: 'photographer-videographer' } : null),
    rental: async (id) => (id === LIGHT ? { id, title: LIGHT_ROW.title } : null),
    describeRef: async (client, _kind, id) => (client === CLIENT && id === MY_REQ ? 'Make-up artist (Saturday 24 October 2026): waiting for their reply' : null),
    priorIds: async () => prior,
    resolveDate,
    now: () => NOW,
  };
}

function planTools(seen: Set<string>, store: ProjectStore, repo = memoryActions(), prior?: Set<string>) {
  const deps: PlanToolDeps = {
    getUser: async () => ({ id: CLIENT }),
    agentDeps: () => agentDepsFake(repo),
    lookups: () => lookups(store, prior),
    listParts: async () => [{ kind: 'people_request', refId: MY_REQ, line: 'Make-up artist (Saturday 24 October 2026): waiting for their reply' }],
  };
  return { tools: createPlanTools({ supabase: null, conversationId: CONVERSATION, seenIds: seen, deps }), repo };
}

const NOT_A_NAME = /Thandi|Mokoena|u-secret|thandi@|0821234567|face\.jpg/;

// ── Rules ──────────────────────────────────────────────────────────────────

describe('propose_plan: the server decides, the model only points', () => {
  it('refuses an id no tool returned in this conversation', async () => {
    const { tools } = planTools(new Set(), planStore());
    const out = await tools.propose_plan.execute({ title: 'Shoot', parts: [{ label: 'videographer', type: 'person', person_id: VIDEOGRAPHER }, { label: 'lights', type: 'gear' }] });
    expect(out).toMatchObject({ no_plan: true, code: 'unknown_id' });
  });

  it('accepts an id stored with an earlier message of the same conversation', async () => {
    const { tools } = planTools(new Set(), planStore(), memoryActions(), new Set([VIDEOGRAPHER]));
    const out = await tools.propose_plan.execute({ title: 'Shoot', parts: [{ label: 'videographer', type: 'person', person_id: VIDEOGRAPHER }, { label: 'lights', type: 'gear' }] });
    expect(out).toMatchObject({ approval_required: true });
  });

  it('refuses someone else\'s booking even when a tool returned its id', async () => {
    const { tools } = planTools(new Set([OTHER_REQ]), planStore());
    const out = await tools.propose_plan.execute({ title: 'Shoot', parts: [{ label: 'theirs', type: 'existing', existing_kind: 'people_request', existing_id: OTHER_REQ }, { label: 'lights', type: 'gear' }] });
    expect(out).toMatchObject({ no_plan: true, code: 'not_owner' });
  });

  it('takes the client\'s own open request from my_plan_parts', async () => {
    const seen = new Set<string>();
    const { tools } = planTools(seen, planStore());
    const wrapped = recordToolRefs(tools, seen);
    await wrapped.my_plan_parts.execute({});
    const out = await wrapped.propose_plan.execute({ title: 'Wedding', parts: [{ label: 'make-up', type: 'existing', existing_kind: 'people_request', existing_id: MY_REQ }, { label: 'videographer', type: 'person', role: 'videographer' }] });
    expect(out).toMatchObject({ approval_required: true });
    expect((out as { parts: string[] }).parts).toContain('Make-up artist (Saturday 24 October 2026): waiting for their reply');
  });

  it('one photographer: no plan is needed', async () => {
    const { tools, repo } = planTools(new Set(), planStore());
    const out = await tools.propose_plan.execute({ title: 'Graduation', parts: [{ label: 'photographer', type: 'person', role: 'photographer' }] });
    expect(out).toMatchObject({ no_plan: true, code: 'single' });
    expect((out as { message: string }).message).toMatch(/No plan is needed for one thing/);
    expect(repo.rows.size).toBe(0);
  });

  it('the server, not the model, decides what a part is', async () => {
    const { tools, repo } = planTools(new Set(), planStore());
    await tools.propose_plan.execute({ title: 'Shoot', parts: [{ label: 'editor', type: 'person', role: 'editor' }, { label: 'catering', type: 'other' }, { label: 'videographer', type: 'other' }] });
    const [action] = [...repo.rows.values()];
    const parts = (action.payload as { parts: PlanPart[] }).parts;
    expect(parts).toEqual([
      { kind: 'need', need: { type: 'unsupported', status: 'coming_soon', label: 'Editor', role_slug: 'editor' } },
      { kind: 'need', need: { type: 'unsupported', status: 'not_offered', label: 'catering' } },
      { kind: 'need', need: { type: 'person', status: 'to_book', label: 'Photographer or videographer', role_slug: 'photographer-videographer' } },
    ]);
    expect(action.amountCents).toBe(0);
    expect(action.kind).toBe('project_create');
  });

  it('flag off: refused, nothing prepared', async () => {
    const { tools, repo } = planTools(new Set(), planStore({ flagOn: async () => false }));
    const out = await tools.propose_plan.execute({ title: 'Shoot', parts: [{ label: 'videographer', type: 'person' }, { label: 'lights', type: 'gear' }] });
    expect(out).toMatchObject({ no_plan: true, code: 'off' });
    expect(repo.rows.size).toBe(0);
  });

  it('flag off or signed out: the tools are not offered at all', () => {
    const flags = { smart_productions: true, roles_v1: true };
    expect(getToolsForAgent('assistant', {}, true, { ...flags, ubunye_projects: false })).not.toHaveProperty('propose_plan');
    expect(getToolsForAgent('assistant', {}, false, { ...flags, ubunye_projects: true })).not.toHaveProperty('propose_plan');
    expect(getToolsForAgent('assistant', {}, true, { ...flags, ubunye_projects: true })).toHaveProperty('propose_plan');
    expect(getToolsForAgent('booking', {}, true, { ...flags, ubunye_projects: true })).toHaveProperty('my_plan_parts');
  });

  it('a commit re-checks ownership: a booking that stopped being theirs is refused', async () => {
    const store = planStore({ ownsRef: async () => false });
    expect(await checkRefs(store, CLIENT, [{ kind: 'people_request', ref_id: MY_REQ, label: 'x' }])).toMatchObject({ ok: false, code: 'not_owner' });
  });
});

describe('blind: nothing the model or the card sees names a person', () => {
  it('find_people, propose_plan and the approval summary carry no identity fields, names or user ids', async () => {
    const seen = new Set<string>();
    const { tools: plan, repo } = planTools(seen, planStore());
    const tools = recordToolRefs({ ...createPeopleTools(peopleDeps), ...plan }, seen);
    const people = await tools.find_people.execute({ role: 'videographer', area: 'Soweto', date: 'next weekend' });
    const proposal = await tools.propose_plan.execute({ title: 'Music video', parts: [{ label: 'videographer', type: 'person', person_id: VIDEOGRAPHER }, { label: 'lights', type: 'gear' }] });
    const [action] = [...repo.rows.values()];
    for (const value of [people, proposal, action.summary, action.payload]) {
      const json = JSON.stringify(value);
      expect(findIdentityFields(value)).toEqual([]);
      for (const f of IDENTITY_FIELDS) expect(json).not.toContain(`"${f}"`);
      expect(json).not.toMatch(NOT_A_NAME);
    }
    expect([...seen]).not.toContain('u-secret-999');
  });
});

// ── The scripted transcript ────────────────────────────────────────────────

describe('transcript: "I am shooting a music video in Soweto next weekend, budget R15,000, I need a videographer, lights and an editor"', () => {
  it('date, videographer, lights, editor as a need, a plan card, approval, and the plan page', async () => {
    const say: string[] = [];
    const user = 'I am shooting a music video in Soweto next weekend, budget R15,000, I need a videographer, lights and an editor';
    say.push(`CLIENT: ${user}`);

    // 1. The date, from the server clock (the prompt carries the same clock line).
    const date = resolveDate('next weekend', NOW);
    expect(date?.iso).toBe('2026-10-24');
    say.push(`[server] today is Saturday 17 October 2026; "next weekend" -> ${date?.iso} (${date?.label}; rule: ${date?.rule})`);

    // 2. Every tool, wrapped as the runtime wraps them, so returned ids are remembered.
    const seen = new Set<string>();
    const store = planStore();
    const { tools: plan, repo } = planTools(seen, store);
    const tools = recordToolRefs(
      { ...createPeopleTools(peopleDeps), ...createSearchTools(fakeSupabase([LIGHT_ROW]) as never, { smart_productions: false }), ...plan },
      seen,
    );

    const videographer = await tools.find_people.execute({ role: 'videographer', area: 'Soweto', date: 'next weekend', budget: 15000, note: 'Music video' });
    expect(videographer.status).toBe('found');
    const m = videographer.matches[0];
    say.push(`[tool find_people role=videographer area=Soweto date="next weekend"] ${videographer.status}: ${m.role} in ${m.area}, ${m.price}, total ${m.total} (${m.total_label}); ${m.budget_note}; ${videographer.availability}`);

    const gear = await tools.search_gear.execute({ category: 'lighting-power', start_date: 'next weekend' });
    expect(gear.results[0].id).toBe(LIGHT);
    say.push(`[tool search_gear category=lighting-power start="next weekend"] ${gear.results[0].title}, R${gear.results[0].price_per_day} a day, deposit R${gear.results[0].deposit}; notice: ${gear.notice?.too_soon ? 'too soon' : 'enough notice'}`);

    const editor = await tools.find_people.execute({ role: 'editor', area: 'Soweto', date: 'next weekend' });
    expect(editor).toMatchObject({ kind: 'people_unavailable', status: 'coming_soon' });
    say.push(`[tool find_people role=editor] ${editor.status}: ${editor.message}`);

    // 3. The plan proposal: the model may only use ids the tools returned.
    expect(seen.has(VIDEOGRAPHER) && seen.has(LIGHT)).toBe(true);
    const proposal = await tools.propose_plan.execute({
      title: 'Music video in Soweto',
      outcome: 'Music video',
      place: 'Soweto',
      date: 'next weekend',
      budget: 15000,
      parts: [
        { label: 'videographer', type: 'person', role: 'videographer', person_id: VIDEOGRAPHER },
        { label: 'lights', type: 'gear', rental_id: LIGHT },
        { label: 'editor', type: 'person', role: 'editor' },
      ],
    });
    expect(proposal).toMatchObject({ approval_required: true, cost: 'Nothing. A plan books nothing and costs nothing.' });
    say.push(`[tool propose_plan] approval card ${(proposal as { proposal_id: string }).proposal_id}`);

    // 4. The card the client sees (loaded from the server, never from model text).
    const card = await describeAction({ repo, clock: { now: () => NOW } }, { actionId: (proposal as { proposal_id: string }).proposal_id, userId: CLIENT });
    if (!card.ok) throw new Error('card did not load');
    expect(card.summary.noCharge).toBe(true);
    expect(card.summary.details).toEqual([
      'Music video · Soweto · Saturday 24 October 2026 · budget R15 000',
      'Photographer or videographer: not asked yet',
      'Aputure LS 300d II kit: not booked yet',
      'Editor: coming soon, we keep it on your plan',
    ]);
    say.push(`[card] ${card.summary.title} | ${card.summary.period}`);
    for (const d of card.summary.details ?? []) say.push(`[card]   ${d}`);
    say.push(`[card] ${card.summary.cancellationPolicy}`);
    say.push(`[card] ${card.summary.nextStep}  [Approve] [Decline]`);
    say.push('UBUNYE: Next weekend is Saturday 24 October 2026. I found one videographer in Soweto (R2 500 a day, within your budget; they confirm within 1 working day), the Aputure LS 300d II kit for lights, and an editor is coming soon, so I kept it on the plan. Press Approve to save the plan. It books nothing and costs nothing.');

    // 5. Approval: the card asks for the token, then commits. Requote and execute re-check everything.
    const deps = agentDepsFake(repo);
    const grant = await issueToken(deps, { actionId: (proposal as { proposal_id: string }).proposal_id, userId: CLIENT });
    if (!grant.ok) throw new Error('no token');
    const committed = await commitAction(
      {
        ...deps,
        requote: async (_k, payload) => {
          const p = validatePayload(payload);
          if (!p || !planNeeded(p.parts).ok) return { ok: false, message: 'no' };
          const refs = await checkRefs(store, CLIENT, p.parts);
          return refs.ok ? { ok: true, amountCents: 0 } : { ok: false, message: refs.message };
        },
        execute: async (_k, payload) => {
          const out = await createProject(store, { clientId: CLIENT, payload });
          return out.ok ? { ok: true, result: { next: `/dashboard/plans/${out.projectId}`, message: 'Your plan is saved. Each part shows where it stands.' } } : { ok: false, message: out.message };
        },
      },
      { actionId: (proposal as { proposal_id: string }).proposal_id, userId: CLIENT, token: grant.token, explicitApproval: true },
    );
    expect(committed).toMatchObject({ ok: true, result: { next: '/dashboard/plans/00000000-0000-4000-8000-0000000000a1' } });
    if (!committed.ok) throw new Error('commit failed');
    const done = committed.result as { message: string; next: string };
    say.push(`CLIENT: [presses Approve] -> ${done.message} [See your plan -> ${done.next}]`);

    // A second press does nothing (single-use token, compare-and-set claim).
    const replay = await commitAction({ ...deps, requote: async () => ({ ok: true, amountCents: 0 }), execute: async () => ({ ok: true, result: {} }) }, { actionId: (proposal as { proposal_id: string }).proposal_id, userId: CLIENT, token: grant.token, explicitApproval: true });
    expect(replay.ok).toBe(false);
    expect(store.plans).toHaveLength(1);

    // 6. The plan page: every part read live (here: from the stored parts), in plain words.
    const saved = store.plans[0];
    const live: LivePart[] = saved.parts.map((p, i) => {
      if (p.kind !== 'need') throw new Error('only needs in this plan');
      const r = ROLES.find((x) => x.slug === p.need.role_slug);
      return { kind: 'need', itemId: `item-${i}`, need: p.need, roleStatus: r ? (r.status === 'live' ? 'live' : 'coming_soon') : null, roleName: r?.name ?? null, rental: p.need.rental_id ? { title: LIGHT_ROW.title, href: `/rentals/lighting-power/${LIGHT_ROW.slug}` } : null };
    });
    const views = live.map((l) => partView(l, saved.id, saved.brief as never));
    const next = planNextAction(views);
    say.push(`[plan page /dashboard/plans/${saved.id}] ${saved.title}`);
    say.push(`[plan page]   Music video · Soweto · Saturday 24 October 2026 · budget R15 000`);
    for (const v of views) say.push(`[plan page]   ${v.line}${v.next ? `  [${v.next.label} -> ${v.next.href}]` : ''}`);
    say.push(`[plan page] Next: ${next?.line} [${next?.label}]`);
    expect(views.map((v) => v.line)).toEqual([
      'Photographer or videographer: not asked yet',
      'Aputure LS 300d II kit: not booked yet',
      'Editor: coming soon, we keep it on your plan',
    ]);
    expect(views[0].next?.href).toBe(`/people/${VIDEOGRAPHER}/request?date=2026-10-24&area=Soweto&plan=${saved.id}&need=item-0`);
    expect(next?.label).toBe('Request this person');

    // Printed for the PR (vitest shows console output).
    console.log(`\n===== TRANSCRIPT =====\n${say.join('\n')}\n===== END =====`);
  });
});
