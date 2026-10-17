import { describe, it, expect } from 'vitest';
import {
  briefLine,
  dedupeParts,
  makeBrief,
  parsePlanLink,
  partView,
  planNeeded,
  planNextAction,
  type LivePart,
  type PlanNeed,
  type PlanPart,
} from '@/lib/core/projects/plan';
import { addItem, closeProject, createProject, recordNeed, validateNeed, validatePayload, type ProjectStore } from '@/lib/core/projects/use-cases';

/**
 * Ubunye plans: a plan only when coordination is needed, references only,
 * the client's own only, plain words for live state, fail closed.
 */

const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const OTHER_REQ = '00000000-0000-4000-8000-0000000000e1';
const MY_REQ = '00000000-0000-4000-8000-0000000000e2';
const PLAN = '00000000-0000-4000-8000-0000000000a1';
const NEED = '00000000-0000-4000-8000-0000000000b1';

const personNeed: PlanNeed = { type: 'person', status: 'to_book', label: 'Photographer or videographer', role_slug: 'photographer-videographer' };
const editorNeed: PlanNeed = { type: 'unsupported', status: 'coming_soon', label: 'Editor', role_slug: 'editor' };
const cateringNeed: PlanNeed = { type: 'unsupported', status: 'not_offered', label: 'Catering' };
const person: PlanPart = { kind: 'need', need: personNeed };
const lights: PlanPart = { kind: 'need', need: { type: 'gear', status: 'to_book', label: 'Aputure 300d' } };
const editor: PlanPart = { kind: 'need', need: editorNeed };
const catering: PlanPart = { kind: 'need', need: cateringNeed };

describe('planNeeded: a plan only when coordination is needed', () => {
  it('one photographer never makes a plan', () => {
    const r = planNeeded([person]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('single');
      expect(r.message).toMatch(/No plan is needed for one thing/);
    }
  });
  it('one existing booking alone is not a plan either', () => {
    expect(planNeeded([{ kind: 'people_request', ref_id: MY_REQ, label: 'x' }]).ok).toBe(false);
  });
  it('two or more parts make a plan', () => {
    expect(planNeeded([person, lights]).ok).toBe(true);
    expect(planNeeded([person, lights, editor]).ok).toBe(true);
  });
  it('a lone need we cannot fill yet (coming soon) is remembered as a plan', () => {
    expect(planNeeded([editor]).ok).toBe(true);
  });
  it('things we do not offer never make a plan on their own, and do not count towards two', () => {
    expect(planNeeded([catering]).ok).toBe(false);
    expect(planNeeded([catering, catering]).ok).toBe(false);
    expect(planNeeded([person, catering]).ok).toBe(false);
    expect(planNeeded([person, lights, catering]).ok).toBe(true);
  });
  it('empty and too many are refused', () => {
    expect(planNeeded([]).ok).toBe(false);
    expect(planNeeded(Array.from({ length: 13 }, () => lights)).ok).toBe(false);
  });
  it('the same thing twice counts once', () => {
    expect(dedupeParts([person, person, lights])).toHaveLength(2);
  });
});

describe('brief: what the client said, capped', () => {
  it('keeps outcome, place, date and budget in cents, and reads as one line', () => {
    const b = makeBrief({ outcome: 'Music video', place: 'Soweto', date: { iso: '2026-10-24', label: 'Saturday 24 October 2026' }, budget: 15000 });
    expect(b).toEqual({ outcome: 'Music video', place: 'Soweto', date: '2026-10-24', date_label: 'Saturday 24 October 2026', date_end: null, budget_cents: 1_500_000 });
    expect(briefLine(b)).toBe('Music video · Soweto · Saturday 24 October 2026 · budget R15 000');
  });
  it('drops tags and fences, and never exceeds the 097 size cap', () => {
    const b = makeBrief({ outcome: `<script>x</script> ===== ${'é'.repeat(5000)}`, place: 'Soweto' });
    expect(b.outcome).not.toMatch(/[<>]|={3}/);
    expect(new TextEncoder().encode(JSON.stringify(b)).length).toBeLessThanOrEqual(2048);
  });
  it('a silly budget is not recorded', () => {
    expect(makeBrief({ outcome: 'x', budget: -5 }).budget_cents).toBeNull();
    expect(makeBrief({ outcome: 'x', budget: 1e12 }).budget_cents).toBeNull();
  });
});

