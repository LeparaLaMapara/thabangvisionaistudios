/**
 * Review fixes around the delivery core:
 *  - 5: the "is migration 076 applied" probes read a REAL PostgREST
 *       missing-table answer as missing (a HEAD probe reads it as success);
 *  - 6: a paid quote no leg was made from is refunded with the order;
 *  - 13: the overdue ladder stops once a return pickup took the gear;
 *  - 14: delivery steps run after the money steps, within a time budget;
 *  - 15: the address purge re-checks in the database at write time;
 *  - 16: Ubunye and staff quotes are advisory (no order link) and rate limited;
 *        a released order's quotes are unlinked;
 *  - 17: the webhook body limit is enforced before and while reading.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { DELIVERY_OPS } from '@/lib/constants';
import { deliveryFeeRefundKey, markDeliveryQuotesPaid, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, OWNER_A, RENTER, RENTER_HOME, world } from './helpers/delivery-fakes';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => undefined }));

// ── 5 ───────────────────────────────────────────────────────────────────────

/** A PostgREST that does not have the table: HEAD → 404 with no body; GET → 404 with the PGRST205 error body. */
function postgrest(missing: boolean) {
  const calls: string[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method);
    if (!missing) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } });
    if (method === 'HEAD') return new Response(null, { status: 404 });
    return new Response(JSON.stringify({ code: 'PGRST205', details: null, hint: "Perhaps you meant the table 'public.delivery_zones'", message: "Could not find the table 'public.delivery_quotes' in the schema cache" }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  const db = createClient('http://localhost:54321', 'test-anon-key', { global: { fetch: fetchImpl as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  return { db, calls };
}

describe('finding 5: a database without 076 is recognised (real PostgREST answer shapes)', () => {
  it('the trap: postgrest-js reports a HEAD on a missing table as success (status 204, no error)', async () => {
    const { db } = postgrest(true);
    const head = await db.from('delivery_quotes').select('id', { head: true, count: 'exact' }).limit(1);
    expect(head.error).toBeNull();
    expect(head.status).toBe(204);
  });

  it('SupabaseQuoteLinks.available() and the ops queues probe with GET and say "not applied"', async () => {
    const { SupabaseQuoteLinks, tableExists } = await import('@/lib/delivery/checkout');
    const { loadDeliveryOpsQueues } = await import('@/lib/delivery/ops');
    const missing = postgrest(true);
    expect(await new SupabaseQuoteLinks(missing.db as never).available()).toBe(false);
    expect(missing.calls).not.toContain('HEAD');
    expect(await loadDeliveryOpsQueues(missing.db as never, new Date())).toMatchObject({ pipeline: false });
    const present = postgrest(false);
    expect(await tableExists(present.db as never, 'delivery_quotes')).toBe(true);
  });
});

// ── 6 ───────────────────────────────────────────────────────────────────────

describe('finding 6: an unused paid quote is refunded when the order is cancelled', () => {
  it('the plan lists it, and settling the order refunds it once (capped in the database)', async () => {
    const { deliveryCancellationPlan, settleOrderDeliveryOnCancel } = await import('@/lib/rental/delivery-settlement');
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
    if (!q.ok) throw new Error(q.code);
    const quote = q.quotes[0];
    await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [quote.id], paidDeliveryCents: quote.customerFeeCents }, w.deps);
    const fake = {
      rpc: async () => ({ data: null, error: null }),
      from(table: string) {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'limit', 'maybeSingle']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === 'equipment_bookings'
                ? [{ id: 'bk-1', status: 'confirmed' }]
                : table === 'delivery_quotes'
                  ? [{ id: quote.id, customer_fee_cents: quote.customerFeeCents }]
                  : table === 'refund_obligations'
                    ? { id: 'ob-1' }
                    : [],
            error: null,
          }).then(resolve);
        return b;
      },
    };
    const plan = await deliveryCancellationPlan(fake as never, { bookingGroupId: GROUP, bookingId: 'bk-1' }, w.repo);
    expect(plan).toMatchObject({ phase4: true, lastLine: true, shipmentIds: [], unusedPaidQuoteIds: [quote.id], feeCents: quote.customerFeeCents });
    const submitted: string[] = [];
    const refunded = await settleOrderDeliveryOnCancel(fake as never, { plan, caller: { kind: 'renter', userId: RENTER }, bookingId: 'bk-1', reason: 'cancelled' }, { deps: async () => w.deps, submit: async (id) => submitted.push(id) });
    expect(refunded).toBe(quote.customerFeeCents);
    expect(w.repo.refunds.get(deliveryFeeRefundKey(`quote-${quote.id}`))?.amountCents).toBe(quote.customerFeeCents);
    expect(submitted).toEqual(['ob-1']);
    // A second cancellation attempt refunds nothing more.
    expect(await settleOrderDeliveryOnCancel(fake as never, { plan, caller: { kind: 'renter', userId: RENTER }, bookingId: 'bk-1', reason: 'again' }, { deps: async () => w.deps, submit: async () => undefined })).toBe(0);
    expect(w.repo.refunds.size).toBe(1);
  });
});

