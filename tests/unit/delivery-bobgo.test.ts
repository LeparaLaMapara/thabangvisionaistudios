/**
 * Bob Go adapter (courier aggregator), against a mocked fetch only: no
 * network, no real keys, and NO claim that the mocked responses match Bob Go
 * (the contract in lib/delivery/bobgo/api-contract.ts is unverified). Covers
 * quote (approved service levels only, rands → cents), create under our
 * merchant reference (a refusal is checked by lookup; a repeat books no second
 * order), find-by-reference (never "none"), cancel, status mapping (unknown
 * words stay 'unknown'), error classification and the not-configured path.
 */
import { describe, expect, it } from 'vitest';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import type { CreateDeliveryRequest, DeliveryQuoteRequest } from '@/lib/core/delivery/port';
import { CircuitBreaker, type FetchLike } from '@/lib/delivery/http';
import {
  BOBGO_CAPABILITIES,
  BOBGO_CONTRACT,
  BOBGO_CONTRACT_SOURCES,
  bobgoConfigFromEnv,
  bobgoDelivery,
  bobgoRandsToCents,
  createBobgoAdapter,
  mapBobgoStatus,
  type BobgoConfig,
} from '@/lib/delivery/bobgo';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW = { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T12:00:00.000Z' };
const SB = 'https://api.sandbox.bobgo.co.za';
const LEVEL = 'TEST_HAND_TO_HAND';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}
type Handler = (c: Call) => Response | Promise<Response> | 'hang';

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetch(routes: Record<string, Handler>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { method: String(init.method), url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === call.method && path === p;
    });
    if (!key) return json(404, { message: 'not found' });
    const out = routes[key](call);
    if (out === 'hang') {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return out;
  };
  return { fetch, calls };
}

function adapter(routes: Record<string, Handler>, over: Partial<BobgoConfig> = {}) {
  const f = fakeFetch(routes);
  const port = createBobgoAdapter({
    mode: 'sandbox',
    apiKey: 'bg-key',
    approvedServiceLevelCodes: [LEVEL],
    fetchImpl: f.fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('bg-test', { failureThreshold: 100, cooldownMs: 1_000 }),
    timeoutsMs: { read: 30, create: 30, cancel: 30 },
    ...over,
  });
  return { port, calls: f.calls };
}

const POINT = { lat: -26.1929, lng: 28.0305, suburb: 'Braamfontein', city: 'Johannesburg', postalCode: '2001', province: 'Gauteng' };
const POINT_B = { lat: -26.1076, lng: 28.0567, suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196', province: 'Gauteng' };
const ITEMS = [
  { rentalId: 'tripod-1', bookingId: 'bk-1', driverLabel: 'Camera equipment', replacementValueCents: 1_500_000, quantity: 2, weightGrams: 2000, containsLithium: false },
  { rentalId: 'stand-1', bookingId: 'bk-2', driverLabel: 'Camera equipment', replacementValueCents: 800_000, weightGrams: null, containsLithium: false },
];
const LITHIUM = [{ ...ITEMS[0], containsLithium: true }];
const quoteReq: DeliveryQuoteRequest = { from: POINT, to: POINT_B, window: WINDOW, items: ITEMS, leg: 'outbound' };
const REF = 'tvd_group1_o1';
function createReq(over: Partial<CreateDeliveryRequest> = {}): CreateDeliveryRequest {
  return {
    merchantReference: REF,
    leg: 'outbound',
    quote: { providerId: 'bobgo', providerQuoteRef: LEVEL, providerCostCents: 9000, expiresAt: NOW.toISOString(), window: WINDOW },
    from: { ...POINT, placeId: 'p1', formattedAddress: '99 Smith Street, Braamfontein', contactName: 'Desk', contactPhone: '+27110000000', instructions: null },
    to: { ...POINT_B, placeId: 'p2', formattedAddress: '1 Test Road, Sandton', contactName: 'Thandi', contactPhone: '+27110000001', instructions: 'Gate 2' },
    items: ITEMS,
    window: WINDOW,
    requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: 2_300_000 },
    ...over,
  };
}
const order = (over: Record<string, unknown> = {}) => ({ id: 'bg_77', channel_order_number: REF, status: 'submitted', time_created: '2026-10-10T08:00:00Z', ...over });
const RATES = 'POST /v2/rates-at-checkout';
const ORDERS = 'POST /v2/orders';
const LOOKUP = 'GET /v2/orders';

