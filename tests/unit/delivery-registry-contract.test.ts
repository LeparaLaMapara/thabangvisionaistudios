/**
 * One contract, three implementations behind DeliveryPort (spec Phase 4 §4.5,
 * 4D "test switching between adapters"): the manual (own-vehicle) adapter,
 * Uber Direct and WumDrop, the couriers against stateful mocked providers (no
 * network). The same behavioural checks run against each:
 *
 *   - capabilities: the full, boolean shape; no adapter claims transit cover;
 *   - quote: integer cents, a future expiry, our provider id;
 *   - create: carries our merchant reference;
 *   - a provider that does not answer → "unknown" (never ok, never rejected);
 *   - a definite refusal → "rejected";
 *   - find-by-reference: an adapter that claims idempotentCreate finds the job
 *     and answers "none" only when there is none, and a repeated create does
 *     not book a second job; an adapter that cannot look up NEVER answers
 *     "none" (that would let the core book a second courier);
 *   - cancel: an unstarted job can be cancelled; the fee is integer cents.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import type { CreateDeliveryRequest, DeliveryPort, DeliveryQuoteRequest } from '@/lib/core/delivery/port';
import { CircuitBreaker, type FetchLike } from '@/lib/delivery/http';
import { InMemoryManualTaskStore, createManualDeliveryAdapter, type ManualTask, type ManualTaskStore } from '@/lib/delivery/manual';
import { createUberDirectAdapter, resetUberDirectTokenCache } from '@/lib/delivery/uber-direct';
import { createWumdropAdapter } from '@/lib/delivery/wumdrop';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW = { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T09:00:00.000Z' };
const FROM = { placeId: 'office', lat: -26.1929, lng: 28.0305, formattedAddress: '99 Smith Street, Braamfontein', suburb: 'Braamfontein', city: 'Johannesburg', postalCode: '2001', province: 'Gauteng', contactName: 'Desk', contactPhone: '+27110000000', instructions: null };
const TO = { placeId: 'home', lat: -26.1076, lng: 28.0567, formattedAddress: '1 Test Road, Sandton', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196', province: 'Gauteng', contactName: 'Thandi', contactPhone: '+27110000001', instructions: null };
const ITEMS = [{ rentalId: 'cam-1', bookingId: 'bk-1', driverLabel: 'Camera equipment', replacementValueCents: 1_500_000, weightGrams: 2000, containsLithium: true }];
const quoteReq: DeliveryQuoteRequest = { from: FROM, to: TO, window: WINDOW, items: ITEMS, leg: 'outbound' };

function createReq(ref: string, providerId: string, providerQuoteRef: string | null = null): CreateDeliveryRequest {
  return {
    merchantReference: ref,
    leg: 'outbound',
    quote: { providerId, providerQuoteRef, providerCostCents: 5000, expiresAt: NOW.toISOString(), window: WINDOW },
    from: FROM,
    to: TO,
    items: ITEMS,
    window: WINDOW,
    requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null },
  };
}

interface Ctx {
  port: DeliveryPort;
  /** The provider (or task store) stops answering. */
  goSilent(): void;
  /** The provider definitely refuses new jobs (4xx). Absent: this adapter cannot be refused a create. */
  refuseCreates?: () => void;
  /** How many jobs exist at the provider. */
  jobs(): number;
}

// ── Fake providers ──────────────────────────────────────────────────────────

const json = (status: number, body: unknown): Response => new Response(body === undefined ? null : JSON.stringify(body), { status });
const hang = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