// ── 15 ──────────────────────────────────────────────────────────────────────

describe('finding 15: the purge re-checks at write time in the database', () => {
  it('redact goes through delivery_redact_address with the suburb-level fields', async () => {
    const { SupabaseAddressRetention } = await import('@/lib/delivery/jobs');
    const rpcs: { name: string; args: Record<string, unknown> }[] = [];
    let answer = true;
    const db = { rpc: async (name: string, args: Record<string, unknown>) => (rpcs.push({ name, args }), { data: answer, error: null }) };
    const a = { id: 'a1', createdAt: '2026-01-01T00:00:00Z', retainUntil: null, lat: -26.10764, lng: 28.05671, suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng' };
    expect(await new SupabaseAddressRetention(db as never).redact(a, '2026-10-09T00:00:00Z')).toBe(true);
    expect(rpcs[0]).toMatchObject({ name: 'delivery_redact_address', args: { p_address: 'a1', p_now: '2026-10-09T00:00:00Z', p_fields: { formatted_address: 'Sandton, Johannesburg', contact_name: '', contact_phone: '' } } });
    // A leg made after the decision keeps the address: the database says no, nothing is redacted.
    answer = false;
    expect(await new SupabaseAddressRetention(db as never).redact(a, '2026-10-09T00:00:00Z')).toBe(false);
  });
});

// ── 16 ──────────────────────────────────────────────────────────────────────

describe('finding 16: advisory quotes and released orders', () => {
  it('Ubunye stores its quote without the order link, so the order payment total is unchanged; it is rate limited', async () => {
    const { createDeliveryTools } = await import('@/lib/agents/tools/delivery');
    const { dispatchDeliveryAfterPayment } = await import('@/lib/delivery/after-payment');
    const w = world({ providers: 'manual' });
    // The order's own paid outbound leg (as at checkout), dispatched.
    const out = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T06:00:00Z', end: '2026-10-20T10:00:00Z' } }, w.deps);
    if (!out.ok) throw new Error(out.code);
    const links = {
      linkToGroup: async () => true,
      quotesForGroup: async (g: string) => [...w.repo.quotes.values()].filter((q) => q.bookingGroupId === g && q.status !== 'superseded'),
      available: async () => true,
    };
    const fee = out.quotes[0].customerFeeCents;
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: fee }, { delivery: w.deps, links })).toMatchObject({ outcome: 'done' });

    let allowed = true;
    const BK = '00000000-0000-4000-8000-00000000aa01';
    const tools = createDeliveryTools({ auth: { getUser: async () => ({ data: { user: { id: RENTER } } }) } }, true, {
      deps: async () => w.deps,
      lookupBooking: async (id) => (id === BK ? { bookingGroupId: GROUP, renterId: RENTER, ownerId: OWNER_A } : null),
      savedAddresses: async () => [],
      rateLimit: async () => allowed,
    }) as Record<string, { execute: (p: Record<string, unknown>) => Promise<Record<string, unknown>> }>;
    const r = await tools.get_return_pickup_options.execute({ booking_id: BK });
    expect(r).toMatchObject({ available: true });
    expect(String(r.how_to_book)).toMatch(/Request the return pickup/);
    const stored = [...w.repo.quotes.values()].filter((q) => q.leg === 'return');
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((q) => q.bookingGroupId === null)).toBe(true);
    // A payment replay still balances: the advisory quote is not part of the order's payment.
    expect(await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: fee }, { delivery: w.deps, links })).toEqual({ outcome: 'done', legs: [{ leg: 'outbound', result: 'already_dispatched' }] });
    allowed = false;
    expect(await tools.get_delivery_quote.execute({ booking_id: BK, leg: 'return' })).toMatchObject({ error: expect.stringMatching(/Several delivery prices/) });
    // Outbound copy never sends the renter to pay on the booking page.
    allowed = true;
    w.repo.shipments.forEach((s) => {
      if (s.leg === 'outbound') s.status = 'cancelled';
    });
    const o = await tools.get_delivery_quote.execute({ booking_id: BK, leg: 'outbound' });
    if (o.available) expect(String(o.how_to_book)).toMatch(/arranged by our team/);
  });

  it('a released unpaid order unlinks its unpaid quotes', async () => {
    const { releaseUnpaidReservation } = await import('@/lib/rental/reserve');
    const updates: { table: string; patch: Record<string, unknown>; filters: string[] }[] = [];
    const db = {
      from(table: string) {
        const rec = { table, patch: {} as Record<string, unknown>, filters: [] as string[] };
        const b: Record<string, unknown> = {};
        b.delete = () => b;
        b.update = (p: Record<string, unknown>) => {
          rec.patch = p;
          updates.push(rec);
          return b;
        };
        b.eq = (c: string, v: unknown) => (rec.filters.push(`${c}=${String(v)}`), b);
        b.in = (c: string, v: unknown[]) => (rec.filters.push(`${c} in ${v.join(',')}`), b);
        b.is = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
        return b;
      },
    };
    await releaseUnpaidReservation(db as never, GROUP);
    const u = updates.find((x) => x.table === 'delivery_quotes');
    expect(u?.patch).toMatchObject({ booking_group_id: null });
    expect(u?.filters).toEqual([`booking_group_id=${GROUP}`, 'status in active,expired']);
  });
});