describe('Bob Go: configuration, contract and capabilities', () => {
  it('reads the key per mode, never the other mode', () => {
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live', BOBGO_SANDBOX_API_KEY: 'sb' }, 'sandbox').apiKey).toBe('sb');
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live' }, 'production').apiKey).toBe('live');
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live' }, 'sandbox').apiKey).toBeNull();
    expect(bobgoConfigFromEnv({ BOBGO_SANDBOX_API_KEY: 'sb' }, 'production').apiKey).toBeNull();
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: '  ' }, 'production').apiKey).toBeNull();
  });

  it('claims NO capability: nothing about Bob Go is verified', () => {
    expect(BOBGO_CAPABILITIES).toEqual(NO_DELIVERY_CAPABILITIES);
  });

  it('the contract is unverified by default: no approved service level, no lithium, no webhook signing', () => {
    expect(BOBGO_CONTRACT.approvedServiceLevelCodes).toEqual([]);
    expect(BOBGO_CONTRACT.lithiumAccepted).toBe(false);
    expect(BOBGO_CONTRACT.webhookSigning).toBeNull();
    expect(BOBGO_CONTRACT.baseUrl.production).toBe('https://api.bobgo.co.za/v2');
    // Every item is tagged with where it came from; only paths seen in the plugin are not "assumed".
    expect(BOBGO_CONTRACT_SOURCES['baseUrl.sandbox']).toBe('assumed');
    expect(BOBGO_CONTRACT_SOURCES['paths.findByReference']).toBe('assumed');
    expect(BOBGO_CONTRACT_SOURCES['auth.header']).toBe('assumed');
    expect(new Set(Object.values(BOBGO_CONTRACT_SOURCES))).toEqual(new Set(['plugin', 'assumed', 'research']));
  });

  it('without a key, refuses every call and sends nothing', async () => {
    const { port, calls } = adapter({}, { apiKey: null });
    const notConfigured = { ok: false, kind: 'rejected', message: expect.stringContaining('not configured') };
    expect(await port.checkServiceability(quoteReq)).toMatchObject(notConfigured);
    expect(await port.quote(quoteReq)).toMatchObject(notConfigured);
    expect(await port.createDelivery(createReq())).toMatchObject(notConfigured);
    expect(await port.findByMerchantReference(REF)).toMatchObject(notConfigured);
    expect(await port.getDelivery('bg_77')).toMatchObject(notConfigured);
    expect(await port.cancelDelivery('bg_77', 'x')).toMatchObject(notConfigured);
    expect(await port.getTracking('bg_77')).toMatchObject(notConfigured);
    expect(calls).toHaveLength(0);
  });

  it('labels itself a sandbox courier in sandbox mode', () => {
    const { port } = adapter({});
    expect(port).toMatchObject({ providerId: 'bobgo', kind: 'courier', mode: 'sandbox' });
  });
});

