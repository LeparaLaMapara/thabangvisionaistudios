import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminClient: () => ({}),
}));

import { sendPeopleRequest, type RequestProfile, type SendRequestDeps } from '@/lib/roles/request-send';
import {
  askDays,
  buildRequestsProposal,
  checkRequestsPayload,
  executeRequests,
  type AskExecuteDeps,
  type AskLookups,
  type AskPerson,
  type AskPlan,
  type PeopleRequestsPayload,
} from '@/lib/core/projects/requests';
import { askNextHref, planReadiness, readinessWords, requestExpired } from '@/lib/core/projects/readiness';
import { planRequestQuery } from '@/lib/roles/request-prefill';
import { createPlanTools, type PlanToolDeps } from '@/lib/agents/tools/plans';
import { AGENT_ACTION_KINDS } from '@/lib/core/agent/approval';
import { pendingProposalBlock } from '@/lib/agent/prompt';
import type { AgentActionRecord, AgentActionRepository, AgentDeps } from '@/lib/core/agent/use-cases';
import type { LivePart } from '@/lib/core/projects/plan';
import type { RequestInput } from '@/lib/supabase/queries/roles';

/**
 * "Ask everyone": the shared request rules (the form and Ubunye use the
 * same code), the people_requests proposal and commit, and the plan page
 * filling up ("N of M ready", "Ask the next listed person").
 */

const CLIENT = '00000000-0000-4000-8000-0000000c1e01';
const PLAN = '00000000-0000-4000-8000-0000000a1a00';
const PHOTO = '00000000-0000-4000-8000-00000000a101';
const MUA = '00000000-0000-4000-8000-00000000b201';
const DRIVER = '00000000-0000-4000-8000-00000000c301';
const NEED_PHOTO = '00000000-0000-4000-8000-0000000ee001';
const NEED_MUA = '00000000-0000-4000-8000-0000000ee002';
const NOW = new Date('2026-10-17T08:00:00Z'); // Saturday 17 October 2026, Johannesburg
const TODAY = '2026-10-17';

// ── 1. The shared request function (same cases as the route) ───────────────

function profile(over: Partial<RequestProfile['role']> = {}, unit: 'day' | 'hour' = 'day'): RequestProfile {
  return {
    personRole: { id: 'pr-1', price_cents: 180000, pricing_unit: unit },
    role: { pricing_unit: unit, suggested_price_cents: { typical: 150000 }, status: 'live', ...over },
  };
}

function sendDeps(over: Partial<SendRequestDeps> & { created?: RequestInput[]; insertError?: { code: string }; openAfterRace?: string } = {}): SendRequestDeps {
  const created = over.created ?? [];
  let open: string | null = null;
  return {
    profile: async () => profile(),
    ownRoles: async () => [],
    findOpen: async () => open,
    create: async (i) => {
      if (over.insertError) {
        open = over.openAfterRace ?? null;
        throw Object.assign(new Error('duplicate'), over.insertError);
      }
      created.push(i);
      return 'new-request';
    },
    today: () => TODAY,
    ...over,
  };
}

const ask = (date: string, extra: Record<string, unknown> = {}) => ({ person_role_id: 'pr-1', dates: [date], arrival: '08:00', hours: 8, area: 'Johannesburg', note: 'Graduation', ...extra });

