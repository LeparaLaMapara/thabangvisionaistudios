/**
 * Phase 6 security MONEY-1 / MONEY-2: a verified service-booking payment
 * webhook confirmed the booking by reference alone. R1 confirmed an R5 000
 * booking, and a late charge revived a cancelled + refunded booking.
 * The branch must check amount (cents) and currency like its siblings and
 * only move pending/unpaid -> paid (compare-and-set).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookResult } from '@/lib/payments/types';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const events: Array<{ eventType: string }> = [];

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row = {};
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === 'insert') {
      rows().push({ ...values });
      return { data: [values], error: null };
    }
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
    single: async () => { const r = run(); return r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: 'not one row' } }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/data/events', () => ({ logEvent: (e: { eventType: string }) => events.push(e) }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));

const { handlePaymentComplete, confirmServiceBookingPayment } = await import('@/lib/payments/fulfil');

const ID = 'b0000000-0000-0000-0000-000000000001';
function seed(over: Row = {}): void {
  for (const k of Object.keys(tables)) delete tables[k];
  events.length = 0;
  tables.bookings = [{
    id: ID, reference: 'BK-SEC6AMT01', status: 'pending', payment_status: 'unpaid', total: 5000,
    creator_id: 'creator-1', client_id: 'client-1', project_category: 'Photography', duration_hours: 4, ...over,
  }];
}
const hook = (amountGross: number, raw: Record<string, string> = {}): WebhookResult => ({
  valid: true, status: 'COMPLETE', providerPaymentId: 'ps_123', paymentId: 'BK-SEC6AMT01', amountGross,
  raw: { custom_str1: 'service_booking', custom_str2: ID, currency: 'ZAR', ...raw },
}) as WebhookResult;

describe('service booking payment confirmation (MONEY-1)', () => {
  beforeEach(() => seed());

  it('refuses R1 for an R5 000 booking: stays pending/unpaid, flagged, nobody notified', async () => {
    await handlePaymentComplete(hook(1));
    expect(tables.bookings[0]).toMatchObject({ status: 'pending', payment_status: 'unpaid' });
    expect(String(tables.bookings[0].admin_notes)).toMatch(/AMOUNT MISMATCH/);
    expect(tables.notifications ?? []).toHaveLength(0);
    expect(events.map((e) => e.eventType)).toContain('service_payment_rejected');
  });

  it('refuses an over-payment too (exact cents only)', async () => {
    expect(await confirmServiceBookingPayment(hook(5000.01))).toBe('rejected');
    expect(tables.bookings[0].payment_status).toBe('unpaid');
  });

  it('refuses the wrong currency', async () => {
    expect(await confirmServiceBookingPayment(hook(5000, { currency: 'USD' }))).toBe('rejected');
    expect(tables.bookings[0].status).toBe('pending');
  });

  it('refuses metadata pointing at another booking', async () => {
    expect(await confirmServiceBookingPayment(hook(5000, { custom_str2: 'someone-else' }))).toBe('rejected');
    expect(tables.bookings[0].status).toBe('pending');
  });

  it('an unknown reference changes nothing', async () => {
    tables.bookings[0].reference = 'BK-OTHER';
    expect(await confirmServiceBookingPayment(hook(5000))).toBe('rejected');
    expect(tables.bookings[0].status).toBe('pending');
  });

  it('confirms the exact amount once; a duplicate is a no-op', async () => {
    expect(await confirmServiceBookingPayment(hook(5000))).toBe('confirmed');
    expect(tables.bookings[0]).toMatchObject({ status: 'paid', payment_status: 'paid', paystack_reference: 'ps_123' });
    expect(tables.notifications).toHaveLength(2);
    expect(await confirmServiceBookingPayment(hook(5000))).toBe('already_paid');
    expect(tables.notifications).toHaveLength(2);
  });
});

describe('a payment never revives a cancelled or refunded booking (MONEY-2)', () => {
  it.each([
    { status: 'cancelled', payment_status: 'refunded' },
    { status: 'cancelled', payment_status: 'unpaid' },
    { status: 'declined', payment_status: 'refunded' },
  ])('%j stays as it was', async (state) => {
    seed({ ...state, total: 10000 });
    await handlePaymentComplete(hook(10000));
    expect(tables.bookings[0]).toMatchObject(state);
    expect(tables.notifications ?? []).toHaveLength(0);
    expect(events.map((e) => e.eventType)).toContain('service_payment_not_awaiting');
  });

  it('the attacker repro (R1 against a refunded R10 000 booking) changes nothing', async () => {
    seed({ status: 'cancelled', payment_status: 'refunded', total: 10000 });
    await handlePaymentComplete(hook(1));
    expect(tables.bookings[0]).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    expect(tables.bookings[0].admin_notes).toBeUndefined();
  });
});