function uberCtx(): Ctx {
  resetUberDirectTokenCache();
  const jobs = new Map<string, Record<string, unknown>>();
  let silent = false;
  let refuse = false;
  const fetch: FetchLike = async (url, init) => {
    if (silent) return hang(init.signal);
    const path = new URL(url).pathname;
    const m = init.method;
    if (m === 'POST' && path === '/oauth/v2/token') return json(200, { access_token: 't', expires_in: 3600 });
    if (m === 'POST' && path.endsWith('/delivery_quotes')) return json(200, { id: 'dqt_1', fee: 6350, currency_type: 'ZAR', expires: '2026-10-10T08:15:00Z' });
    if (m === 'POST' && path.endsWith('/deliveries')) {
      if (refuse) return json(400, { message: 'address undeliverable' });
      const body = JSON.parse(String(init.body));
      // As Uber's sandbox answered on 2026-10-13: the same idempotency_key twice is a 409.
      const dup = [...jobs.values()].find((j) => j.idempotency_key === body.idempotency_key);
      if (dup) return json(409, { code: 'duplicate_delivery', message: 'An active delivery like this already exists.', metadata: { delivery_id: dup.id } });
      const id = `del_${jobs.size + 1}`;
      const job = { id, external_id: body.external_id, idempotency_key: body.idempotency_key, status: 'pending', created: NOW.toISOString() };
      jobs.set(id, job);
      return json(200, job);
    }
    const cancel = /\/deliveries\/([^/]+)\/cancel$/.exec(path);
    if (m === 'POST' && cancel) {
      const job = jobs.get(cancel[1]);
      if (!job) return json(404, { message: 'not found' });
      job.status = 'canceled';
      return json(200, job);
    }
    if (m === 'GET' && path.endsWith('/deliveries')) {
      const ext = new URL(url).searchParams.get('external_id');
      return json(200, { data: [...jobs.values()].filter((j) => j.external_id === ext) });
    }
    const get = /\/deliveries\/([^/]+)$/.exec(path);
    if (m === 'GET' && get) return jobs.has(get[1]) ? json(200, jobs.get(get[1])) : json(404, { message: 'not found' });
    return json(404, { message: 'no route' });
  };
  const port = createUberDirectAdapter({
    mode: 'sandbox',
    clientId: 'c',
    clientSecret: 's',
    customerId: 'cust',
    fetchImpl: fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('contract-uber', { failureThreshold: 100, cooldownMs: 1 }),
    timeoutsMs: { token: 30, read: 30, create: 30, cancel: 30 },
  });
  return { port, goSilent: () => void (silent = true), refuseCreates: () => void (refuse = true), jobs: () => jobs.size };
}

function wumdropCtx(): Ctx {
  const byRef = new Map<string, Record<string, unknown>>();
  let silent = false;
  let refuse = false;
  const fetch: FetchLike = async (url, init) => {
    if (silent) return hang(init.signal);
    const path = new URL(url).pathname;
    const m = init.method;
    if (m === 'POST' && path === '/v1/quotes') return json(200, { id: 'wq_1', price: '63.50' });
    if (m === 'POST' && path === '/v1/deliveries') {
      if (refuse) return json(400, { message: 'outside service area' });
      const body = JSON.parse(String(init.body));
      // WumDrop refuses a duplicate order_reference.
      if (byRef.has(body.order_reference)) return json(422, { message: 'order_reference has already been taken' });
      const job = { id: `wd_${byRef.size + 1}`, order_reference: body.order_reference, status: 'new' };
      byRef.set(body.order_reference, job);
      return json(201, job);
    }
    const ext = /^\/v1\/deliveries\/ext\/([^/]+)$/.exec(path);
    if (m === 'GET' && ext) {
      const job = byRef.get(decodeURIComponent(ext[1]));
      return job ? json(200, job) : json(404, { message: 'not found' });
    }
    const one = /^\/v1\/deliveries\/([^/]+)$/.exec(path);
    if (one) {
      const job = [...byRef.values()].find((j) => j.id === one[1]);
      if (!job) return json(404, { message: 'not found' });
      if (m === 'DELETE') {
        job.status = 'cancelled';
        return new Response(null, { status: 204 });
      }
      if (m === 'GET') return json(200, job);
    }
    return json(404, { message: 'no route' });
  };
  const port = createWumdropAdapter({
    mode: 'sandbox',
    apiKey: 'k',
    fetchImpl: fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('contract-wd', { failureThreshold: 100, cooldownMs: 1 }),
    timeoutsMs: { read: 30, create: 30, cancel: 30 },
  });
  return { port, goSilent: () => void (silent = true), refuseCreates: () => void (refuse = true), jobs: () => byRef.size };
}

function manualCtx(): Ctx {
  const inner = new InMemoryManualTaskStore();
  let silent = false;
  const down = (): never => {
    throw new Error('task store timed out');
  };
  const store: ManualTaskStore = {
    create: (t: ManualTask) => (silent ? down() : inner.create(t)),
    findByMerchantReference: (r: string) => (silent ? down() : inner.findByMerchantReference(r)),
    get: (r: string) => (silent ? down() : inner.get(r)),
    cancel: (r: string) => (silent ? down() : inner.cancel(r)),
  };
  const port = createManualDeliveryAdapter(store, { now: () => NOW });
  return { port, goSilent: () => void (silent = true), jobs: () => inner.tasks.size };
}

