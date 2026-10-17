import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  createAdminClient: () => ({}),
}));

import { shootTypeBySlug } from '@/lib/ubunye/shoot-types';
import { assignTimeline, moveShift, planSteps, timelineKey } from '@/lib/core/projects/timeline';
import { dueWords, orderParts, partView, type LivePart, type PlanPart } from '@/lib/core/projects/plan';
import { checkMove, movePlanDate, validatePayload, type PlanMoveStore, type ProjectStore } from '@/lib/core/projects/use-cases';
import { buildPlanProposal, type PlanLookups } from '@/lib/core/projects/propose';
import { moveAdvice, moveSay, type MoveContext, type MoveFacts } from '@/lib/core/projects/move';
import { createPlanTools, type PlanToolDeps } from '@/lib/agents/tools/plans';
import { AGENT_ACTION_KINDS } from '@/lib/core/agent/approval';
import type { AgentActionRecord, AgentActionRepository, AgentDeps } from '@/lib/core/agent/use-cases';
import { blindPeopleOutput } from '@/lib/ubunye/chat-cards';
import { pendingProposalBlock } from '@/lib/agent/prompt';
import { resolveDate } from '@/lib/dates/johannesburg';

/**
 * Slice: the plan timeline (098) and "Move my shoot". Each part not booked
 * yet gets a real "do by" date from its shoot type; moving a plan changes
 * only the plan's date and its needs' due dates, after the client approves;
 * People requests and paid bookings are never moved by Ubunye.
 */

// Saturday 17 October 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-10-17T08:00:00Z');
const TODAY = '2026-10-17';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const PLAN = '00000000-0000-4000-8000-0000000000a1';
const NEED = '00000000-0000-4000-8000-0000000000b1';
const PERSON = '340c1c52-0000-4000-8000-000000000011';

const need = (n: PlanPart extends infer T ? (T extends { kind: 'need'; need: infer N } ? N : never) : never): PlanPart => ({ kind: 'need', need: n });
const PV = need({ type: 'person', status: 'to_book', label: 'Photographer or videographer', role_slug: 'photographer-videographer' });
const MUA = need({ type: 'person', status: 'to_book', label: 'Make-up artist', role_slug: 'makeup-artist' });
const LIGHTS = need({ type: 'gear', status: 'to_book', label: 'Lights', category: 'lighting-power' });
const EDITOR = need({ type: 'unsupported', status: 'coming_soon', label: 'Editor', role_slug: 'editor' });
const CATERING = need({ type: 'unsupported', status: 'not_offered', label: 'Catering' });

// ── Timeline ────────────────────────────────────────────────────────────────