describe('Bob Go: serviceability and quote', () => {
  it('with the shipped (empty) approved list, nothing is quoted and nothing is sent', async () => {
    const { port, calls } = adapter({ [RATES]: () => json(200, { rates: [{ service_level_code: 'ANY', total_price: 50 }] }) }, { approvedServiceLevelCodes: undefined });
    expect(await port.checkServiceability(quoteReq)).toEqual({ ok: true, value: { serviceable: false, reason: 'no_approved_service_level' } });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('no_approved_service_level') });
    expect(calls).toHaveLength(0);
  });

  it('lithium batteries are refused locally until Bob Go confirms them in writing', async () => {
    const { port, calls } = adapter({ [RATES]: () => json(200, { rates: [] }) });
    expect(await port.checkServiceability({ ...quoteReq, items: LITHIUM })).toEqual({ ok: true, value: { serviceable: false, reason: 'item_refused' } });
    expect(await port.quote({ ...quoteReq, items: LITHIUM })).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('lithium') });
    expect(await port.createDelivery(createReq({ items: LITHIUM }))).toMatchObject({ ok: false, kind: 'rejected' });
    expect(calls).toHaveLength(0);
  });

  it('bad coordinates: not serviceable, quote refused', async () => {
    const { port } = adapter({});
    const bad = { ...quoteReq, to: { ...POINT_B, lat: 0, lng: 0 } };
    expect(await port.checkServiceability(bad)).toEqual({ ok: true, value: { serviceable: false, reason: 'invalid_location' } });
    expect(await port.quote(bad)).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('picks the cheapest APPROVED service level (never a cheaper unapproved one) and converts rands to cents', async () => {
    const { port, calls } = adapter({
      [RATES]: () =>
        json(200, {
          rates: [
            { service_level_code: 'PICKUP_POINT', total_price: 30 },
            { service_level_code: LEVEL, total_price: '89.90' },
            { service_level_code: 'OTHER_APPROVED', total_price: 120 },
            { service_level_code: LEVEL, total_price: 95, currency: 'USD' },
          ],
        }),
    }, { approvedServiceLevelCodes: [LEVEL, 'OTHER_APPROVED'] });
    expect(await port.quote(quoteReq)).toEqual({
      ok: true,
      value: { providerId: 'bobgo', providerQuoteRef: LEVEL, providerCostCents: 8990, expiresAt: '2026-10-10T08:15:00.000Z', window: WINDOW },
    });
    expect(calls[0].url).toBe(`${SB}/v2/rates-at-checkout`);
    expect(calls[0].headers.Authorization).toBe('Bearer bg-key');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body.collection_address).toMatchObject({ local_area: 'Braamfontein', city: 'Johannesburg', zone: 'Gauteng', code: '2001', country: 'ZA', lat: POINT.lat, lng: POINT.lng });
    expect(body.parcels).toEqual([
      { description: 'Camera equipment', quantity: 2, submitted_weight_kg: 2 },
      { description: 'Camera equipment', quantity: 1 },
    ]);
    // No value ever leaves for a rate request.
    expect(JSON.stringify(body)).not.toMatch(/1500000|800000|15000|8000/);
  });

  it('only unapproved levels on offer → a definite refusal', async () => {
    const { port } = adapter({ [RATES]: () => json(200, { rates: [{ service_level_code: 'PICKUP_POINT', total_price: 30 }] }) });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('no approved service level') });
  });

  it('an unreadable rates answer is unknown; errors are classified', async () => {
    expect(await adapter({ [RATES]: () => json(200, { nothing: true }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [RATES]: () => json(400, { message: 'bad address' }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: 'HTTP 400: bad address' });
    expect(await adapter({ [RATES]: () => json(503, {}) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [RATES]: () => 'hang' }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringContaining('timed out') });
  });

  it('bobgoRandsToCents', () => {
    expect(bobgoRandsToCents(0.1 + 0.2)).toBe(30);
    expect(bobgoRandsToCents(89.9)).toBe(8990);
    expect(bobgoRandsToCents('120.5')).toBe(12050);
    expect(bobgoRandsToCents('12.345')).toBeNull();
    expect(bobgoRandsToCents(-1)).toBeNull();
    expect(bobgoRandsToCents('R50')).toBeNull();
    expect(bobgoRandsToCents(null)).toBeNull();
  });
});

describe('Bob Go: create under our merchant reference', () => {
  it('sends our reference and the approved service level; generic label, no value, no declared value', async () => {
    const { port, calls } = adapter({ [ORDERS]: () => json(201, order()) });
    expect(await port.createDelivery(createReq())).toEqual({
      ok: true,
      value: { providerReference: 'bg_77', merchantReference: REF, state: 'unknown', stateAt: '2026-10-10T08:00:00.000Z', trackingUrl: null, courierName: null, proof: [] },
    });
    expect(calls[0].url).toBe(`${SB}/v2/orders`);
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body).toMatchObject({
      channel_order_number: REF,
      service_level_code: LEVEL,
      collection_contact: { name: 'Desk', mobile_number: '+27110000000' },
      delivery_contact: { name: 'Thandi', mobile_number: '+27110000001' },
      delivery_instructions: 'Gate 2',
    });
    expect(body.delivery_address.street_address).toBe('1 Test Road, Sandton');
    expect(JSON.stringify(body)).not.toMatch(/1500000|800000|2300000|declared/);
  });

  it('refuses, without sending, a quote that is not for an approved service level', async () => {
    const { port, calls } = adapter({ [ORDERS]: () => json(201, order()) });
    const q = createReq().quote;
    expect(await port.createDelivery(createReq({ quote: { ...q, providerQuoteRef: 'PICKUP_POINT' } }))).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await port.createDelivery(createReq({ quote: { ...q, providerQuoteRef: null } }))).toMatchObject({ ok: false, kind: 'rejected' });
    expect(calls).toHaveLength(0);
  });

  it('idempotent through our reference: a repeated create returns the SAME order (one courier)', async () => {
    const byRef = new Map<string, Record<string, unknown>>();
    const { port, calls } = adapter({
      [ORDERS]: (c) => {
        const ref = JSON.parse(c.body ?? '{}').channel_order_number as string;
        if (byRef.has(ref)) return json(422, { message: 'channel_order_number already exists' });
        const o = order({ id: `bg_${byRef.size + 1}`, channel_order_number: ref });
        byRef.set(ref, o);
        return json(201, o);
      },
      [LOOKUP]: (c) => {
        const ref = new URL(c.url).searchParams.get('channel_order_number') ?? '';
        return json(200, { orders: byRef.has(ref) ? [byRef.get(ref)] : [] });
      },
    });
    const first = await port.createDelivery(createReq());
    const again = await port.createDelivery(createReq());
    expect(first).toMatchObject({ ok: true, value: { providerReference: 'bg_1', merchantReference: REF } });
    expect(again).toMatchObject({ ok: true, value: { providerReference: 'bg_1', merchantReference: REF } });
    expect(byRef.size).toBe(1);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'POST /v2/orders',
      'POST /v2/orders',
      `GET /v2/orders?channel_order_number=${REF}`,
    ]);
  });

  it('a refusal with no order of ours in the lookup is a definite refusal', async () => {
    const { port } = adapter({ [ORDERS]: () => json(400, { message: 'address outside service area' }), [LOOKUP]: () => json(200, { orders: [] }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('service area') });
  });

  it('a lookup that ignores our filter cannot hand us someone else’s order', async () => {
    const { port } = adapter({ [ORDERS]: () => json(400, { message: 'bad' }), [LOOKUP]: () => json(200, { orders: [order({ id: 'bg_other', channel_order_number: 'someone_else' })] }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: 'HTTP 400: bad' });
  });

  it('a refusal whose lookup does not answer is unknown', async () => {
    for (const h of [(): 'hang' => 'hang', () => json(500, {}), () => json(404, {})] as Handler[]) {
      const { port } = adapter({ [ORDERS]: () => json(400, { message: 'bad' }), [LOOKUP]: h });
      expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'unknown' });
    }
  });

  it.each([
    ['timeout', (): 'hang' => 'hang'],
    ['500', () => json(500, {})],
    ['502', () => json(502, {})],
    ['429', () => json(429, {})],
    ['409', () => json(409, { message: 'duplicate' })],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['201 without an id', () => json(201, { ok: true })],
  ] as const)('%s on create is unknown, with no retry and no lookup', async (_name, handler) => {
    const { port, calls } = adapter({ [ORDERS]: handler as Handler });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it.each([401, 403])('%s on create is a configuration refusal, without a lookup', async (status) => {
    const { port, calls } = adapter({ [ORDERS]: () => json(status, { message: 'unauthorised' }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('configuration') });
    expect(calls).toHaveLength(1);
  });
});

describe('Bob Go: find by our reference never says "none"', () => {
  it('an order echoing our reference exactly is returned (list or bare)', async () => {
    for (const body of [{ orders: [order()] }, [order()], order(), { order: order() }]) {
      const { port, calls } = adapter({ [LOOKUP]: () => json(200, body) });
      expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: true, value: { providerReference: 'bg_77', merchantReference: REF } });
      expect(new URL(calls[0].url).searchParams.get('channel_order_number')).toBe(REF);
    }
  });

  it('empty, 404, someone else’s order, two of ours, errors and timeouts are all unknown', async () => {
    const cases: Handler[] = [
      () => json(200, { orders: [] }),
      () => json(200, []),
      () => json(404, { message: 'not found' }),
      () => json(200, { orders: [order({ channel_order_number: 'other' })] }),
      () => json(200, { orders: [order(), order({ id: 'bg_78' })] }),
      () => json(400, {}),
      () => json(401, {}),
      () => json(500, {}),
      () => json(200, null),
      (): 'hang' => 'hang',
    ];
    for (const h of cases) {
      const { port } = adapter({ [LOOKUP]: h });
      const r = await port.findByMerchantReference(REF);
      expect(r).toMatchObject({ ok: false, kind: 'unknown' });
    }
  });
});

