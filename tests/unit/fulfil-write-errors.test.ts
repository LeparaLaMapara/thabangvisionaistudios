/**
 * Audit 2026-10-13: lib/payments/fulfil.ts ignored write errors. A failed
 * confirm or payment-record write left a paid order pending with nothing but
 * a log line, and the provider was told all was well (no retry). Now a failed
 * write throws (the webhook answers 500 and the provider retries), and a retry
 * of a payment already applied finishes the payment records.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookResult } from '@/lib/payments/types';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
/** `${table}:${op}` -> error to return (each entry is used once). */
const failures = new Map<string, { message: string; code?: string }>();

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let values: Row | Row[] = {};
  const filters: ((r: Row) => boolean)[] = [];
  const rows = (): Row[] => (tables[table] ??= []);
  const match = (r: Row) => filters.every((f) => f(r));
  const run = () => {
    const key = `${table}:${op}`;
    const fail = failures.get(key);
    if (fail) {
      failures.delete(key);
      return { data: null, error: fail };
    }
    if (op === 'insert') {
      const list = Array.isArray(values) ? values : [values];
      rows().push(...list.map((v) => ({ ...v })));
      return { data: list, error: null };
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

const { handlePaymentComplete, confirmSubscriptionPayment } = await import('@/lib/payments/fulfil');

const GROUP = 'g0000000-0000-0000-0000-000000000001';
const cartHook = (amountGross = 300): WebhookResult => ({
  valid: true, status: 'COMPLETE', providerPaymentId: 'yc_1', paymentId: GROUP, amountGross,
  raw: { custom_str1: 'cart_checkout', custom_str2: 'user-1', currency: 'ZAR' },
}) as WebhookResult;
const gearHook = (amountGross = 500): WebhookResult => ({
  valid: true, status: 'COMPLETE', providerPaymentId: 'yc_2', paymentId: 'eb-1', amountGross,
  raw: { custom_str1: 'equipment_booking', currency: 'ZAR' },
}) as WebhookResult;

function seedCart(): void {
  tables.equipment_bookings = [
    { id: 'l1', checkout_group_id: GROUP, user_id: 'user-1', status: 'pending', total_price: 100, payfast_payment_id: null },
    { id: 'l2', checkout_group_id: GROUP, user_id: 'user-1', status: 'pending', total_price: 200, payfast_payment_id: null },
  ];
  tables.booking_payments = [
    { booking_id: 'l1', amount: 100, status: 'pending' },
    { booking_id: 'l2', amount: 200, status: 'pending' },
  ];
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  failures.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('cart checkout confirmation', () => {
  it('confirms the lines and closes every payment line in one write', async () => {
    seedCart();
    await handlePaymentComplete(cartHook());
    expect(tables.equipment_bookings.every((b) => b.status === 'confirmed')).toBe(true);
    expect(tables.booking_payments.every((p) => p.status === 'succeeded' && p.payfast_payment_id === 'yc_1')).toBe(true);
  });

  it('throws (provider retries) when the confirm write fails, instead of leaving a paid order pending quietly', async () => {
    seedCart();
    failures.set('equipment_bookings:update', { message: 'deadlock' });
    await expect(handlePaymentComplete(cartHook())).rejects.toThrow();
    // The retry confirms it.
    await handlePaymentComplete(cartHook());
    expect(tables.equipment_bookings.every((b) => b.status === 'confirmed')).toBe(true);
  });

  it('throws when the payment lines are not closed, and the retry finishes them', async () => {
    seedCart();
    failures.set('booking_payments:update', { message: 'timeout' });
    await expect(handlePaymentComplete(cartHook())).rejects.toThrow();
    expect(tables.equipment_bookings.every((b) => b.status === 'confirmed')).toBe(true);
    expect(tables.booking_payments.every((p) => p.status === 'pending')).toBe(true);

    await handlePaymentComplete(cartHook());
    expect(tables.booking_payments.every((p) => p.status === 'succeeded')).toBe(true);
  });

  it('a read error is retried, never treated as "no bookings"', async () => {
    seedCart();
    failures.set('equipment_bookings:select', { message: 'connection reset' });
    await expect(handlePaymentComplete(cartHook())).rejects.toThrow();
  });

  it('a mismatch whose review note cannot be written is retried', async () => {
    seedCart();
    failures.set('equipment_bookings:update', { message: 'timeout' });
    await expect(handlePaymentComplete(cartHook(1))).rejects.toThrow();
    await handlePaymentComplete(cartHook(1));
    expect(tables.equipment_bookings.every((b) => b.status === 'pending' && String(b.notes).includes('AMOUNT MISMATCH'))).toBe(true);
  });
});

describe('single gear booking (retired payment type, security re-check M4)', () => {
  beforeEach(() => {
    tables.equipment_bookings = [{ id: 'eb-1', status: 'pending', total_price: 500, payfast_payment_id: null }];
    tables.booking_payments = [];
  });

  it('never confirms a booking from a payer-made equipment_booking charge, even at the hire price', async () => {
    await expect(handlePaymentComplete(gearHook())).resolves.toBeUndefined();
    expect(tables.equipment_bookings[0].status).toBe('pending');
    expect(tables.booking_payments).toHaveLength(0);
  });
});

describe('subscription activation', () => {
  it('a database error is retried, not reported as a rejection', async () => {
    tables.subscriptions = [];
    failures.set('subscriptions:select', { message: 'connection reset' });
    await expect(confirmSubscriptionPayment({
      valid: true, status: 'COMPLETE', providerPaymentId: 'ps_1', paymentId: 'sub_ref', amountGross: 299,
      raw: { custom_str1: 'subscription', currency: 'ZAR' },
    } as WebhookResult)).rejects.toThrow();
  });
});