describe('plan timeline', () => {
  it('each part not booked yet gets a do by date and a step; positions follow the dates', () => {
    const tw = shootTypeBySlug('traditional-wedding');
    const out = assignTimeline(tw, '2026-12-05', [MUA, CATERING, PV, LIGHTS]);
    expect(out[0]).toMatchObject({ due_date: '2026-11-21', step: 'Send requests for make-up and hair', position: 1 });
    expect(out[2]).toMatchObject({ due_date: '2026-11-07', step: 'Send requests to the photographer or videographer', position: 0 });
    expect(out[3]).toMatchObject({ due_date: '2026-11-28', step: 'Book any lights or a PA', position: 2 });
    expect(out[1]).toMatchObject({ position: 3 });
    expect(out[1].due_date).toBeUndefined();
  });

  it('a coming-soon role keeps a do by date (it stays on the plan); no type or date: no timeline', () => {
    const mv = shootTypeBySlug('music-video');
    const [editor] = assignTimeline(mv, '2026-12-05', [EDITOR]);
    expect(editor.due_date).toBe('2026-11-21');
    expect(assignTimeline(null, '2026-12-05', [PV])[0].due_date).toBeUndefined();
    expect(assignTimeline(mv, null, [PV])[0].due_date).toBeUndefined();
    expect(timelineKey(CATERING)).toBeNull();
    expect(timelineKey(LIGHTS)).toEqual({ key: 'lighting-power', kind: 'gear' });
  });

  it('the plan page words: do by, today, late; parts in plan order', () => {
    expect(dueWords('2026-10-24', TODAY)).toEqual({ iso: '2026-10-24', words: 'Do by Saturday 24 October 2026', late: false });
    expect(dueWords(TODAY, TODAY)?.words).toBe('Do this today');
    expect(dueWords('2026-10-10', TODAY)).toMatchObject({ late: true, words: 'Do this now (it was due by Saturday 10 October 2026)' });
    expect(dueWords(null, TODAY)).toBeNull();
    const ordered = orderParts([{ id: 'c', position: null, due: null }, { id: 'b', position: 1 }, { id: 'a', position: 0 }]);
    expect(ordered.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('partView shows the do by date only on a part still to do', () => {
    const live: LivePart = { kind: 'need', itemId: NEED, need: PV.kind === 'need' ? PV.need : (null as never), roleStatus: 'live', roleName: 'Photographer or videographer', rental: null };
    const v = partView(live, PLAN, { date: '2026-12-05' }, { timeline: { due_date: '2026-11-07', step: 'Send requests', position: 0 }, today: TODAY });
    expect(v.due?.words).toBe('Do by Saturday 7 November 2026');
    expect(v.step).toBe('Send requests');
    const done: LivePart = { kind: 'people_request', itemId: NEED, found: true, requestId: NEED, roleName: 'Make-up artist', roleSlug: 'makeup-artist', status: 'confirmed', dates: [], totalCents: 1 };
    expect(partView(done, PLAN, null, { timeline: { due_date: '2026-11-07' }, today: TODAY }).due).toBeNull();
  });

  it('the plan steps: the shoot day and the edit afterwards, from the brief', () => {
    const steps = planSteps({ shoot_type: 'traditional-wedding', date: '2026-12-05' }, TODAY);
    expect(steps.map((s) => [s.iso, s.label])).toEqual([
      ['2026-12-05', 'Wedding day'],
      ['2026-12-26', 'Edited photos and video ready, about 3 weeks after'],
    ]);
    expect(planSteps({ date: '2026-12-05' }, TODAY)).toEqual([]);
    expect(planSteps({ shoot_type: 'nope', date: '2026-12-05' }, TODAY)).toEqual([]);
  });

  it('moveShift: whole days, and refuses a jump that is too big', () => {
    expect(moveShift('2026-12-05', '2026-12-19')).toBe(14);
    expect(moveShift('2026-12-05', '2026-11-28')).toBe(-7);
    expect(moveShift(null, '2026-12-19')).toBeNull();
    expect(moveShift('2026-01-01', '2028-01-01')).toBeNull();
  });

  it('a stored payload keeps the timeline, checked; a booking never carries a due date', () => {
    const p = validatePayload({
      title: 'Wedding',
      brief: { outcome: 'wedding', shoot_type: 'traditional-wedding' },
      parts: [
        { kind: 'need', need: { type: 'gear', status: 'to_book', label: 'Lights', category: 'lighting-power' }, due_date: '2026-11-28', step: 'Book lights', position: 2 },
        { kind: 'need', need: { type: 'gear', status: 'to_book', label: 'Bad', category: 'rockets' }, due_date: 'soon', position: 900 },
        { kind: 'people_request', ref_id: NEED, label: 'x', due_date: '2026-11-28', position: 1 },
      ],
      source_conversation_id: null,
    });
    expect(p?.brief.shoot_type).toBe('traditional-wedding');
    expect(p?.parts[0]).toMatchObject({ due_date: '2026-11-28', step: 'Book lights', position: 2, need: { category: 'lighting-power' } });
    expect(p?.parts[1]).not.toHaveProperty('due_date');
    expect(p?.parts[1]).not.toHaveProperty('position');
    expect((p?.parts[1] as { need: { category?: string } }).need.category).toBeUndefined();
    expect(p?.parts[2]).toMatchObject({ position: 1 });
    expect(p?.parts[2]).not.toHaveProperty('due_date');
  });
});

// ── propose_plan with a shoot type ──────────────────────────────────────────

function store(): ProjectStore {
  return { flagOn: async () => true, ownsRef: async () => false, refInPlan: async () => false, create: async () => PLAN, link: async () => ({ ok: true, itemId: 'i' }), addNeed: async () => 'n', close: async () => true };
}
function lookups(): PlanLookups {
  const roles = [
    { slug: 'photographer-videographer', name: 'Photographer or videographer', status: 'live' },
    { slug: 'makeup-artist', name: 'Make-up artist', status: 'live' },
    { slug: 'editor', name: 'Editor', status: 'coming_soon' },
  ];
  return {
    store: store(),
    roles: async () => roles,
    resolveRole: (w, rs) => rs.find((r) => w.includes(r.slug.split('-')[0]) || r.name.toLowerCase().includes(w)) ?? null,
    personRole: async () => null,
    rental: async () => null,
    describeRef: async () => null,
    priorIds: async () => new Set(),
    resolveDate,
    now: () => NOW,
  };
}

describe('propose_plan with the shoot type from plan_outline', () => {
  it('the card lists the parts in order with their do by dates; the brief keeps the type', async () => {
    const out = await buildPlanProposal(
      {
        title: 'Traditional wedding in Soweto',
        date: '2026-12-05',
        shoot_type: 'traditional-wedding',
        parts: [
          { label: 'make-up', type: 'person', role: 'makeup' },
          { label: 'photographer', type: 'person', role: 'photographer' },
          { label: 'lights', type: 'gear', category: 'lighting-power' },
        ],
      },
      { clientId: CLIENT, conversationId: null, seenIds: new Set() },
      lookups(),
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.payload.brief.shoot_type).toBe('traditional-wedding');
    expect(out.summary.details).toEqual([
      'Traditional wedding in Soweto · Saturday 5 December 2026',
      'Photographer or videographer: not asked yet (do by Saturday 7 November 2026)',
      'Make-up artist: not asked yet (do by Saturday 21 November 2026)',
      'lights: not booked yet (do by Saturday 28 November 2026)',
    ]);
  });

  it('a slug that is not ours, or no date: no timeline, the parts as given', async () => {
    const out = await buildPlanProposal(
      { title: 'Shoot', shoot_type: 'rocket-launch', parts: [{ label: 'photographer', type: 'person', role: 'photographer' }, { label: 'lights', type: 'gear' }] },
      { clientId: CLIENT, conversationId: null, seenIds: new Set() },
      lookups(),
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.payload.brief.shoot_type).toBeUndefined();
    expect(out.payload.parts.every((p) => p.position === undefined && p.due_date === undefined)).toBe(true);
  });
});

// ── Move my shoot ───────────────────────────────────────────────────────────

const CTX: MoveContext = { projectId: PLAN, newDate: '2026-12-19', newDateEnd: null, shiftDays: 14, gearNoticeOk: true, whatsappUrl: 'https://wa.me/27000000000?text=x', area: 'Soweto' };

describe('moveAdvice: what happens to each part', () => {
  it('a People request is never moved for the client: a new request is prefilled for the new date', () => {
    const [a] = moveAdvice([{ kind: 'people_request', itemId: NEED, line: 'Make-up artist: waiting for their reply', status: 'requested', personRoleId: PERSON, roleSlug: 'makeup-artist' }], CTX);
    expect(a.what).toMatch(/cannot be moved for you/);
    expect(a.movesWithPlan).toBe(false);
    expect(a.action).toEqual({ label: 'Ask them for the new date', href: `/people/${PERSON}/request?date=2026-12-19&plan=${PLAN}&area=Soweto` });
  });

  it('paid bookings and orders are never changed by Ubunye: our team on WhatsApp', () => {
    const out = moveAdvice(
      [
        { kind: 'people_request', itemId: '1', line: 'x', status: 'confirmed', personRoleId: PERSON, roleSlug: null },
        { kind: 'gear_order', itemId: '2', line: 'y', state: 'paid', items: [{ title: 'Aputure kit', href: '/rentals/lighting-power/a', available: false }] },
        { kind: 'service_booking', itemId: '3', line: 'z', over: false },
      ],
      CTX,
    );
    for (const a of out) {
      expect(a.what).toMatch(/never changes/);
      expect(a.action?.href.startsWith('https://wa.me/')).toBe(true);
    }
    expect(out[1].what).toMatch(/fully booked on the new dates: Aputure kit/);
    expect(moveSay(out, true)).toMatch(/never changed by Ubunye/);
  });

  it('an unpaid gear hold lapses; the gear is checked for the new dates, and the notice rule applies', () => {
    const facts: MoveFacts[] = [{ kind: 'gear_order', itemId: '2', line: 'y', state: 'hold', items: [{ title: 'Aputure kit', href: '/rentals/lighting-power/a', available: true }] }];
    const [ok] = moveAdvice(facts, CTX);
    expect(ok.what).toMatch(/only a hold/);
    expect(ok.what).toMatch(/free on the new dates: Aputure kit/);
    expect(ok.action).toEqual({ label: 'Book for the new dates', href: '/rentals/lighting-power/a' });
    const [late] = moveAdvice(facts, { ...CTX, gearNoticeOk: false });
    expect(late.what).toMatch(/48 hours' notice/);
    expect(late.action).toBeNull();
  });

  it('needs only move their do by date; coming soon stays; not offered changes nothing', () => {
    const out = moveAdvice(
      [
        { kind: 'need', itemId: NEED, line: 'p', need: PV.kind === 'need' ? PV.need : (null as never), dueDate: '2026-11-07', rental: null },
        { kind: 'need', itemId: '5', line: 'e', need: EDITOR.kind === 'need' ? EDITOR.need : (null as never), dueDate: null, rental: null },
        { kind: 'need', itemId: '6', line: 'c', need: CATERING.kind === 'need' ? CATERING.need : (null as never), dueDate: null, rental: null },
        { kind: 'need', itemId: '7', line: 'l', need: LIGHTS.kind === 'need' ? LIGHTS.need : (null as never), dueDate: '2026-11-28', rental: { title: 'Aputure kit', href: '/rentals/x', available: false } },
      ],
      CTX,
    );
    expect(out[0]).toMatchObject({ movesWithPlan: true });
    expect(out[0].what).toMatch(/do by date moves to Saturday 21 November 2026/);
    expect(out[0].action?.href).toBe(`/people?role=photographer-videographer&plan=${PLAN}&need=${NEED}`);
    expect(out[1].what).toMatch(/Still coming soon/);
    expect(out[2]).toMatchObject({ movesWithPlan: false, action: null });
    expect(out[3].what).toMatch(/fully booked on the new dates/);
    expect(out[3].action).toEqual({ label: 'See gear', href: '/rentals' });
  });
});

function moveStore(over: Partial<PlanMoveStore> = {}): PlanMoveStore & { moves: unknown[] } {
  const moves: unknown[] = [];
  return {
    moves,
    flagOn: async () => true,
    planDate: async (p) => (p.clientId === CLIENT && p.projectId === PLAN ? { date: '2026-12-05', open: true } : null),
    moveDate: async (p) => {
      moves.push(p);
      return true;
    },
    ...over,
  };
}
const moveInput = (date: unknown, extra: Record<string, unknown> = {}) => ({ clientId: CLIENT, projectId: PLAN, date, today: TODAY, maxDays: 365, label: (iso: string) => `L:${iso}`, ...extra });

describe('moving a plan: checks first, then only the plan date and due dates', () => {
  it('refuses with the flag off, a past date, an end before the start, someone else\'s plan, a closed plan, the same date', async () => {
    expect(await checkMove(moveStore({ flagOn: async () => false }), moveInput('2026-12-19'))).toMatchObject({ ok: false, code: 'off' });
    expect(await checkMove(moveStore(), moveInput('2026-10-01'))).toMatchObject({ ok: false, code: 'bad_date' });
    expect(await checkMove(moveStore(), moveInput('2026-12-19', { dateEnd: '2026-12-18' }))).toMatchObject({ ok: false, code: 'bad_date' });
    expect(await checkMove(moveStore(), moveInput('2026-12-19', { clientId: '00000000-0000-4000-8000-0000000000c2' }))).toMatchObject({ ok: false, code: 'not_found' });
    expect(await checkMove(moveStore({ planDate: async () => ({ date: '2026-12-05', open: false }) }), moveInput('2026-12-19'))).toMatchObject({ ok: false, code: 'closed' });
    expect(await checkMove(moveStore(), moveInput('2026-12-05'))).toMatchObject({ ok: false, code: 'same_date' });
    expect(await checkMove(moveStore({ planDate: async () => { throw new Error('down'); } }), moveInput('2026-12-19'))).toMatchObject({ ok: false, code: 'check_failed' });
  });

  it('moves the plan by the right number of days', async () => {
    const s = moveStore();
    const out = await movePlanDate(s, moveInput('2026-12-19'));
    expect(out).toEqual({ ok: true, projectId: PLAN, date: '2026-12-19' });
    expect(s.moves).toEqual([{ projectId: PLAN, clientId: CLIENT, date: '2026-12-19', dateEnd: null, label: 'L:2026-12-19', shiftDays: 14 }]);
  });

  it('a failed write says nothing changed', async () => {
    const out = await movePlanDate(moveStore({ moveDate: async () => { throw new Error('x'); } }), moveInput('2026-12-19'));
    expect(out).toMatchObject({ ok: false, code: 'failed' });
  });
});

// ── The chat tools for moving ───────────────────────────────────────────────

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

function moveTools(over: Partial<PlanToolDeps> = {}) {
  const repo = memoryActions();
  const agent: AgentDeps = { repo, signer: { sign: () => 's', verify: () => true }, clock: { now: () => NOW }, newId: () => '00000000-0000-4000-8000-00000000f001', newNonce: () => 'n', hash: (s) => s };
  const deps: PlanToolDeps = {
    getUser: async () => ({ id: CLIENT }),
    agentDeps: () => agent,
    lookups: () => lookups(),
    listParts: async () => [],
    moveStore: () => moveStore(),
    defaultPlan: async () => ({ id: PLAN, title: 'Traditional wedding' }),
    moveCheck: async (_u, planId, date) => ({ kind: 'plan_move_check', plan_id: planId, title: 'T', from: null, to: date, shift_days: 14, parts: [], can_move: true, say: 's' }),
    now: () => NOW,
    ...over,
  };
  return { tools: createPlanTools({ supabase: null, conversationId: null, seenIds: new Set(), deps }), repo };
}

describe('plan_move_check and propose_plan_move', () => {
  it('signed out: sign in first', async () => {
    const { tools } = moveTools({ getUser: async () => null });
    expect(await tools.plan_move_check.execute({ new_date: '2026-12-19' })).toMatchObject({ error: expect.stringMatching(/sign in/) });
    expect(await tools.propose_plan_move.execute({ new_date: '2026-12-19' })).toMatchObject({ error: expect.stringMatching(/sign in/) });
  });

  it('reads the date in words, defaults to the plan from this chat', async () => {
    const { tools } = moveTools();
    const out = await tools.plan_move_check.execute({ new_date: '19 December 2026' });
    expect(out).toMatchObject({ kind: 'plan_move_check', plan_id: PLAN, to: '2026-12-19' });
    expect(await tools.plan_move_check.execute({ new_date: 'whenever' })).toMatchObject({ error: expect.stringMatching(/could not read/) });
  });

  it('prepares an approval card that costs nothing; nothing moves until Approve', async () => {
    const { tools, repo } = moveTools();
    const out = await tools.propose_plan_move.execute({ new_date: '2026-12-19' });
    expect(out).toMatchObject({ approval_required: true, cost: 'Nothing.' });
    const [action] = [...repo.rows.values()];
    expect(action).toMatchObject({ kind: 'project_update', amountCents: 0, payload: { project_id: PLAN, date: '2026-12-19', date_end: null } });
    expect(action.summary).toMatchObject({ noCharge: true, doneMessage: 'Your plan is moved.' });
    expect(action.summary.details?.join(' ')).toMatch(/Bookings and requests are not changed/);
    expect(pendingProposalBlock(action)).toMatch(/PLAN MOVE WAITING FOR APPROVAL/);
  });

  it('a move the checks refuse prepares nothing', async () => {
    const { tools, repo } = moveTools();
    expect(await tools.propose_plan_move.execute({ new_date: '2026-10-01' })).toMatchObject({ no_move: true, code: 'bad_date' });
    expect(repo.rows.size).toBe(0);
  });

  it('project_update is a known approval kind', () => {
    expect(AGENT_ACTION_KINDS).toContain('project_update');
  });
});

// ── Chat cards keep only our own plan links ─────────────────────────────────

describe('chat cards: "Add to my plan" survives a reload, only as our own link', () => {
  const base = { kind: 'people_results', status: 'found', role: { slug: 'x', name: 'X' }, matches: [] as unknown[] };
  const match = (plan: string) => ({ id: PERSON, request_url: `/people/${PERSON}/request?date=2026-12-05`, plan_request_url: plan });
  it('keeps a plan link for the same person with a plan id', () => {
    const out = blindPeopleOutput({ ...base, matches: [match(`/people/${PERSON}/request?date=2026-12-05&plan=${PLAN}&need=${NEED}`)] }) as { matches: { plan_request_url?: string }[] };
    expect(out.matches[0].plan_request_url).toBe(`/people/${PERSON}/request?date=2026-12-05&plan=${PLAN}&need=${NEED}`);
  });
  it('drops a link to someone else, another site or one without a plan', () => {
    for (const bad of [`/people/00000000-0000-4000-8000-000000000999/request?plan=${PLAN}`, `https://evil.example/people/${PERSON}/request?plan=${PLAN}`, `/people/${PERSON}/request?date=2026-12-05`]) {
      const out = blindPeopleOutput({ ...base, matches: [match(bad)] }) as { matches: { plan_request_url?: string }[] };
      expect(out.matches[0].plan_request_url, bad).toBeUndefined();
    }
  });
});