describe('Bob Go: status mapping', () => {
  it('maps only unambiguous words', () => {
    expect(mapBobgoStatus('Delivered')).toBe('delivered');
    expect(mapBobgoStatus('cancelled')).toBe('cancelled');
    expect(mapBobgoStatus('canceled')).toBe('cancelled');
    expect(mapBobgoStatus('in-transit')).toBe('in_transit');
    expect(mapBobgoStatus(' in_transit ')).toBe('in_transit');
  });

  it('anything else is unknown, which the core never applies (no regression)', () => {
    for (const s of ['collected', 'submitted', 'ready', 'open', 'pending-collection', 'out-for-delivery', 'returned', 'exception', 'pending', '', '  ', 'DELIVERED-ish', 3, null, undefined, { status: 'delivered' }]) {
      expect(mapBobgoStatus(s)).toBe('unknown');
    }
  });

  it('the shipment status wins; an unknown shipment word falls back to the order status, never invents one', () => {
    expect(bobgoDelivery(order({ status: 'submitted', shipments: [{ status: 'delivered', tracking_url: 'https://t.example/1' }] }), null)).toMatchObject({ state: 'delivered', trackingUrl: 'https://t.example/1' });
    expect(bobgoDelivery(order({ status: 'cancelled', shipments: [{ status: 'weird-new-word' }] }), null)).toMatchObject({ state: 'cancelled' });
    expect(bobgoDelivery(order({ status: 'weird', shipments: [{ status: 'odd' }] }), null)).toMatchObject({ state: 'unknown' });
    expect(bobgoDelivery({ status: 'delivered' }, REF)).toBeNull();
  });

  it('keeps no names, phone numbers or proof images from the order', async () => {
    const { port } = adapter({
      'GET /v2/orders/bg_77': () => json(200, order({ status: 'delivered', driver: { name: 'Sipho Ndlovu' }, delivery_contact: { mobile_number: '+27110000001' }, pod: { signature: 'https://img/s.png' } })),
    });
    const r = await port.getDelivery('bg_77');
    expect(r).toMatchObject({ ok: true, value: { state: 'delivered', courierName: null, proof: [] } });
    expect(JSON.stringify(r)).not.toMatch(/Sipho|\+27|img\//);
  });
});

describe('Bob Go: get, cancel, tracking', () => {
  it('get: 404 is a definite refusal, 5xx unknown', async () => {
    expect(await adapter({}).port.getDelivery('nope')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ 'GET /v2/orders/bg_77': () => json(500, {}) }).port.getDelivery('bg_77')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'GET /v2/orders/bg_77': () => json(200, { nothing: 1 }) }).port.getDelivery('bg_77')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('cancel: PATCH; only a "cancelled" answer counts', async () => {
    const ok = adapter({ 'PATCH /v2/orders/bg_77': () => json(200, order({ status: 'cancelled' })) });
    expect(await ok.port.cancelDelivery('bg_77', 'renter cancelled')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    expect(ok.calls[0]).toMatchObject({ method: 'PATCH', url: `${SB}/v2/orders/bg_77` });
    expect(JSON.parse(ok.calls[0].body ?? '{}')).toEqual({ status: 'cancelled' });
    // An empty 2xx or another status proves nothing: unknown (staff check, no refund on a guess).
    expect(await adapter({ 'PATCH /v2/orders/bg_77': () => new Response(null, { status: 204 }) }).port.cancelDelivery('bg_77', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'PATCH /v2/orders/bg_77': () => json(200, order({ status: 'in-transit' })) }).port.cancelDelivery('bg_77', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'PATCH /v2/orders/bg_77': () => json(422, { message: 'already collected' }) }).port.cancelDelivery('bg_77', 'x')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ 'PATCH /v2/orders/bg_77': () => json(500, {}) }).port.cancelDelivery('bg_77', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'PATCH /v2/orders/bg_77': () => 'hang' }).port.cancelDelivery('bg_77', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('tracking never invents an ETA or location', async () => {
    const { port } = adapter({ 'GET /v2/orders/bg_77': () => json(200, order({ shipments: [{ status: 'in-transit', tracking_url: 'https://t.example/1' }] })) });
    expect(await port.getTracking('bg_77')).toEqual({ ok: true, value: { state: 'in_transit', etaAt: null, location: null, trackingUrl: 'https://t.example/1' } });
  });

  it('the production host is used in production mode', async () => {
    const { port, calls } = adapter({ 'GET /v2/orders/bg_77': () => json(200, order()) }, { mode: 'production' });
    await port.getDelivery('bg_77');
    expect(calls[0].url).toBe('https://api.bobgo.co.za/v2/orders/bg_77');
  });
});
