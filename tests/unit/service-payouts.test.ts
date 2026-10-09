import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PayoutPort, ProviderCallResult, ProviderTransfer } from '@/lib/core/ports';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: vi.fn(async () => undefined) } }));

const { triggerCreatorPayout, runServicePayouts } = await import('@/lib/payments/payout');
const { servicePayoutReference } = await import('@/lib/core/services/payouts');

// ─── A small recording Supabase fake ─────────────────────────────────────────
// Rows live in memory; filters eq / is / in / neq are applied; every write is
// recorded so tests can assert exactly what was (and was not) written.

type Row = Record<string, unknown>;
interface Write { table: string; op: 'update' | 'insert'; values: Row; filters: [string, string, unknown][] }

function fakeDb(tables: Record<string, Row[]>, opts: { failDisputes?: boolean } = {}) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Row = {};
    let head = false;
    // limit / range slice the result like PostgREST does, so a queue that
    // reads only one page can be caught leaving rows behind.
    let window: [number, number] | null = null;
    const filters: [string, string, unknown][] = [];
    const rows = (): Row[] => (tables[table] ??= []);
    const match = (r: Row): boolean => filters.every(([kind, k, v]) => {
      if (kind === 'eq') return r[k] === v;
      if (kind === 'neq') return r[k] !== v;
      if (kind === 'is') return (r[k] ?? null) === v;
      if (kind === 'in') return (v as unknown[]).includes(r[k]);
      return true;
    });
    const run = () => {
      if (table === 'disputes' && opts.failDisputes) return { data: null, error: { message: 'boom' }, count: null };
      if (op === 'insert') {
        writes.push({ table, op, values, filters: [...filters] });
        rows().push({ ...values });
        return { data: [values], error: null, count: null };
      }
      const hit = rows().filter(match);
      if (op === 'update') {
        writes.push({ table, op, values, filters: [...filters] });
        hit.forEach((r) => Object.assign(r, values));
      }
      const page = window ? hit.slice(window[0], window[1] + 1) : hit;
      return { data: head ? null : page.map((r) => ({ ...r })), error: null, count: hit.length };
    };
    const b = {
      select: (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; },
      update: (v: Row) => { op = 'update'; values = v; return b; },
      insert: (v: Row) => { op = 'insert'; values = v; return b; },
      eq: (k: string, v: unknown) => { filters.push(['eq', k, v]); return b; },
      neq: (k: string, v: unknown) => { filters.push(['neq', k, v]); return b; },
      is: (k: string, v: unknown) => { filters.push(['is', k, v]); return b; },
      in: (k: string, v: unknown[]) => { filters.push(['in', k, v]); return b; },
      not: () => b,
      or: () => b,
      order: () => b,
      limit: (n: number) => { window = [0, n - 1]; return b; },
      range: (a: number, z: number) => { window = [a, z]; return b; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const db = { from, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'creator@example.invalid' } } }) } } };
  return { db: db as unknown as SupabaseClient, writes, tables };
}

const NOW = new Date('2026-10-09T10:00:00.000Z');
const H = 3_600_000;
const ID = '9b2f1c3e-0000-4000-8000-000000000001';
const STABLE = 'tvsp_9b2f1c3e000040008000000000000001';

function booking(over: Row = {}): Row {
  return {
    id: ID,
    reference: 'BK-test',
    paystack_reference: 'BK-test',
    status: 'completed',
    payment_status: 'paid',
    payout_status: 'pending',
    payout_reference: null,
    payout_retry_count: 0,
    creator_id: 'creator-1',
    creator_amount: 2550,
    total: 3000,
    project_category: 'Portrait Photography',
    completed_at: new Date(NOW.getTime() - 73 * H).toISOString(),
    updated_at: '2026-10-06T09:00:00.000Z',
    payout_due_at: new Date(NOW.getTime() - H).toISOString(),
    payout_claimed_at: null,
    ...over,
  };
}

function world(over: Row = {}, more: { disputes?: Row[]; bank?: Row; profile?: Row; failDisputes?: boolean } = {}) {
  return fakeDb(
    {
      bookings: [booking(over)],
      profiles: [{ id: 'creator-1', verification_status: 'verified', ...more.profile }],
      banking_details: [{ user_id: 'creator-1', is_verified: true, paystack_recipient_code: 'RCP_1', account_holder: 'T Creator', ...more.bank }],
      disputes: more.disputes ?? [],
      notifications: [],
      service_booking_events: [],
    },
    { failDisputes: more.failDisputes },
  );
}