describe('partView: live state in plain words', () => {
  const brief = { date: '2026-10-24', place: 'Soweto' };
  it('People request states', () => {
    const base = { kind: 'people_request' as const, itemId: 'i1', found: true as const, requestId: MY_REQ, roleName: 'Photographer or videographer', roleSlug: 'photographer-videographer', dates: ['2026-10-24'], totalCents: 180_000 };
    expect(partView({ ...base, status: 'requested' }, PLAN).line).toBe('Photographer or videographer (Saturday 24 October 2026): waiting for their reply');
    expect(partView({ ...base, status: 'accepted' }, PLAN).next?.label).toBe('Pay to confirm');
    expect(partView({ ...base, status: 'confirmed' }, PLAN)).toMatchObject({ tone: 'done', line: expect.stringContaining('booked, paid') });
    const declined = partView({ ...base, status: 'declined' }, PLAN);
    expect(declined.next?.href).toBe(`/people?role=photographer-videographer&plan=${PLAN}`);
  });
  it('gear orders: paid, held, done', () => {
    const g = { kind: 'gear_order' as const, itemId: 'i2', found: true as const, titles: ['Aputure 300d', 'Light stand'], startDate: '2026-10-24', endDate: '2026-10-25', amountCents: 90_000, firstBookingId: 'b1' };
    expect(partView({ ...g, statuses: ['confirmed', 'confirmed'] }, PLAN).line).toBe('Aputure 300d and 1 more: booked, paid');
    expect(partView({ ...g, statuses: ['pending', 'pending'] }, PLAN)).toMatchObject({ line: 'Aputure 300d and 1 more: held, waiting for payment', next: { label: 'Pay for it', href: '/dashboard/bookings/b1' } });
    expect(partView({ ...g, statuses: ['expired'] }, PLAN).tone).toBe('blocked');
  });
  it('needs: not asked, coming soon, not offered, now bookable', () => {
    const v = partView({ kind: 'need', itemId: NEED, need: personNeed, roleStatus: 'live', roleName: 'Photographer or videographer', rental: null }, PLAN, brief);
    expect(v.line).toBe('Photographer or videographer: not asked yet');
    expect(v.next?.href).toBe(`/people?role=photographer-videographer&plan=${PLAN}&need=${NEED}`);
    const chosen = partView({ kind: 'need', itemId: NEED, need: { ...personNeed, person_role_id: OTHER_REQ }, roleStatus: 'live', roleName: null, rental: null }, PLAN, brief);
    expect(chosen.next).toEqual({ label: 'Request this person', href: `/people/${OTHER_REQ}/request?date=2026-10-24&area=Soweto&plan=${PLAN}&need=${NEED}` });
    expect(partView({ kind: 'need', itemId: 'n2', need: editorNeed, roleStatus: 'coming_soon', roleName: 'Editor', rental: null }, PLAN).line).toBe('Editor: coming soon, we keep it on your plan');
    expect(partView({ kind: 'need', itemId: 'n3', need: cateringNeed, roleStatus: null, roleName: null, rental: null }, PLAN).line).toBe('Catering: we do not offer this');
    expect(partView({ kind: 'need', itemId: 'n2', need: editorNeed, roleStatus: 'live', roleName: 'Editor', rental: null }, PLAN).line).toBe('Editor: now bookable');
  });
  it('a reference that is gone (or no longer theirs) shows no data', () => {
    const v = partView({ kind: 'people_request', itemId: 'x', found: false } as LivePart, PLAN);
    expect(v).toMatchObject({ line: 'We cannot find this part any more', next: null, tone: 'blocked' });
  });
  it('the next action is the first open part', () => {
    const views = [
      partView({ kind: 'need', itemId: 'n3', need: cateringNeed, roleStatus: null, roleName: null, rental: null }, PLAN),
      partView({ kind: 'need', itemId: NEED, need: personNeed, roleStatus: 'live', roleName: null, rental: null }, PLAN),
    ];
    expect(planNextAction(views)?.label).toBe('Find a photographer or videographer');
  });
});

describe('plan links and stored shapes', () => {
  it('parsePlanLink keeps only real ids', () => {
    expect(parsePlanLink({ plan: PLAN, need: NEED })).toEqual({ planId: PLAN, needItemId: NEED });
    expect(parsePlanLink({ plan: 'drop table', need: NEED })).toEqual({ planId: null, needItemId: null });
    expect(parsePlanLink({ plan: PLAN, need: 'x' })).toEqual({ planId: PLAN, needItemId: null });
  });
  it('validateNeed drops unknown fields and refuses a person without a role', () => {
    expect(validateNeed({ type: 'person', status: 'to_book', label: 'Videographer', role_slug: 'photographer-videographer', user_id: 'u1', display_name: 'Thandi' })).toEqual({ type: 'person', status: 'to_book', label: 'Videographer', role_slug: 'photographer-videographer' });
    expect(validateNeed({ type: 'person', status: 'to_book', label: 'Videographer' })).toBeNull();
    expect(validateNeed({ type: 'boss', status: 'to_book', label: 'x' })).toBeNull();
  });
  it('validatePayload refuses a ref without a real id', () => {
    expect(validatePayload({ title: 'x', brief: {}, parts: [{ kind: 'people_request', ref_id: 'nope' }] })).toBeNull();
    expect(validatePayload({ title: 'x', brief: {}, parts: [person, lights] })?.parts).toHaveLength(2);
  });
});

// ── The service with a fake store ───────────────────────────────────────────

