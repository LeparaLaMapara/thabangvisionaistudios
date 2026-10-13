/**
 * Crew request payments through Paystack (customStr1 'crew_request' or
 * 'crew_request_deposit') used to fall through handlePaymentComplete with no
 * branch, so a paid request never became paid. Now it is applied, with the
 * amount, currency, creator and state checks the PayFast handler lacks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookResult } from '@/lib/payments/types';
import { crewPaymentReference } from '@/lib/payments/crew-reference';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const failures = new Map<string, { message: string }>();

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row | Row[] = {};
  const filters: ((r: Row) => boolean)[] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const run = () => {
    const fail = failures.get(`${table}:${op}`);
    if (fail) {
      failures.delete(`${table}:${op}`);
      return { data: null, error: fail };
    }
    if (op === 'insert') {
      const list = Array.isArray(values) ? values : [values];
      rows().push(...list.map((v) => ({ ...v })));
      return { data: list, error: null };
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)));
    if (op === 'update') hit.forEach((r) => Object.assign(r, values));
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (v: Row) => { op = 'update'; values = v; return b; },
    insert: (v: Row | Row[]) => { op = 'insert'; values = v; return b; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [], sendGearNotice: async () => undefined }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));

const { handlePaymentComplete, confirmCrewRequestPayment } = await import('@/lib/payments/fulfil');

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const CREATOR = 'c0000000-0000-0000-0000-000000000001';

const hook = (o: { amount?: number; kind?: 'crew_request' | 'crew_request_deposit'; currency?: string; creator?: string; ref?: string } = {}): WebhookResult => {
  const kind = o.kind ?? 'crew_request';
  const raw: Record<string, string> = { custom_str1: kind, currency: o.currency ?? 'ZAR' };
  if (kind === 'crew_request') { raw.custom_str2 = 'client-1'; raw.custom_str3 = o.creator ?? CREATOR; } else raw.custom_str2 = o.creator ?? CREATOR;
  return {
    valid: true, status: 'COMPLETE', providerPaymentId: '555',
    paymentId: o.ref ?? crewPaymentReference(ID, kind === 'crew_request' ? 'full' : 'deposit'),
    amountGross: o.amount ?? 2000, raw,
  };
};

beforeEach(() => {
  failures.clear();
  tables.notifications = [];
  tables.crew_requests = [{ id: ID, status: 'confirmed', total_amount: 2000, deposit_amount: 400, creator_id: CREATOR, payment_id: null, commission_amount: null }];
});
const row = () => tables.crew_requests[0];

describe('crew request payments (Paystack path)', () => {
  it('a full payment for the exact amount marks the request paid, via handlePaymentComplete', async () => {
    await handlePaymentComplete(hook());
    expect(row()).toMatchObject({ status: 'paid', payment_id: '555' });
    expect(typeof row().commission_amount).toBe('number');
    expect(tables.notifications).toHaveLength(1);
  });
  it('a deposit is checked against deposit_amount', async () => {
    expect(await confirmCrewRequestPayment(hook({ kind: 'crew_request_deposit', amount: 400 }))).toBe('paid');
    expect(row().status).toBe('paid');
  });
  it('an old bare-id reference still works', async () => {
    expect(await confirmCrewRequestPayment(hook({ ref: ID }))).toBe('paid');
  });
  it('the wrong amount, currency or creator changes nothing', async () => {
    expect(await confirmCrewRequestPayment(hook({ amount: 1 }))).toBe('rejected');
    expect(await confirmCrewRequestPayment(hook({ kind: 'crew_request_deposit', amount: 2000 }))).toBe('rejected');
    expect(await confirmCrewRequestPayment(hook({ currency: 'NGN' }))).toBe('rejected');
    expect(await confirmCrewRequestPayment(hook({ creator: 'someone-else' }))).toBe('rejected');
    expect(row().status).toBe('confirmed');
  });
  it('a repeat is a no-op, and a cancelled request is never revived', async () => {
    expect(await confirmCrewRequestPayment(hook())).toBe('paid');
    expect(await confirmCrewRequestPayment(hook())).toBe('already_paid');
    row().status = 'cancelled';
    expect(await confirmCrewRequestPayment(hook())).toBe('not_awaiting_payment');
    expect(row().status).toBe('cancelled');
  });
  it('an unknown or foreign reference is rejected', async () => {
    expect(await confirmCrewRequestPayment(hook({ ref: 'BK-abc' }))).toBe('rejected');
    expect(await confirmCrewRequestPayment(hook({ ref: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.f1' }))).toBe('rejected');
  });
  it('a database error throws so the event is retried', async () => {
    failures.set('crew_requests:update', { message: 'down' });
    await expect(confirmCrewRequestPayment(hook())).rejects.toThrow();
    failures.set('crew_requests:select', { message: 'down' });
    await expect(confirmCrewRequestPayment(hook())).rejects.toThrow();
  });
});
