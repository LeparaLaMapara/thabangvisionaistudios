import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { answerByAt, formatSastDateTime, hoursLeftToAnswer, needsAnswerReminder } from '@/lib/bookings/answer-by';

// An admin gives a paid job to a creator (or swaps the creator). The answer
// window used to be counted from paid_at, so a creator assigned two days after
// payment was passed on at the next daily run, got no reminder, and the card
// said 0 hours left. The window now starts at the assignment, recorded as the
// 'admin_assign' row in service_booking_events.

const H = 60 * 60 * 1000;

describe('answer clock: assignment time', () => {
  const paidAt = '2026-10-08T10:00:00.000Z';
  const assignedAt = '2026-10-10T10:00:00.000Z';

  it('counts from the admin assignment when it is after payment', () => {
    const b = { created_at: paidAt, paid_at: paidAt, assigned_at: assignedAt };
    expect(answerByAt(b).getTime()).toBe(Date.parse(assignedAt) + STUDIO.booking.creatorAnswerHours * H);
  });

  it('a creator assigned an hour ago has nearly the full window, not 0 hours', () => {
    const now = new Date(Date.parse(assignedAt) + 1 * H);
    const b = { created_at: paidAt, paid_at: paidAt, assigned_at: assignedAt };
    expect(hoursLeftToAnswer(b, now)).toBe(STUDIO.booking.creatorAnswerHours - 1);
    expect(hoursLeftToAnswer({ created_at: paidAt, paid_at: paidAt }, now)).toBe(0);
  });

  it('reminds on the last run before the assignment deadline', () => {
    const b = { created_at: paidAt, paid_at: paidAt, assigned_at: assignedAt };
    const lastRun = new Date(Date.parse(assignedAt) + (STUDIO.booking.creatorAnswerHours - 10) * H);
    expect(needsAnswerReminder(b, lastRun)).toBe(true);
  });

  it('an assignment time before payment never shortens the window', () => {
    const b = { created_at: paidAt, paid_at: assignedAt, assigned_at: paidAt };
    expect(answerByAt(b).getTime()).toBe(Date.parse(assignedAt) + STUDIO.booking.creatorAnswerHours * H);
  });
});

// ── The admin route ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
/** Inserts into these tables fail. */
const failingInserts = new Set<string>();

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row = {};
  const filters: [string, unknown, 'eq' | 'is'][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v, kind]) => (kind === 'is' ? (r[k] ?? null) === v : r[k] === v));
  const run = () => {
    if (op === 'insert') {
      if (failingInserts.has(table)) return { data: null, error: { message: 'connection reset' } };
      rows().push({ ...values });
      return { data: [values], error: null };
    }
    const hit = rows().filter(match);
    if (op === 'update') hit.forEach((r) => Object.assign(r, values));
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v, 'eq']); return b; },
    is: (k: string, v: unknown) => { filters.push([k, v, 'is']); return b; },
    maybeSingle: async () => ({ data: (run().data as Row[])[0] ?? null, error: null }),
    single: async () => {
      const d = run().data as Row[];
      return d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: 'not one row' } };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

const client = { from: (t: string) => builder(t) };

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => client, createClient: async () => client }));
vi.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ error: null, user: { id: 'admin-1' } }),
  rateLimitAdmin: async () => null,
}));
vi.mock('@/lib/email', () => ({ email: { sendEmail: vi.fn(async () => undefined) } }));

const { PATCH } = await import('@/app/api/admin/service-bookings/[id]/route');

const ID = 'b-1';
const NEW_CREATOR = 'c0000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-10-12T08:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const k of Object.keys(tables)) delete tables[k];
  failingInserts.clear();
  tables.bookings = [{
    id: ID, reference: 'BK-assign', client_id: 'client-1', client_email: 'client@example.invalid', creator_id: null,
    project_category: 'Portrait Photography', status: 'pending_reassignment', total: 1000, payment_status: 'paid',
    payout_status: 'pending', paystack_reference: 'PAY-1', cancellation_refund_status: null,
    created_at: '2026-10-08T08:00:00.000Z', paid_at: '2026-10-08T09:00:00.000Z', accepted_at: null,
  }];
  tables.profiles = [{ id: NEW_CREATOR, verification_status: 'verified', is_suspended: false }];
});
afterEach(() => {
  vi.useRealTimers();
});

const assign = async () => {
  const res = await PATCH(
    new NextRequest(`http://localhost/api/admin/service-bookings/${ID}`, { method: 'PATCH', body: JSON.stringify({ creator_id: NEW_CREATOR }) }),
    { params: Promise.resolve({ id: ID }) },
  );
  return { status: res.status, json: (await res.json()) as Row };
};

describe('admin assigns a creator: the answer clock starts now', () => {
  it('records the admin_assign event and tells the creator the real deadline, linked to the card', async () => {
    const { status, json } = await assign();
    expect(status).toBe(200);
    expect(json.warning).toBeUndefined();
    expect(tables.bookings[0]).toMatchObject({ creator_id: NEW_CREATOR, status: 'paid', accepted_at: null });
    expect(tables.service_booking_events).toHaveLength(1);
    expect(tables.service_booking_events[0]).toMatchObject({ booking_id: ID, event: 'admin_assign', to_status: 'paid' });

    const notice = (tables.notifications ?? []).find((n) => n.user_id === NEW_CREATOR);
    const due = formatSastDateTime(new Date(NOW.getTime() + STUDIO.booking.creatorAnswerHours * H));
    expect(String(notice?.body)).toContain(due);
    expect(notice?.link).toBe(`/dashboard/gigs#gig-${ID}`);
  });

  it('warns the admin when the assignment time could not be recorded', async () => {
    failingInserts.add('service_booking_events');
    const { status, json } = await assign();
    expect(status).toBe(200);
    expect(String(json.warning)).toMatch(/answer time could not be recorded/);
  });
});

describe('reminder links land on a card', () => {
  it('each service gig card carries the gig-<id> anchor the reminders link to', () => {
    const src = readFileSync(join(process.cwd(), 'app/(platform)/dashboard/gigs/ServiceGigsList.tsx'), 'utf8');
    expect(src).toContain('id={`gig-${gig.id}`}');
  });
});