function port(lookup: ProviderCallResult<ProviderTransfer | null>, send: ProviderCallResult<ProviderTransfer> = { ok: true, value: { transferCode: 'TRF_1', status: 'pending', amountCents: 255_000 } }) {
  const transfer = vi.fn(async () => send);
  const verifyTransfer = vi.fn(async () => lookup);
  const p: PayoutPort = {
    provider: 'fake',
    capabilities: { bankTransfers: true, instantTransfers: false, transferVerification: true, currencies: ['ZAR'], countries: ['ZA'] },
    transfer,
    verifyTransfer,
  };
  return { p, transfer, verifyTransfer };
}

const confirmed = vi.fn(async () => ({ success: true, amount: 3000 }));

beforeEach(() => {
  confirmed.mockClear();
});

describe('creator payout: sent once due, under one stable reference, through the payout port', () => {
  it('sends a due, eligible payout under tvsp_<booking id> in cents', async () => {
    const w = world();
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID, creatorAmount: 999_999 }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r).toMatchObject({ success: true, outcome: 'sent', payoutReference: STABLE });
    expect(servicePayoutReference(ID)).toBe(STABLE);
    // The caller's amount is ignored; the booking's is used.
    expect(t.transfer).toHaveBeenCalledWith(expect.objectContaining({ reference: STABLE, amountCents: 255_000, recipientCode: 'RCP_1' }));
    // Nothing was sent before, so nothing was looked up.
    expect(t.verifyTransfer).not.toHaveBeenCalled();
    const claim = w.writes.find((x) => x.table === 'bookings' && x.values.payout_status === 'processing');
    expect(claim?.values).toMatchObject({ payout_reference: STABLE });
    expect(claim?.filters).toEqual(expect.arrayContaining([['eq', 'payout_status', 'pending'], ['is', 'payout_reference', null]]));
  });

  it('holds a payout that is not due yet, without asking the provider anything', async () => {
    const w = world({ payout_due_at: new Date(NOW.getTime() + H).toISOString() });
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r).toMatchObject({ success: false, outcome: 'blocked', reasons: ['not_due_yet'] });
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('holds while a dispute is open, and when disputes cannot be checked (fail closed)', async () => {
    for (const w of [world({}, { disputes: [{ id: 'd1', booking_id: ID, status: 'investigating' }] }), world({}, { failDisputes: true })]) {
      const t = port({ ok: true, value: null });
      const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
      expect(r.outcome).toBe('blocked');
      expect(r.reasons?.some((x) => x === 'open_dispute' || x === 'dispute_check_failed')).toBe(true);
      expect(t.transfer).not.toHaveBeenCalled();
    }
  });

  it('a resolved dispute does not hold it', async () => {
    const w = world({}, { disputes: [{ id: 'd1', booking_id: ID, status: 'resolved' }] });
    const t = port({ ok: true, value: null });
    expect((await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW })).outcome).toBe('sent');
  });

  it('holds without a validated bank account or a verified creator', async () => {
    for (const w of [world({}, { bank: { is_verified: false } }), world({}, { profile: { verification_status: 'pending' } })]) {
      const t = port({ ok: true, value: null });
      const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
      expect(r.outcome).toBe('blocked');
      expect(t.transfer).not.toHaveBeenCalled();
    }
  });

  it('holds when the provider does not confirm the client paid', async () => {
    const w = world();
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: async () => ({ success: false, amount: 0 }), now: NOW });
    expect(r).toMatchObject({ outcome: 'blocked', reasons: ['payment_not_confirmed'] });
  });
});

