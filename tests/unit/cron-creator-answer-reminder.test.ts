import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { formatSastDateTime } from '@/lib/bookings/answer-by';

// Daily maintenance, steps 7 and 7b: a paid job is passed on once the answer
// window after PAYMENT has gone by (it used to count from created_at, so a
// booking paid late could be taken away at once), and on the run before
// that the creator gets one reminder, by email and in the app.

type Row = Record<string, unknown>;
type Filter = [kind: 'eq' | 'is' | 'neq' | 'in' | 'lt' | 'gte', key: string, value: unknown];
const tables: Record<string, Row[]> = {};
/** Tables whose reads fail, to test that a step holds back. */
const failingTables = new Set<string>();

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let values: Row = {};
  const filters: Filter[] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row): boolean => filters.every(([kind, k, v]) => {
    if (kind === 'eq') return r[k] === v;
    if (kind === 'neq') return r[k] !== v;
    if (kind === 'is') return (r[k] ?? null) === v;
    // Time filters on ISO strings, applied only to bookings (as a database
    // would), so a read that filters on the wrong column misses rows here too.
    if (kind === 'lt') return table !== 'bookings' || (typeof r[k] === 'string' && (r[k] as string) < (v as string));
    if (kind === 'gte') return table !== 'bookings' || (typeof r[k] === 'string' && (r[k] as string) >= (v as string));
    return (v as unknown[]).includes(r[k]);
  });
  const run = () => {
    if (op === 'select' && failingTables.has(table)) return { data: null, error: { message: 'connection reset' }, count: 0 };
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
    lt: (k: string, v: unknown) => { filters.push(['lt', k, v]); return b; },
    gte: (k: string, v: unknown) => { filters.push(['gte', k, v]); return b; },
    lte: chain, gt: chain, not: chain, or: chain, order: chain, limit: chain, range: chain, contains: chain, ilike: chain, like: chain, filter: chain, match: chain,
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
  failingTables.clear();
  sendEmail.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** An admin gave the booking to its current creator `h` hours ago. */
const assigned = (bookingId: string, h: number): Row => ({
  booking_id: bookingId, event: 'admin_assign', from_status: 'pending_reassignment', to_status: 'paid',
  actor: 'admin', actor_id: 'admin-1', created_at: hoursAgo(h),
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

describe('daily maintenance: a creator an admin assigned gets the full window from the assignment', () => {
  it('paid 60 hours ago, assigned 10 hours ago: NOT passed on, and no reminder yet', async () => {
    tables.bookings = [booking('swap', { created_at: hoursAgo(62), paid_at: hoursAgo(60) })];
    tables.service_booking_events = [assigned('swap', 10)];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-swap' });
    expect(reminderMails()).toHaveLength(0);
  });

  it('only the latest assignment counts: an older one does not shorten the window', async () => {
    tables.bookings = [booking('twice', { created_at: hoursAgo(120), paid_at: hoursAgo(118) })];
    tables.service_booking_events = [assigned('twice', 100), assigned('twice', 5)];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-twice' });
  });

  it('assigned 30 hours ago: reminded, with the deadline counted from the assignment', async () => {
    tables.bookings = [booking('due', { created_at: hoursAgo(80), paid_at: hoursAgo(78) })];
    tables.service_booking_events = [assigned('due', 30)];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-due' });
    expect(reminderMails()).toHaveLength(1);
    const due = formatSastDateTime(new Date(NOW.getTime() + (STUDIO.booking.creatorAnswerHours - 30) * 3_600_000));
    expect(reminderMails()[0][0].text).toContain(due);
    expect(String(reminderNotices()[0].body)).toContain(due);
  });

  it('assigned 50 hours ago with no answer: passed on', async () => {
    tables.bookings = [booking('gone', { created_at: hoursAgo(90), paid_at: hoursAgo(88) })];
    tables.service_booking_events = [assigned('gone', 50)];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'pending_reassignment', creator_id: null });
    const adminMail = sendEmail.mock.calls.find((c) => /Creator unresponsive/.test(c[0].subject));
    expect(adminMail?.[0].text).toMatch(/hours of being assigned/);
  });

  it('when the assignment times cannot be read, nobody is passed on and no reminder is sent', async () => {
    tables.bookings = [
      booking('old', { created_at: hoursAgo(52), paid_at: hoursAgo(50) }),
      booking('soon', { created_at: hoursAgo(30), paid_at: hoursAgo(30) }),
    ];
    failingTables.add('service_booking_events');
    const res = await runCron();
    const body = await res.json();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-old' });
    expect(reminderMails()).toHaveLength(0);
    expect(JSON.stringify(body)).toMatch(/assignment times unreadable/);
  });
});

describe('daily maintenance: reminder for a late payer', () => {
  it('a booking made 100 hours ago but paid 30 hours ago still gets its reminder', async () => {
    tables.bookings = [booking('late', { created_at: hoursAgo(100), paid_at: hoursAgo(30) })];
    await runCron();
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', creator_id: 'creator-late' });
    expect(reminderMails()).toHaveLength(1);
    expect(reminderNotices()[0]).toMatchObject({ link: '/dashboard/gigs#gig-late' });
  });

  it('the reminder link uses the cleaned app URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ' https://app.example.invalid/\n');
    tables.bookings = [booking('soon', { created_at: hoursAgo(30), paid_at: hoursAgo(30) })];
    await runCron();
    expect(reminderMails()[0][0].text).toContain('Answer here: https://app.example.invalid/dashboard/gigs');
  });
});