describe('sendPeopleRequest (shared by the form and Ask everyone)', () => {
  it('a first request is created, priced from the profile, never from the caller', async () => {
    const created: RequestInput[] = [];
    const out = await sendPeopleRequest(CLIENT, ask('2026-11-14', { total_cents: 1 }), sendDeps({ created }));
    expect(out).toMatchObject({ kind: 'created', id: 'new-request', firstDate: '2026-11-14', shortNotice: false });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ personRoleId: 'pr-1', clientId: CLIENT, date: '2026-11-14', arrival: '08:00', hours: 8, area: 'Johannesburg', note: 'Graduation', dates: ['2026-11-14'], unit: 'day', totalCents: 180000 });
  });

  it('several days for a person paid by the day; the first day only for one paid by the hour', async () => {
    const byDay: RequestInput[] = [];
    await sendPeopleRequest(CLIENT, ask('2026-11-14', { dates: ['2026-11-15', '2026-11-14', '2026-11-15'] }), sendDeps({ created: byDay }));
    expect(byDay[0]).toMatchObject({ date: '2026-11-14', dates: ['2026-11-14', '2026-11-15'], totalCents: 360000 });
    const byHour: RequestInput[] = [];
    await sendPeopleRequest(CLIENT, ask('2026-11-14', { dates: ['2026-11-14', '2026-11-15'], hours: 3 }), sendDeps({ created: byHour, profile: async () => profile({}, 'hour') }));
    expect(byHour[0]).toMatchObject({ dates: ['2026-11-14'], unit: 'hour', hours: 3 });
  });

  it('a double submit returns the open request and creates nothing', async () => {
    const created: RequestInput[] = [];
    const out = await sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ created, findOpen: async () => 'already-sent' }));
    expect(out).toEqual({ kind: 'existing', id: 'already-sent', raced: false });
    expect(created).toHaveLength(0);
  });

  it('two sends racing: the 096 index refuses the second, which gets the first back', async () => {
    const out = await sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ insertError: { code: '23505' }, openAfterRace: 'won-the-race' }));
    expect(out).toEqual({ kind: 'existing', id: 'won-the-race', raced: true });
  });

  it('any other database error is thrown (the caller says "try again")', async () => {
    await expect(sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ insertError: { code: '42P01' } }))).rejects.toThrow();
  });

  it('a past day (South African today) and a half-filled request are refused with 400', async () => {
    expect(await sendPeopleRequest(CLIENT, ask('2026-10-16'), sendDeps())).toMatchObject({ kind: 'refused', status: 400, code: 'past_date', message: 'Pick dates from today on.' });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14', { arrival: '8am' }), sendDeps())).toMatchObject({ kind: 'refused', status: 400, code: 'bad_request' });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14', { hours: 30 }), sendDeps())).toMatchObject({ kind: 'refused', status: 400 });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14', { area: '<b>x</b>' }), sendDeps())).toMatchObject({ kind: 'refused', status: 400 });
  });

  it('a person not listed is 404; your own profile is 409', async () => {
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ profile: async () => null }))).toMatchObject({ kind: 'refused', status: 404, code: 'not_listed' });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ ownRoles: async () => [{ id: 'pr-1' }] }))).toMatchObject({ kind: 'refused', status: 409, code: 'own_profile' });
  });

  it('a role that is not live is refused only when asked (Ask everyone); the form keeps its old behaviour', async () => {
    const closed = sendDeps({ profile: async () => profile({ status: 'coming_soon' }) });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14'), closed, { liveRoleOnly: true })).toMatchObject({ kind: 'refused', code: 'not_live' });
    expect(await sendPeopleRequest(CLIENT, ask('2026-11-14'), sendDeps({ profile: async () => profile({ status: 'coming_soon' }) }))).toMatchObject({ kind: 'created' });
  });

  it('short notice is reported, never refused', async () => {
    const out = await sendPeopleRequest(CLIENT, ask('2026-10-19'), sendDeps());
    expect(out).toMatchObject({ kind: 'created', shortNotice: true, replyBy: '2026-10-19' });
  });
});

// ── 2. The proposal (propose_requests) ─────────────────────────────────────

const PEOPLE: Record<string, AskPerson> = {
  [PHOTO]: { id: PHOTO, roleSlug: 'photographer', roleName: 'Photographer', roleLive: true, unit: 'day' },
  [MUA]: { id: MUA, roleSlug: 'makeup-artist', roleName: 'Make-up artist', roleLive: true, unit: 'hour' },
  [DRIVER]: { id: DRIVER, roleSlug: 'driver', roleName: 'Driver', roleLive: true, unit: 'day' },
};

const openPlan = (over: Partial<AskPlan> = {}): AskPlan => ({
  id: PLAN,
  title: 'Graduation in Soweto',
  open: true,
  needs: [
    { itemId: NEED_PHOTO, roleSlug: 'photographer' },
    { itemId: NEED_MUA, roleSlug: 'makeup-artist' },
  ],
  ...over,
});

function lookups(over: Partial<AskLookups> = {}): AskLookups {
  return {
    flagsOn: async () => true,
    person: async (id) => PEOPLE[id] ?? null,
    plan: async (clientId, id) => (clientId === CLIENT && id === PLAN ? openPlan() : null),
    chatPlan: async () => openPlan(),
    priorIds: async () => new Set(),
    resolveDate: () => null,
    now: () => NOW,
    ...over,
  };
}