// ── 17 ──────────────────────────────────────────────────────────────────────

describe('finding 17: webhook body limit before and while reading', () => {
  it('a declared Content-Length over the limit is refused without reading the body', async () => {
    const { POST } = await import('@/app/api/webhooks/delivery/[provider]/route');
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
          throw new Error('the body must not be read');
        },
      },
      { highWaterMark: 0 },
    );
    const init = { method: 'POST', body, headers: { 'content-length': String(DELIVERY_OPS.webhookMaxBodyBytes + 1) }, duplex: 'half' };
    const req = new NextRequest('http://localhost/api/webhooks/delivery/uber_direct', init as unknown as ConstructorParameters<typeof NextRequest>[1]);
    const res = await POST(req, { params: Promise.resolve({ provider: 'uber_direct' }) });
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
  });

  it('without a Content-Length, reading stops as soon as the limit is passed', async () => {
    const { readBodyWithin } = await import('@/lib/delivery/webhooks');
    let chunks = 0;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        chunks += 1;
        c.enqueue(chunk);
      },
    });
    const req = new Request('http://localhost/x', { method: 'POST', body, duplex: 'half' } as RequestInit & { duplex: 'half' });
    expect(await readBodyWithin(req, DELIVERY_OPS.webhookMaxBodyBytes)).toBeNull();
    expect(chunks).toBeLessThanOrEqual(Math.ceil(DELIVERY_OPS.webhookMaxBodyBytes / chunk.byteLength) + 2);
    expect(await readBodyWithin(new Request('http://localhost/x', { method: 'POST', body: '{"ok":true}' }), 1024)).toBe('{"ok":true}');
  });
});
