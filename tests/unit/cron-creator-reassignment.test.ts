import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The daily maintenance cron, step 7: unassign a creator who has not answered
// a paid request within 48 hours. It used to read status = 'paid' and then
// update by id alone, so a creator who accepted (or declined) in between was
// overwritten: the booking went to pending_reassignment with no creator, and
// the creator was told they had lost a gig they had just accepted.

type Row = Record<string, unknown>;
type Filter = [kind: 'eq' | 'is' | 'neq' | 'in', key: string, value: unknown];
interface Write { table: string; values: Row; filters: Filter[] }

const tables: Record<string, Row[]> = {};
const updates: Write[] = [];
/** Runs once right after the reassignment step reads its candidates. */
let afterCandidateRead: (() => void) | null = null;

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let values: Row = {};
  const filters: Filter[] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row): boolean => filters.every(([kind, k, v]) => {
    if (kind === 'eq') return r[k] === v;
    if (kind === 'neq') return r[k] !== v;
    if (kind === 'is') return (r[k] ?? null) === v;
    return (v as unknown[]).includes(r[k]);
  });
  const run = () => {
    if (op === 'insert') {
      rows().push({ ...values });
      return { data: [values], error: null, count: 1 };
    }
    const hit = rows().filter(match);
    if (op === 'update') {
      updates.push({ table, values, filters: [...filters] });
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit.map((r) => ({ id: r.id })), error: null, count: hit.length };
    }
    const data = hit.map((r) => ({ ...r }));
    // The reassignment step's read: status 'paid' and no accepted_at.
    if (table === 'bookings' && op === 'select' && afterCandidateRead && filters.some(([k, key]) => k === 'is' && key === 'accepted_at')) {
      const hook = afterCandidateRead;
      afterCandidateRead = null;
      hook();
    }
    return { data, error: null, count: data.length };
  };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    upsert: (v: Row) => { op = 'insert'; values = v; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return b; },
    neq: (k: string, v: unknown) => { filters.push(['neq', k, v]); return b; },
    is: (k: string, v: unknown) => { filters.push(['is', k, v]); return b; },
    in: (k: string, v: unknown[]) => { filters.push(['in', k, v]); return b; },
    // Range and text filters are not needed to pick the rows in these tests.
    lt: chain, lte: chain, gt: chain, gte: chain, not: chain, or: chain, order: chain, limit: chain, range: chain, contains: chain, ilike: chain, like: chain, filter: chain, match: chain,
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return b;
}

const db = {
  from: (t: string) => builder(t),
  rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
};

const sendEmail = vi.fn<(m: { to: string; subject: string; text: string }) => Promise<undefined>>(async () => undefined);

vi.mock('@/lib/cron/auth', () => ({ validateCronAuth: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => db, createClient: async () => db }));
vi.mock('@/lib/email', () => ({ email: { sendEmail } }));
vi.mock('@/lib/payments/payout', () => ({ runServicePayouts: async () => ({ considered: 0, notDue: 0, outcomes: {}, attention: [], held: [] }) }));
vi.mock('@/lib/supabase/queries/smartProductions', () => ({ autoPublishCreatorProductions: async () => 0 }));
vi.mock('@/lib/rental/availability-server', () => ({ effectiveHoldMinutes: async () => 30 }));
vi.mock('@/lib/bookings/notify-client', () => ({ notifyClient: async () => undefined }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));
vi.mock('@/lib/payments/eft', () => ({ paymentReference: () => 'REF' }));
vi.mock('@/lib/greetings/process', () => ({ autoSendWelcomes: async () => 0, draftMissingWelcomes: async () => 0 }));
vi.mock('@/lib/rental/workers', () => ({ runOverdueLadder: async () => ({}) }));

const { GET } = await import('@/app/api/cron/daily-maintenance/route');

const runCron = async () => GET(new NextRequest('http://localhost/api/cron/daily-maintenance'));

function seed(): void {
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0;
  tables.bookings = [{
    id: 'b-1', reference: 'BK-race', status: 'paid', payment_status: 'paid', accepted_at: null,
    creator_id: 'creator-1', client_email: 'client@example.invalid', project_category: 'Portrait Photography',
    created_at: '2026-01-01T00:00:00.000Z',
  }];
  tables.notifications = [];
}

const unresponsiveMails = () => sendEmail.mock.calls.filter((c) => /Creator unresponsive/.test(c[0].subject));
const unassignedNotices = () => (tables.notifications ?? []).filter((n) => n.type === 'gig_unassigned');

beforeEach(() => {
  sendEmail.mockClear();
  afterCandidateRead = null;
});

describe('daily maintenance: unresponsive creator reassignment', () => {
  it('unassigns a creator who still has not answered, and tells staff and the creator', async () => {
    seed();
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'pending_reassignment', creator_id: null });
    const write = updates.find((u) => u.table === 'bookings' && u.values.status === 'pending_reassignment');
    // Compare-and-set: only while still paid and unanswered.
    expect(write?.filters).toEqual(expect.arrayContaining([['eq', 'id', 'b-1'], ['eq', 'status', 'paid'], ['is', 'accepted_at', null]]));
    expect(unresponsiveMails()).toHaveLength(1);
    expect(unassignedNotices()).toHaveLength(1);
  });

  it('a creator who accepts between the read and the write keeps the booking; nobody is told otherwise', async () => {
    seed();
    afterCandidateRead = () => Object.assign(tables.bookings[0], { status: 'accepted', accepted_at: '2026-10-09T00:00:00.000Z' });
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'accepted', creator_id: 'creator-1' });
    expect(unresponsiveMails()).toHaveLength(0);
    expect(unassignedNotices()).toHaveLength(0);
  });

  it('a decline in between is not overwritten either', async () => {
    seed();
    afterCandidateRead = () => Object.assign(tables.bookings[0], { status: 'declined' });
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'declined', creator_id: 'creator-1' });
    expect(unresponsiveMails()).toHaveLength(0);
  });

  it('a creator an admin assigns between the read and the write keeps the job', async () => {
    seed();
    afterCandidateRead = () => Object.assign(tables.bookings[0], { creator_id: 'creator-2' });
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-2' });
    expect(unresponsiveMails()).toHaveLength(0);
    expect(unassignedNotices()).toHaveLength(0);
  });
});