describe('reconcile before any resend', () => {
  it('a stale "processing" payout the provider never received is re-sent under the SAME reference', async () => {
    const w = world({ payout_status: 'processing', payout_reference: STABLE, payout_claimed_at: new Date(NOW.getTime() - 2 * H).toISOString() });
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(t.verifyTransfer).toHaveBeenCalledWith(STABLE);
    expect(r).toMatchObject({ outcome: 'sent', payoutReference: STABLE });
    expect(t.transfer).toHaveBeenCalledWith(expect.objectContaining({ reference: STABLE }));
  });

  it('a payout the provider reports successful is recorded, not sent again', async () => {
    const w = world({ payout_status: 'failed', payout_reference: STABLE, payout_retry_count: 1 });
    const t = port({ ok: true, value: { transferCode: 'TRF_1', status: 'success', amountCents: 255_000 } });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('reconciled_paid');
    expect(t.transfer).not.toHaveBeenCalled();
    expect(w.tables.bookings[0]).toMatchObject({ payout_status: 'paid', status: 'paid_out' });
  });

  it('a transfer the provider reports failed goes to a person; nothing is re-sent', async () => {
    const w = world({ payout_status: 'failed', payout_reference: STABLE, payout_retry_count: 1 });
    const t = port({ ok: true, value: { transferCode: 'TRF_1', status: 'failed', amountCents: 255_000 } });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('escalated');
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('when the lookup itself fails, nothing is sent; try again later', async () => {
    const w = world({ payout_status: 'processing', payout_reference: STABLE, payout_claimed_at: new Date(NOW.getTime() - 2 * H).toISOString() });
    const t = port({ ok: false, kind: 'unknown', message: 'timeout' });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('retry_later');
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('an old payout-… reference the provider never saw is replaced by the stable one', async () => {
    const w = world({ payout_status: 'failed', payout_reference: 'payout-BK-test-lzx1', payout_retry_count: 0 });
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(t.verifyTransfer).toHaveBeenCalledWith('payout-BK-test-lzx1');
    expect(r).toMatchObject({ outcome: 'sent', payoutReference: STABLE });
  });

  it('the same holds for a stale "processing" payout under an old reference after retries', async () => {
    // Before: looked up only this reference, found nothing, and sent under the
    // stable one, while an earlier attempt under another reference may have paid.
    const w = world({ payout_status: 'processing', payout_reference: 'payout-BK-test-lzx9', payout_retry_count: 2, payout_claimed_at: new Date(NOW.getTime() - 48 * H).toISOString() });
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('escalated');
    expect(t.verifyTransfer).not.toHaveBeenCalled();
    expect(t.transfer).not.toHaveBeenCalled();
    expect(String(w.tables.bookings[0].payout_last_error)).toMatch(/needs a person/);
  });

  it('an old reference after retries under the old scheme goes to a person without any provider call', async () => {
    const w = world({ payout_status: 'failed', payout_reference: 'payout-BK-test-lzx9', payout_retry_count: 2 });
    const t = port({ ok: true, value: null });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('escalated');
    expect(t.verifyTransfer).not.toHaveBeenCalled();
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('a definite refusal marks it failed; an unknown outcome stays processing under the same reference', async () => {
    const refused = world();
    await triggerCreatorPayout({ bookingId: ID }, { db: refused.db, transfers: port({ ok: true, value: null }, { ok: false, kind: 'rejected', message: 'Insufficient balance' }).p, verifyCharge: confirmed, now: NOW });
    expect(refused.tables.bookings[0]).toMatchObject({ payout_status: 'failed', payout_reference: STABLE });

    const unknown = world();
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: unknown.db, transfers: port({ ok: true, value: null }, { ok: false, kind: 'unknown', message: 'timeout' }).p, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('retry_later');
    expect(unknown.tables.bookings[0]).toMatchObject({ payout_status: 'processing', payout_reference: STABLE });
  });

  it('refuses when no adapter can do verified bank transfers', async () => {
    const w = world();
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: null, verifyCharge: confirmed, now: NOW });
    expect(r.outcome).toBe('blocked');
  });
});

describe('the daily run', () => {
  it('skips bookings that are not due without calling the provider, and sends the due ones', async () => {
    const w = fakeDb({
      bookings: [
        booking(),
        booking({ id: '9b2f1c3e-0000-4000-8000-000000000002', reference: 'BK-later', payout_due_at: new Date(NOW.getTime() + 5 * H).toISOString() }),
      ],
      profiles: [{ id: 'creator-1', verification_status: 'verified' }],
      banking_details: [{ user_id: 'creator-1', is_verified: true, paystack_recipient_code: 'RCP_1' }],
      disputes: [],
    });
    const t = port({ ok: true, value: null });
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW });
    expect(s).toMatchObject({ considered: 1, notDue: 1, outcomes: { sent: 1 } });
    expect(t.transfer).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledTimes(1);
  });
});

describe('the daily run reaches every due payout (the queue used to stall)', () => {
  const idN = (n: number) => `9b2f1c3e-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ago = (hours: number) => new Date(NOW.getTime() - hours * H).toISOString();

  function queue() {
    const rows: Row[] = [];
    // Oldest first: five held for good (creator never verified)...
    for (let i = 0; i < 5; i++) {
      rows.push(booking({ id: idN(100 + i), reference: `BK-held-${i}`, creator_id: 'creator-unverified', completed_at: ago(500 - i), payout_due_at: ago(400 - i) }));
    }
    // ...two waiting for a person (old-scheme reference after retries)...
    for (let i = 0; i < 2; i++) {
      rows.push(booking({ id: idN(200 + i), reference: `BK-stuck-${i}`, payout_status: 'failed', payout_reference: `payout-BK-stuck-${i}-x`, payout_retry_count: 2, completed_at: ago(300 - i), payout_due_at: ago(200 - i) }));
    }
    // ...and the newest due one, which a single page of the oldest rows never reached.
    rows.push(booking({ id: idN(300), reference: 'BK-due', completed_at: ago(80), payout_due_at: ago(8) }));
    return fakeDb({
      bookings: rows,
      profiles: [{ id: 'creator-1', verification_status: 'verified' }, { id: 'creator-unverified', verification_status: 'pending' }],
      banking_details: [
        { user_id: 'creator-1', is_verified: true, paystack_recipient_code: 'RCP_1' },
        { user_id: 'creator-unverified', is_verified: true, paystack_recipient_code: 'RCP_2' },
      ],
      disputes: [],
      notifications: [],
      service_booking_events: [],
    });
  }

  it('pays the newer due booking even when held and escalated ones fill the first pages, and reports them all', async () => {
    const w = queue();
    const t = port({ ok: true, value: null });
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW }, 3);
    expect(t.transfer).toHaveBeenCalledTimes(1);
    expect(t.transfer).toHaveBeenCalledWith(expect.objectContaining({ reference: servicePayoutReference(idN(300)) }));
    expect(s.outcomes).toMatchObject({ sent: 1, blocked: 5, escalated: 2 });
    expect(s.held.map((h) => h.reference)).toEqual(['BK-held-0', 'BK-held-1', 'BK-held-2', 'BK-held-3', 'BK-held-4']);
    expect(s.held[0].why).toMatch(/ID check/);
    // Held and escalated rows are worked in a shuffled order (fair to the time budget).
    expect(s.attention.map((a) => a.reference).sort()).toEqual(['BK-stuck-0', 'BK-stuck-1']);
  });

  it('says so when the queue is longer than one run reads', async () => {
    const w = queue();
    const t = port({ ok: true, value: null });
    const s = await runServicePayouts({ db: w.db, transfers: t.p, verifyCharge: confirmed, now: NOW }, 3, 6);
    expect(s.considered).toBe(6);
    expect(s.attention.some((a) => a.reference === 'payout queue' && /6 or more/.test(a.why))).toBe(true);
  });
});

// Found by the local journey tests: after payment the webhook stores the
// provider's numeric transaction id in paystack_reference. Verifying that id
// fails ("Transaction reference not found"), so every creator payout was held.
describe('creator payout: the payment is verified by our own reference', () => {
  it('verifies BK-<ref>, not the transaction id the webhook stored, and sends', async () => {
    const w = world({ reference: 'BK-abc123', paystack_reference: '5012345678' });
    const t = port({ ok: true, value: null });
    const seen: string[] = [];
    const verify = vi.fn(async (ref: string) => {
      seen.push(ref);
      return ref === 'BK-abc123' ? { success: true, amount: 3000 } : { success: false, amount: 0 };
    });
    const r = await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: t.p, verifyCharge: verify, now: NOW });
    expect(seen).toEqual(['BK-abc123']);
    expect(r.outcome).toBe('sent');
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });

  it('falls back to paystack_reference only when a booking has no reference of its own', async () => {
    const w = world({ reference: null, paystack_reference: 'legacy-ref' });
    const seen: string[] = [];
    await triggerCreatorPayout({ bookingId: ID }, { db: w.db, transfers: port({ ok: true, value: null }).p, verifyCharge: async (ref: string) => { seen.push(ref); return { success: true, amount: 3000 }; }, now: NOW });
    expect(seen).toEqual(['legacy-ref']);
  });
});