const seen = new Set([PHOTO, MUA, DRIVER]);
const proposeInput = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-14',
  place: 'Soweto',
  brief: 'Graduation photos for my daughter',
  requests: [{ person_role_id: PHOTO, role_slug: 'photographer' }, { person_role_id: MUA }],
  ...over,
});

describe('buildRequestsProposal', () => {
  it('builds the card: "Ask 2 people?", one line per request with role and day, never a name, costing nothing', async () => {
    const out = await buildRequestsProposal(proposeInput(), { clientId: CLIENT, seenIds: seen }, lookups());
    if (!out.ok) throw new Error(out.message);
    expect(out.summary.title).toBe('Ask 2 people?');
    expect(out.summary.details?.[0]).toBe('Photographer: asked for Saturday 14 November 2026, from 08:00, 8 hours a day');
    expect(out.summary.details?.[1]).toBe('Make-up artist: asked for Saturday 14 November 2026, from 08:00, 4 hours');
    expect(out.summary.details).toContain('Where: Soweto');
    expect(out.summary).toMatchObject({ totalCents: 0, depositCents: 0, lines: [], noCharge: true });
    expect(out.summary.doneMessage).toBe('Asked. They reply within 1 working day. Your plan shows each answer.');
    // The plan from this chat, each request filling its role's need; the role comes from our data.
    expect(out.payload).toMatchObject({
      project_id: PLAN,
      date: '2026-11-14',
      date_end: null,
      place: 'Soweto',
      arrival: '08:00',
      requests: [
        { person_role_id: PHOTO, role_slug: 'photographer', need_item_id: NEED_PHOTO, hours: 8 },
        { person_role_id: MUA, role_slug: 'makeup-artist', need_item_id: NEED_MUA, hours: 4 },
      ],
    });
  });

  it('"Ask 1 person?", and no plan when this chat has none', async () => {
    const out = await buildRequestsProposal(proposeInput({ requests: [{ person_role_id: DRIVER }] }), { clientId: CLIENT, seenIds: seen }, lookups({ chatPlan: async () => null }));
    if (!out.ok) throw new Error(out.message);
    expect(out.summary.title).toBe('Ask 1 person?');
    expect(out.payload.project_id).toBeNull();
    expect(out.payload.requests[0].need_item_id).toBeNull();
    expect(out.summary.doneMessage).toMatch(/requests page/);
  });

  it('an id find_people never returned in this chat is refused', async () => {
    const stranger = '00000000-0000-4000-8000-00000000dead';
    const out = await buildRequestsProposal(proposeInput({ requests: [{ person_role_id: stranger }] }), { clientId: CLIENT, seenIds: seen }, lookups({ person: async () => ({ ...PEOPLE[PHOTO], id: stranger }) }));
    expect(out).toMatchObject({ ok: false, code: 'unknown_id' });
  });

  it('an id stored with an earlier message of this chat is accepted', async () => {
    const out = await buildRequestsProposal(proposeInput({ requests: [{ person_role_id: PHOTO }] }), { clientId: CLIENT, seenIds: new Set() }, lookups({ priorIds: async () => new Set([PHOTO]) }));
    expect(out.ok).toBe(true);
  });

  it('refuses: flags off, a past day, no place, too many, someone not listed, a role not live, a plan not theirs', async () => {
    const ctx = { clientId: CLIENT, seenIds: seen };
    expect(await buildRequestsProposal(proposeInput(), ctx, lookups({ flagsOn: async () => false }))).toMatchObject({ ok: false, code: 'off' });
    expect(await buildRequestsProposal(proposeInput({ date: '2026-10-01' }), ctx, lookups())).toMatchObject({ ok: false, code: 'bad_date' });
    expect(await buildRequestsProposal(proposeInput({ place: '' }), ctx, lookups())).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await buildRequestsProposal(proposeInput({ requests: Array.from({ length: 7 }, () => ({ person_role_id: PHOTO })) }), ctx, lookups())).toMatchObject({ ok: false, code: 'too_many' });
    expect(await buildRequestsProposal(proposeInput(), ctx, lookups({ person: async () => null }))).toMatchObject({ ok: false, code: 'not_found' });
    expect(await buildRequestsProposal(proposeInput(), ctx, lookups({ person: async (id) => ({ ...PEOPLE[id], roleLive: false }) }))).toMatchObject({ ok: false, code: 'not_live' });
    expect(await buildRequestsProposal(proposeInput({ project_id: '00000000-0000-4000-8000-0000000bad01' }), ctx, lookups())).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('several days: every day for a person paid by the day, the first day for one paid by the hour', () => {
    const p = { date: '2026-11-14', date_end: '2026-11-15' };
    expect(askDays(p, 'day')).toEqual(['2026-11-14', '2026-11-15']);
    expect(askDays(p, 'hour')).toEqual(['2026-11-14']);
  });
});

// ── 3. The commit: requote and execute ──────────────────────────────────────

const payload = (over: Partial<PeopleRequestsPayload> = {}): PeopleRequestsPayload => ({
  project_id: PLAN,
  date: '2026-11-14',
  date_end: null,
  place: 'Soweto',
  brief: 'Graduation photos',
  arrival: '08:00',
  requests: [
    { person_role_id: PHOTO, role_slug: 'photographer', need_item_id: NEED_PHOTO, hours: 8 },
    { person_role_id: MUA, role_slug: 'makeup-artist', need_item_id: NEED_MUA, hours: 4 },
    { person_role_id: DRIVER, role_slug: 'driver', need_item_id: null, hours: 8 },
  ],
  ...over,
});

describe('checkRequestsPayload (the requote)', () => {
  const base = { flagsOn: async () => true, person: async (id: string) => PEOPLE[id] ?? null, plan: async (c: string, id: string) => (c === CLIENT && id === PLAN ? openPlan() : null), now: () => NOW };

  it('costs nothing when everything still holds', async () => {
    expect(await checkRequestsPayload(CLIENT, payload(), base)).toMatchObject({ ok: true, amountCents: 0 });
  });
  it('a person no longer listed refuses the whole approval', async () => {
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, person: async (id) => (id === MUA ? null : PEOPLE[id]) })).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('a person now in another role, or a role no longer live, refuses', async () => {
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, person: async (id) => ({ ...PEOPLE[id], roleSlug: 'model' }) })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, person: async (id) => ({ ...PEOPLE[id], roleLive: false }) })).toMatchObject({ ok: false, code: 'not_live' });
  });
  it('a plan that is not theirs, or closed, refuses', async () => {
    expect(await checkRequestsPayload('00000000-0000-4000-8000-0000000c1e02', payload(), base)).toMatchObject({ ok: false, code: 'not_owner' });
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, plan: async () => openPlan({ open: false }) })).toMatchObject({ ok: false, code: 'closed' });
  });
  it('flags off, a broken payload or a day now past refuses', async () => {
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, flagsOn: async () => false })).toMatchObject({ ok: false, code: 'off' });
    expect(await checkRequestsPayload(CLIENT, { ...payload(), requests: [] }, base)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await checkRequestsPayload(CLIENT, payload({ date: '2026-10-10' }), base)).toMatchObject({ ok: false, code: 'bad_date' });
  });
  it('a failed read refuses (fail closed)', async () => {
    expect(await checkRequestsPayload(CLIENT, payload(), { ...base, person: async () => { throw new Error('down'); } })).toMatchObject({ ok: false, code: 'check_failed' });
  });
});