const HARNESSES: [string, () => Ctx][] = [
  ['manual', manualCtx],
  ['uber_direct', uberCtx],
  ['wumdrop', wumdropCtx],
];

describe.each(HARNESSES)('DeliveryPort contract: %s', (name, make) => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = make();
  });

  it('declares its identity and the full boolean capability shape', () => {
    expect(ctx.port.providerId).toBe(name);
    expect(['courier', 'own_fleet']).toContain(ctx.port.kind);
    expect(['sandbox', 'production']).toContain(ctx.port.mode);
    expect(Object.keys(ctx.port.capabilities).sort()).toEqual(Object.keys(NO_DELIVERY_CAPABILITIES).sort());
    for (const v of Object.values(ctx.port.capabilities)) expect(typeof v).toBe('boolean');
    // Nobody has verified transit cover today (D-40, D-41).
    expect(ctx.port.capabilities.verifiedTransitCover).toBe(false);
  });

  it('quotes in integer cents with a future expiry', async () => {
    const q = await ctx.port.quote(quoteReq);
    if (!q.ok) throw new Error(`quote failed: ${q.message}`);
    expect(q.value.providerId).toBe(name);
    expect(Number.isSafeInteger(q.value.providerCostCents)).toBe(true);
    expect(q.value.providerCostCents).toBeGreaterThan(0);
    expect(new Date(q.value.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(q.value.window).toEqual(WINDOW);
  });

  it('creates under our merchant reference and can read the job back', async () => {
    const r = await ctx.port.createDelivery(createReq('tvd_contract_o1', name));
    if (!r.ok) throw new Error(`create failed: ${r.message}`);
    expect(r.value.merchantReference).toBe('tvd_contract_o1');
    expect(r.value.providerReference).toBeTruthy();
    const g = await ctx.port.getDelivery(r.value.providerReference);
    expect(g).toMatchObject({ ok: true, value: { providerReference: r.value.providerReference } });
    expect(ctx.jobs()).toBe(1);
  });

  it('a provider that does not answer is UNKNOWN, never ok or rejected', async () => {
    ctx.goSilent();
    expect(await ctx.port.createDelivery(createReq('tvd_contract_o2', name))).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await ctx.port.getDelivery('anything')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await ctx.port.findByMerchantReference('tvd_contract_o2')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await ctx.port.cancelDelivery('anything', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('a definite refusal is REJECTED', async () => {
    expect(await ctx.port.getDelivery('does-not-exist')).toMatchObject({ ok: false, kind: 'rejected' });
    if (ctx.refuseCreates) {
      ctx.refuseCreates();
      expect(await ctx.port.createDelivery(createReq('tvd_contract_o3', name))).toMatchObject({ ok: false, kind: 'rejected' });
      expect(ctx.jobs()).toBe(0);
    }
  });

  it('find-by-reference semantics match the idempotentCreate claim', async () => {
    const first = await ctx.port.createDelivery(createReq('tvd_contract_o4', name));
    if (!first.ok) throw new Error('create failed');
    const found = await ctx.port.findByMerchantReference('tvd_contract_o4');
    const none = await ctx.port.findByMerchantReference('tvd_never_created');
    if (ctx.port.capabilities.idempotentCreate) {
      expect(found).toMatchObject({ ok: true, value: { providerReference: first.value.providerReference, merchantReference: 'tvd_contract_o4' } });
      expect(none).toEqual({ ok: true, value: null });
      // Creating again with the same reference returns the same job: one courier.
      const again = await ctx.port.createDelivery(createReq('tvd_contract_o4', name));
      expect(again).toMatchObject({ ok: true, value: { providerReference: first.value.providerReference } });
      expect(ctx.jobs()).toBe(1);
    } else {
      // Cannot look up: it must never say "none", or the core would book a second courier.
      expect(found).toMatchObject({ ok: false, kind: 'unknown' });
      expect(none).toMatchObject({ ok: false, kind: 'unknown' });
    }
  });

  it('cancels an unstarted job; any fee is integer cents', async () => {
    const r = await ctx.port.createDelivery(createReq('tvd_contract_o5', name));
    if (!r.ok) throw new Error('create failed');
    const c = await ctx.port.cancelDelivery(r.value.providerReference, 'renter cancelled');
    expect(c).toMatchObject({ ok: true, value: { cancelled: true } });
    if (c.ok) {
      expect(Number.isSafeInteger(c.value.feeCents)).toBe(true);
      expect(c.value.feeCents).toBeGreaterThanOrEqual(0);
    }
  });
});
