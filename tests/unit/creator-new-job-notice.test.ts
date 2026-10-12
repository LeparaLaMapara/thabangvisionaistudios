/**
 * A creator's new paid job: the in-app alert quoted the CLIENT total
 * (bookings.total) while the job card showed the creator's earnings, and no
 * email was sent, so a creator who was not on the site lost the job when the
 * answer window closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookResult } from '@/lib/payments/types';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const sendEmail = vi.fn<(m: { to: string; subject: string; text: string }) => Promise<void>>(async () => undefined);

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row = {};
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === 'insert') { rows().push({ ...values }); return { data: [values], error: null }; }
    if (op === 'update') {
      const hit = rows().filter(match);
      hit.forEach((r) => Object.assign(r, values));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return { data: rows().filter(match).map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: id === 'creator-1' ? { email: 'creator@example.invalid' } : null } }) } },
  }),
}));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));
vi.mock('@/lib/email', () => ({ email: { sendEmail } }));

const { confirmServiceBookingPayment } = await import('@/lib/payments/fulfil');

const ID = 'b0000000-0000-0000-0000-000000000009';
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  sendEmail.mockClear();
  tables.bookings = [{
    id: ID, reference: 'BK-NEWJOB01', status: 'pending', payment_status: 'unpaid', total: 3450, creator_amount: 2550,
    creator_id: 'creator-1', client_id: 'client-1', project_category: 'Portrait Photography', duration_hours: 3,
    shoot_date: '2026-10-18', location: 'Soweto', created_at: '2026-10-10T08:00:00Z',
  }];
});
const hook = (): WebhookResult => ({
  valid: true, status: 'COMPLETE', providerPaymentId: 'ps_9', paymentId: 'BK-NEWJOB01', amountGross: 3450,
  raw: { custom_str1: 'service_booking', custom_str2: ID, currency: 'ZAR' },
}) as WebhookResult;

describe('new paid job: the creator is told what THEY earn, in the app and by email', () => {
  it('alert body quotes creator_amount, not the client total', async () => {
    expect(await confirmServiceBookingPayment(hook())).toBe('confirmed');
    const notice = (tables.notifications ?? []).find((n) => n.user_id === 'creator-1');
    expect(notice?.body).toContain('R2');
    expect(String(notice?.body)).toContain('550');
    expect(String(notice?.body)).not.toContain('3450');
    expect(String(notice?.body)).not.toContain('3 450');
  });

  it('emails the creator with earnings, shoot date, answer-by and a link', async () => {
    await confirmServiceBookingPayment(hook());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('creator@example.invalid');
    expect(mail.text).toMatch(/You earn: R2.550/);
    expect(mail.text).toMatch(/Shoot date: Sunday,? 18 October 2026/);
    expect(mail.text).toMatch(/accept or decline by/i);
    expect(mail.text).toMatch(/\/dashboard\/gigs/);
  });

  it('a duplicate webhook sends nothing again', async () => {
    await confirmServiceBookingPayment(hook());
    sendEmail.mockClear();
    expect(await confirmServiceBookingPayment(hook())).toBe('already_paid');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