function execDeps(outcomes: Record<string, Awaited<ReturnType<AskExecuteDeps['send']>> | Error>, over: Partial<AskExecuteDeps> = {}) {
  const sent: Record<string, unknown>[] = [];
  const linked: [string, string, string | null][] = [];
  const notified: string[] = [];
  const deps: AskExecuteDeps = {
    flagsOn: async () => true,
    person: async (id) => PEOPLE[id] ?? null,
    plan: async (c, id) => (c === CLIENT && id === PLAN ? openPlan() : null),
    now: () => NOW,
    send: async (body) => {
      sent.push(body);
      const o = outcomes[body.person_role_id as string];
      if (o instanceof Error) throw o;
      return o;
    },
    link: async (projectId, requestId, need) => {
      linked.push([projectId, requestId, need]);
      return true;
    },
    notify: (id) => void notified.push(id),
    ...over,
  };
  return { deps, sent, linked, notified };
}

describe('executeRequests (the commit)', () => {
  it('created, already open and refused, reported one by one; partial success is honest', async () => {
    const { deps, sent, linked, notified } = execDeps({
      [PHOTO]: { kind: 'created', id: 'req-photo', firstDate: '2026-11-14', shortNotice: false, replyBy: '2026-10-19' },
      [MUA]: { kind: 'existing', id: 'req-mua-open', raced: false },
      [DRIVER]: { kind: 'refused', status: 409, code: 'own_profile', message: 'That is your own profile.' },
    });
    const out = await executeRequests(CLIENT, payload(), 0, deps);
    if (!out.ok) throw new Error(out.message);
    expect(out.result).toMatchObject({
      created: 1,
      already_open: 1,
      refused: 1,
      project_id: PLAN,
      next: `/dashboard/plans/${PLAN}`,
      results: [
        { role: 'Photographer', status: 'created', request_id: 'req-photo', in_plan: true },
        { role: 'Make-up artist', status: 'already_open', request_id: 'req-mua-open', in_plan: true },
        { role: 'Driver', status: 'refused', reason: 'That is your own profile.' },
      ],
    });
    expect(String(out.result.message)).toMatch(/^Asked 2 of 3\./);
    expect(String(out.result.message)).toContain('Driver: not asked. That is your own profile.');
    // Each request went through the shared rules with the plan's day, place and brief.
    expect(sent[0]).toEqual({ person_role_id: PHOTO, dates: ['2026-11-14'], arrival: '08:00', hours: 8, area: 'Soweto', note: 'Graduation photos' });
    // Linked into the plan, filling its need; the refused one is not.
    expect(linked).toEqual([[PLAN, 'req-photo', NEED_PHOTO], [PLAN, 'req-mua-open', NEED_MUA]]);
    // Only a new request tells people.
    expect(notified).toEqual(['req-photo']);
  });

  it('all created: "Asked." and the plan shows each answer', async () => {
    const created = (id: string) => ({ kind: 'created' as const, id, firstDate: '2026-11-14', shortNotice: false, replyBy: '2026-10-19' });
    const { deps } = execDeps({ [PHOTO]: created('a'), [MUA]: created('b'), [DRIVER]: created('c') });
    const out = await executeRequests(CLIENT, payload(), 0, deps);
    expect(out).toMatchObject({ ok: true, result: { created: 3, refused: 0 } });
    if (out.ok) expect(String(out.result.message)).toMatch(/^Asked\. They reply within 1 working day\..*Your plan shows each answer\.$/);
  });

  it('nobody asked at all is a failure that still says why for each', async () => {
    const no = { kind: 'refused' as const, status: 404 as const, code: 'not_listed' as const, message: 'That profile is not available.' };
    const { deps } = execDeps({ [PHOTO]: no, [MUA]: new Error('db down'), [DRIVER]: no });
    const out = await executeRequests(CLIENT, payload(), 0, deps);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toMatch(/^Nobody was asked\./);
      expect(out.message).toContain('Make-up artist: not asked. Could not send this one just now.');
    }
  });

  it('an approval for any amount but 0 is refused before anything is sent', async () => {
    const { deps, sent } = execDeps({});
    expect(await executeRequests(CLIENT, payload(), 100, deps)).toMatchObject({ ok: false, message: expect.stringMatching(/costs nothing/) });
    expect(sent).toHaveLength(0);
  });

  it('every check runs again: a plan that is no longer theirs sends nothing', async () => {
    const { deps, sent } = execDeps({}, { plan: async () => null });
    expect(await executeRequests(CLIENT, payload(), 0, deps)).toMatchObject({ ok: false });
    expect(sent).toHaveLength(0);
  });

  it('the hourly limit stops a request without sending it', async () => {
    const created = { kind: 'created' as const, id: 'a', firstDate: '2026-11-14', shortNotice: true, replyBy: '2026-10-19' };
    let n = 0;
    const { deps, sent } = execDeps({ [PHOTO]: created }, { allow: async () => ++n === 1 });
    const out = await executeRequests(CLIENT, payload(), 0, deps);
    expect(sent).toHaveLength(1);
    expect(out).toMatchObject({ ok: true, result: { created: 1, refused: 2 } });
    if (out.ok) expect(String(out.result.message)).toContain('Photographer: asked (very short notice');
  });
});