function fakeStore(over: Partial<ProjectStore> = {}): ProjectStore & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    flagOn: async () => true,
    ownsRef: async (client, _kind, id) => client === CLIENT && id === MY_REQ,
    refInPlan: async () => false,
    create: async (p) => {
      created.push(p);
      return PLAN;
    },
    link: async () => ({ ok: true, itemId: 'item-1' }),
    addNeed: async () => 'need-1',
    close: async () => true,
    ...over,
  };
}

const payload = (parts: PlanPart[]) => ({ title: 'Music video in Soweto', brief: { outcome: 'Music video' }, parts, source_conversation_id: null });

describe('createProject', () => {
  it('creates a plan with two or more parts', async () => {
    const store = fakeStore();
    expect(await createProject(store, { clientId: CLIENT, payload: payload([person, lights, editor]) })).toEqual({ ok: true, projectId: PLAN });
    expect(store.created).toHaveLength(1);
  });
  it('refuses a single part and writes nothing', async () => {
    const store = fakeStore();
    const r = await createProject(store, { clientId: CLIENT, payload: payload([person]) });
    expect(r).toMatchObject({ ok: false, code: 'single' });
    expect(store.created).toHaveLength(0);
  });
  it('refuses someone else\'s booking (ownership) and writes nothing', async () => {
    const store = fakeStore();
    const r = await createProject(store, { clientId: CLIENT, payload: payload([person, { kind: 'people_request', ref_id: OTHER_REQ, label: 'x' }]) });
    expect(r).toMatchObject({ ok: false, code: 'not_owner' });
    expect(store.created).toHaveLength(0);
  });
  it('refuses a booking already in another plan', async () => {
    const r = await createProject(fakeStore({ refInPlan: async () => true }), { clientId: CLIENT, payload: payload([person, { kind: 'people_request', ref_id: MY_REQ, label: 'x' }]) });
    expect(r).toMatchObject({ ok: false, code: 'other_plan' });
  });
  it('flag off: refused before anything else', async () => {
    const store = fakeStore({ flagOn: async () => false, ownsRef: async () => { throw new Error('must not be called'); } });
    expect(await createProject(store, { clientId: CLIENT, payload: payload([person, lights]) })).toMatchObject({ ok: false, code: 'off' });
  });
  it('fails closed when the ownership check cannot run', async () => {
    const store = fakeStore({ ownsRef: async () => { throw new Error('db down'); } });
    const r = await createProject(store, { clientId: CLIENT, payload: payload([person, { kind: 'people_request', ref_id: MY_REQ, label: 'x' }]) });
    expect(r).toMatchObject({ ok: false, code: 'check_failed' });
    expect(store.created).toHaveLength(0);
  });
});

describe('addItem / recordNeed / closeProject', () => {
  it('adds the client\'s own request', async () => {
    expect(await addItem(fakeStore(), { clientId: CLIENT, projectId: PLAN, kind: 'people_request', refId: MY_REQ, replacesNeedId: NEED })).toEqual({ ok: true, itemId: 'item-1' });
  });
  it('refuses someone else\'s request before touching the plan', async () => {
    const store = fakeStore({ link: async () => { throw new Error('must not be called'); } });
    expect(await addItem(store, { clientId: CLIENT, projectId: PLAN, kind: 'people_request', refId: OTHER_REQ })).toMatchObject({ ok: false, code: 'not_owner' });
  });
  it('refuses a kind that is not a reference, and bad ids', async () => {
    expect(await addItem(fakeStore(), { clientId: CLIENT, projectId: PLAN, kind: 'need', refId: MY_REQ })).toMatchObject({ code: 'bad_request' });
    expect(await addItem(fakeStore(), { clientId: CLIENT, projectId: 'x', kind: 'people_request', refId: MY_REQ })).toMatchObject({ code: 'bad_request' });
  });
  it('maps "already in another plan"', async () => {
    expect(await addItem(fakeStore({ link: async () => ({ ok: false, code: 'other_plan' }) }), { clientId: CLIENT, projectId: PLAN, kind: 'people_request', refId: MY_REQ })).toMatchObject({ code: 'other_plan' });
  });
  it('records a need and closes, both behind the flag', async () => {
    expect(await recordNeed(fakeStore(), { clientId: CLIENT, projectId: PLAN, need: { type: 'unsupported', status: 'coming_soon', label: 'Editor' } })).toEqual({ ok: true, itemId: 'need-1' });
    expect(await closeProject(fakeStore(), { clientId: CLIENT, projectId: PLAN })).toEqual({ ok: true });
    expect(await closeProject(fakeStore({ flagOn: async () => false }), { clientId: CLIENT, projectId: PLAN })).toMatchObject({ code: 'off' });
    expect(await addItem(fakeStore({ flagOn: async () => false }), { clientId: CLIENT, projectId: PLAN, kind: 'people_request', refId: MY_REQ })).toMatchObject({ code: 'off' });
  });
});
