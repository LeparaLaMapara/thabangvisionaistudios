import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Daily maintenance, steps 7 and 7b: a paid job is passed on once the answer
// window after PAYMENT has gone by (it used to count from created_at, so a
// booking paid late could be taken away at once), and on the run before
// that the creator gets one reminder, by email and in the app.

type Row = Record<string, unknown>;
type Filter = [kind: 'eq' | 'is' | 'neq' | 'in', key: string, value: unknown];
const tables: Record<string, Row[]> = {};

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
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit.map((r) => ({ id: r.id })), error: null, count: hit.length };
    }
    const data = hit.map((r) => ({ ...r }));
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
    // Range filters are not applied here: the route re-checks times in code.
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
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@example.invalid` } } }) } },
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

const NOW = new Date('2026-10-12T00:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function booking(id: string, over: Row): Row {
  return {
    id, reference: `BK-${id}`, status: 'paid', payment_status: 'paid', accepted_at: null, creator_id: `creator-${id}`,
    client_email: 'client@example.invalid', project_category: 'Portrait Photography', creator_amount: 2550,
    duration_hours: 3, shoot_date: '2026-10-20', location: 'Soweto', ...over,
  };
}

const reminderMails = () => sendEmail.mock.calls.filter((c) => /^Reminder: answer your paid job/.test(c[0].subject));
const reminderNotices = () => (tables.notifications ?? []).filter((n) => n.title === 'Answer your paid job');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const k of Object.keys(tables)) delete tables[k];
  tables.notifications = [];
  sendEmail.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('daily maintenance: answer window counted from payment', () => {
  it('a booking made 60 hours ago but paid 10 hours ago is NOT passed on', async () => {
    tables.bookings = [booking('late', { created_at: hoursAgo(60), paid_at: hoursAgo(10) })];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-late' });
  });

  it('a booking paid 50 hours ago with no answer IS passed on', async () => {
    tables.bookings = [booking('old', { created_at: hoursAgo(52), paid_at: hoursAgo(50) })];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'pending_reassignment', creator_id: null });
  });
});

describe('daily maintenance: answer reminder', () => {
  it('reminds once on the last run before the deadline, by email and in the app', async () => {
    tables.bookings = [booking('soon', { created_at: hoursAgo(30), paid_at: hoursAgo(30) })];
    await runCron();
    expect(reminderMails()).toHaveLength(1);
    const mail = reminderMails()[0][0];
    expect(mail.to).toBe('creator-soon@example.invalid');
    expect(mail.text).toMatch(/You earn: R2.550/);
    expect(mail.text).toMatch(/\/dashboard\/gigs/);
    expect(reminderNotices()).toHaveLength(1);
    expect(reminderNotices()[0]).toMatchObject({ user_id: 'creator-soon', type: 'gig_request' });

    // A second run (manual rerun) does not send it again.
    await runCron();
    expect(reminderMails()).toHaveLength(1);
    expect(reminderNotices()).toHaveLength(1);
  });

  it('no reminder while there is more than a day left, or once answered', async () => {
    tables.bookings = [
      booking('fresh', { created_at: hoursAgo(5), paid_at: hoursAgo(5) }),
      booking('answered', { created_at: hoursAgo(30), paid_at: hoursAgo(30), status: 'accepted', accepted_at: hoursAgo(2) }),
    ];
    await runCron();
    expect(reminderMails()).toHaveLength(0);
    expect(reminderNotices()).toHaveLength(0);
  });
});