// ── 4. The tool ─────────────────────────────────────────────────────────────

function memoryActions(): AgentActionRepository & { rows: Map<string, AgentActionRecord> } {
  const rows = new Map<string, AgentActionRecord>();
  return {
    rows,
    insertPrepared: async (a) => void rows.set(a.id, { ...a, state: 'prepared' }),
    get: async (id) => rows.get(id) ?? null,
    pending: async () => null,
    rotateNonce: async () => true,
    claim: async () => true,
    finish: async () => undefined,
  };
}

function askTools(over: Partial<PlanToolDeps> = {}, seenIds: Set<string> = new Set(seen)) {
  const repo = memoryActions();
  const agent: AgentDeps = { repo, signer: { sign: () => 's', verify: () => true }, clock: { now: () => NOW }, newId: () => '00000000-0000-4000-8000-00000000f099', newNonce: () => 'n', hash: (s) => s };
  const deps: PlanToolDeps = {
    getUser: async () => ({ id: CLIENT }),
    agentDeps: () => agent,
    lookups: () => { throw new Error('not used'); },
    listParts: async () => [],
    askLookups: () => lookups(),
    now: () => NOW,
    ...over,
  };
  return { tools: createPlanTools({ supabase: null, conversationId: null, seenIds, deps }), repo };
}

describe('propose_requests', () => {
  it('prepares one people_requests card costing 0; nothing is sent', async () => {
    const { tools, repo } = askTools();
    const out = await tools.propose_requests.execute(proposeInput());
    expect(out).toMatchObject({ approval_required: true, proposal_id: '00000000-0000-4000-8000-00000000f099', title: 'Ask 2 people?' });
    const [action] = [...repo.rows.values()];
    expect(action).toMatchObject({ kind: 'people_requests', amountCents: 0, state: 'prepared' });
    expect(action.summary.noCharge).toBe(true);
  });

  it('signed out: sign in first; an unseen id: refused and nothing stored', async () => {
    expect(await askTools({ getUser: async () => null }).tools.propose_requests.execute(proposeInput())).toMatchObject({ error: expect.stringMatching(/sign in/) });
    const { tools, repo } = askTools({}, new Set());
    expect(await tools.propose_requests.execute(proposeInput())).toMatchObject({ not_sent: true, code: 'unknown_id' });
    expect(repo.rows.size).toBe(0);
  });

  it('propose_plan tells the model how to ask everyone', async () => {
    const { planForModel } = await import('@/lib/agents/tools/plans');
    expect(String(planForModel('id', 't', [], 'x').message)).toContain('If they want everyone asked now, call propose_requests');
  });

  it('people_requests is a known approval kind with its own pending block', () => {
    expect(AGENT_ACTION_KINDS).toContain('people_requests');
    const block = pendingProposalBlock({ id: 'a1', kind: 'people_requests', expiresAt: 'soon', summary: { title: 'Ask 2 people?', period: 'Saturday 14 November 2026' } } as unknown as AgentActionRecord);
    expect(block).toContain('REQUESTS WAITING FOR APPROVAL');
    expect(block).toContain('nothing to pay');
  });
});

// ── 5. The plan page fills: "N of M ready" ─────────────────────────────────

let n = 0;
const person = (status: string, roleSlug = 'photographer', over: Partial<Extract<LivePart, { kind: 'people_request'; found: true }>> = {}): LivePart => ({
  kind: 'people_request',
  itemId: `item-${++n}`,
  found: true,
  requestId: `req-${n}`,
  roleName: roleSlug,
  roleSlug,
  status,
  dates: ['2026-11-14'],
  totalCents: 100000,
  createdAt: '2026-10-16T08:00:00Z',
  ...over,
});
const needPart = (type: 'person' | 'gear' | 'unsupported', status: 'to_book' | 'coming_soon' | 'not_offered', roleSlug?: string, roleStatus: 'live' | 'coming_soon' | 'gone' | null = 'live'): LivePart => ({
  kind: 'need',
  itemId: `need-${++n}`,
  need: { type, status, label: roleSlug ?? 'Gear', ...(roleSlug ? { role_slug: roleSlug } : {}) },
  roleStatus,
  roleName: roleSlug ?? null,
  rental: null,
});
const gear = (statuses: string[]): LivePart => ({ kind: 'gear_order', itemId: `gear-${++n}`, found: true, titles: ['Lights'], statuses, startDate: '2026-11-14', endDate: '2026-11-15', amountCents: 1, firstBookingId: 'b' });
const opts = { projectId: PLAN, brief: { place: 'Soweto', outcome: 'Graduation' }, today: TODAY, open: true };

describe('planReadiness', () => {
  it('counts only people and gear: accepted or confirmed people and booked gear are ready', () => {
    const r = planReadiness([
      person('accepted'),
      person('confirmed', 'makeup-artist'),
      person('requested', 'driver', { createdAt: '2026-10-17T07:00:00Z' }),
      gear(['confirmed']),
      gear(['pending']),
      needPart('person', 'to_book', 'videographer'),
      needPart('gear', 'to_book'),
      needPart('unsupported', 'coming_soon', 'drone-pilot', 'coming_soon'),
      needPart('unsupported', 'not_offered'),
    ], opts);
    expect(r).toMatchObject({ ready: 3, total: 7 });
    expect(readinessWords(r)).toBe('3 of 7 ready');
    expect(r.askNext).toEqual({});
  });

  it('nothing that counts: no line', () => {
    expect(readinessWords(planReadiness([needPart('unsupported', 'not_offered')], opts))).toBeNull();
  });

  it('a declined request is a place to fill, with "Ask the next listed person" for that role, day, plan and need', () => {
    const declined = person('declined', 'photographer', { personRoleId: 'x' });
    const need = needPart('person', 'to_book', 'photographer');
    const r = planReadiness([declined, need], opts);
    expect(r.total).toBe(2);
    expect(r.ready).toBe(0);
    const href = r.askNext[declined.itemId];
    expect(href.startsWith('/people?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({ date: '2026-11-14', area: 'Soweto', note: 'Graduation', role: 'photographer', plan: PLAN, need: need.itemId });
  });

  it('asking down the list never makes M grow: a newer request takes the place of the one that fell through', () => {
    const r = planReadiness([
      person('declined', 'photographer', { createdAt: '2026-10-10T08:00:00Z' }),
      person('declined', 'photographer', { createdAt: '2026-10-11T08:00:00Z' }),
      person('accepted', 'photographer', { createdAt: '2026-10-12T08:00:00Z' }),
    ], opts);
    expect(r).toMatchObject({ ready: 1, total: 1, askNext: {} });
  });

  it('two people wanted in one role, one declined: still 1 of 2, and only the declined one offers the next person', () => {
    const a = person('accepted', 'photographer', { createdAt: '2026-10-10T08:00:00Z' });
    const d = person('declined', 'photographer', { createdAt: '2026-10-11T08:00:00Z' });
    const r = planReadiness([a, d], opts);
    expect(r).toMatchObject({ ready: 1, total: 2 });
    expect(Object.keys(r.askNext)).toEqual([d.itemId]);
  });

  it('no answer in time counts as a place to fill; a withdrawn request or a cancelled order is left out', () => {
    const stale = person('requested', 'driver', { createdAt: '2026-10-12T08:00:00Z' }); // reply was due Tuesday 13 October
    const r = planReadiness([stale, person('withdrawn', 'model'), gear(['cancelled'])], opts);
    expect(r).toMatchObject({ ready: 0, total: 1 });
    expect(r.askNext[stale.itemId]).toContain('role=driver');
  });

  it('a closed plan shows the count but offers no links', () => {
    const r = planReadiness([person('declined')], { ...opts, open: false });
    expect(r.total).toBe(1);
    expect(r.askNext).toEqual({});
  });

  it('requestExpired: still waiting after the reply window, or the day passed', () => {
    expect(requestExpired({ status: 'requested', dates: ['2026-11-14'], createdAt: '2026-10-16T08:00:00Z' }, TODAY)).toBe(false); // due Monday 19th
    expect(requestExpired({ status: 'requested', dates: ['2026-11-14'], createdAt: '2026-10-14T08:00:00Z' }, TODAY)).toBe(true);
    expect(requestExpired({ status: 'requested', dates: ['2026-10-16'] }, TODAY)).toBe(true);
    expect(requestExpired({ status: 'accepted', dates: ['2026-10-16'] }, TODAY)).toBe(false);
  });

  it('a past day is dropped from the link (the form never prefills a past day)', () => {
    const href = askNextHref({ roleSlug: 'driver', dates: ['2026-10-16'], projectId: PLAN, needItemId: null, brief: null, today: TODAY });
    expect(href).toBe(`/people?role=driver&plan=${PLAN}`);
  });

  it('People carries the checked prefill and the plan on to each request link', () => {
    expect(planRequestQuery({ dates: ['2026-11-14'], area: 'Soweto', note: null }, { planId: PLAN, needItemId: NEED_PHOTO })).toBe(`?date=2026-11-14&area=Soweto&plan=${PLAN}&need=${NEED_PHOTO}`);
    expect(planRequestQuery({ dates: [], area: null, note: null }, { planId: null, needItemId: null })).toBe('');
  });
});
