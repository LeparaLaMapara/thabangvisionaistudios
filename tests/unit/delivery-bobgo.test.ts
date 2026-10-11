/**
 * Bob Go adapter (courier aggregator), against a mocked fetch only: no
 * network, no real keys. The mocked answers copy the shapes the Bob Go
 * sandbox returned on 2026-10-11 (lib/delivery/bobgo/api-contract.ts).
 * Covers quote (approved courier + service level only, rands → cents),
 * create under our reference (a refusal is checked by lookup; Bob Go books
 * duplicates, so the adapter never retries), find-by-reference (never
 * "none"), read, cancel, status mapping (unknown words stay 'unknown'),
 * error classification and the not-configured path.
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
  bobgoServiceLevelKey,
  createBobgoAdapter,
  mapBobgoStatus,
  parseBobgoServiceLevelKey,
  type BobgoConfig,
} from '@/lib/delivery/bobgo';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW = { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T12:00:00.000Z' };
const SB = 'https://api.sandbox.bobgo.co.za';
const LEVEL = 'testcourier:H2H';

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
    approvedServiceLevels: [LEVEL],
    fetchImpl: f.fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('bg-test', { failureThreshold: 100, cooldownMs: 1_000 }),
    timeoutsMs: { read: 30, quote: 30, create: 30, cancel: 30 },
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
/** A shipment as the sandbox returns it (trimmed). */
const shipment = (over: Record<string, unknown> = {}) => ({
  id: 18978,
  tracking_reference: 'UASS93F8',
  custom_tracking_reference: REF,
  status: 'pending-collection',
  submission_status: 'success',
  provider_slug: 'testcourier',
  service_level_code: 'H2H',
  rate: 114.95,
  time_created: '2026-10-10T08:00:00Z',
  time_modified: '2026-10-10T08:00:01Z',
  ...over,
});
/** A rates answer as the sandbox returns it (trimmed). */
const ratesBody = (providers: { slug: string; status?: string; rates: [string, unknown, string?][] }[]) => ({
  id: 525942,
  provider_rate_requests: providers.map((p) => ({
    provider_slug: p.slug,
    status: p.status ?? 'success',
    responses: p.rates.map(([code, amount, status]) => ({ service_level_code: code, rate_amount: amount, rate_amount_excl_vat: 0, status: status ?? 'success' })),
  })),
});
const RATES = 'POST /v2/rates';
const CREATE = 'POST /v2/shipments';
const LIST = 'GET /v2/shipments';
const CANCEL = 'POST /v2/shipments/cancel';

describe('Bob Go: configuration, contract and capabilities', () => {
  it('reads the key per mode, never the other mode', () => {
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live', BOBGO_SANDBOX_API_KEY: 'sb' }, 'sandbox').apiKey).toBe('sb');
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live' }, 'production').apiKey).toBe('live');
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: 'live' }, 'sandbox').apiKey).toBeNull();
    expect(bobgoConfigFromEnv({ BOBGO_SANDBOX_API_KEY: 'sb' }, 'production').apiKey).toBeNull();
    expect(bobgoConfigFromEnv({ BOBGO_API_KEY: '  ' }, 'production').apiKey).toBeNull();
  });

  it('claims NO capability: nothing is confirmed in writing, and creates are proven not idempotent', () => {
    expect(BOBGO_CAPABILITIES).toEqual(NO_DELIVERY_CAPABILITIES);
  });

  it('ships closed: no approved service level, no lithium, no webhook signing', () => {
    expect(BOBGO_CONTRACT.approvedServiceLevels).toEqual([]);
    expect(BOBGO_CONTRACT.lithiumAccepted).toBe(false);
    expect(BOBGO_CONTRACT.webhookSigning).toBeNull();
    expect(BOBGO_CONTRACT.baseUrl.production).toBe('https://api.bobgo.co.za/v2');
    expect(BOBGO_CONTRACT.baseUrl.sandbox).toBe('https://api.sandbox.bobgo.co.za/v2');
    // Every item is tagged with where it came from; business decisions stay "assumed".
    expect(BOBGO_CONTRACT_SOURCES['paths.createShipment']).toBe('sandbox');
    expect(BOBGO_CONTRACT_SOURCES.approvedServiceLevels).toBe('assumed');
    expect(BOBGO_CONTRACT_SOURCES['baseUrl.production']).toBe('docs');
  });

  it('service level keys are provider:code', () => {
    expect(bobgoServiceLevelKey('thecourierguy', 'ECO')).toBe('thecourierguy:ECO');
    expect(parseBobgoServiceLevelKey('thecourierguy:ECO')).toEqual({ providerSlug: 'thecourierguy', serviceLevelCode: 'ECO' });
    for (const bad of ['ECO', ':ECO', 'tcg:', 'a:b:c', 'a b:c', '', null, undefined]) expect(parseBobgoServiceLevelKey(bad)).toBeNull();
  });

  it('without a key, refuses every call and sends nothing', async () => {
    const { port, calls } = adapter({}, { apiKey: null });
    const notConfigured = { ok: false, kind: 'rejected', message: expect.stringContaining('not configured') };
    expect(await port.checkServiceability(quoteReq)).toMatchObject(notConfigured);
    expect(await port.quote(quoteReq)).toMatchObject(notConfigured);
    expect(await port.createDelivery(createReq())).toMatchObject(notConfigured);
    expect(await port.findByMerchantReference(REF)).toMatchObject(notConfigured);
    expect(await port.getDelivery('UASS93F8')).toMatchObject(notConfigured);
    expect(await port.cancelDelivery('UASS93F8', 'x')).toMatchObject(notConfigured);
    expect(await port.getTracking('UASS93F8')).toMatchObject(notConfigured);
    expect(calls).toHaveLength(0);
  });

  it('labels itself a sandbox courier in sandbox mode', () => {
    const { port } = adapter({});
    expect(port).toMatchObject({ providerId: 'bobgo', kind: 'courier', mode: 'sandbox' });
  });
});

describe('Bob Go: serviceability and quote', () => {
  it('with the shipped (empty) approved list, nothing is quoted and nothing is sent', async () => {
    const { port, calls } = adapter({ [RATES]: () => json(200, ratesBody([{ slug: 'any', rates: [['ECO', 50]] }])) }, { approvedServiceLevels: undefined });
    expect(await port.checkServiceability(quoteReq)).toEqual({ ok: true, value: { serviceable: false, reason: 'no_approved_service_level' } });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('no_approved_service_level') });
    expect(calls).toHaveLength(0);
  });

  it('lithium batteries are refused locally until Bob Go confirms them in writing', async () => {
    const { port, calls } = adapter({ [RATES]: () => json(200, ratesBody([])) });
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

  it('picks the cheapest APPROVED courier + service level (never a cheaper unapproved one) and converts rands to cents', async () => {
    const { port, calls } = adapter(
      {
        [RATES]: () =>
          json(
            200,
            ratesBody([
              { slug: 'pargo', rates: [['H2H', 30]] }, // same code, unapproved courier
              { slug: 'testcourier', rates: [['ECO', 20], ['H2H', '89.90'], ['H2H_FAIL', 10, 'failed']] },
              { slug: 'other', rates: [['FAST', 120]] },
              { slug: 'slow', status: 'pending', rates: [] },
            ]),
          ),
      },
      { approvedServiceLevels: [LEVEL, 'other:FAST', 'testcourier:H2H_FAIL'] },
    );
    expect(await port.quote(quoteReq)).toEqual({
      ok: true,
      value: { providerId: 'bobgo', providerQuoteRef: LEVEL, providerCostCents: 8990, expiresAt: '2026-10-10T08:15:00.000Z', window: WINDOW },
    });
    expect(calls[0].url).toBe(`${SB}/v2/rates`);
    expect(calls[0].headers.Authorization).toBe('Bearer bg-key');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body.collection_address).toMatchObject({ local_area: 'Braamfontein', city: 'Johannesburg', zone: 'Gauteng', code: '2001', country: 'ZA', lat: POINT.lat, lng: POINT.lng });
    // One parcel per unit carried, each with the unit weight; no quantity field.
    expect(body.parcels).toEqual([
      { description: 'Camera equipment', submitted_weight_kg: 2 },
      { description: 'Camera equipment', submitted_weight_kg: 2 },
      { description: 'Camera equipment' },
    ]);
    // Bob Go is told to wait for the couriers, or a slow one answers "pending".
    expect(body.timeout).toBe(BOBGO_CONTRACT.courierTimeoutMs.rates);
    // No value ever leaves for a rate request.
    expect(JSON.stringify(body)).not.toMatch(/1500000|800000|15000|8000|declared/);
  });

  it('a rate of zero, a pending courier and a failed rate are never chosen', async () => {
    const { port } = adapter({
      [RATES]: () => json(200, ratesBody([{ slug: 'testcourier', rates: [['H2H', 0]] }, { slug: 'testcourier', status: 'pending', rates: [['H2H', 50]] }])),
    });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('no approved service level') });
  });

  it('only unapproved levels on offer → a definite refusal', async () => {
    const { port } = adapter({ [RATES]: () => json(200, ratesBody([{ slug: 'pargo', rates: [['PICKUP', 30]] }])) });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('no approved service level') });
  });

  it('an unreadable rates answer is unknown; errors are classified', async () => {
    expect(await adapter({ [RATES]: () => json(200, { nothing: true }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [RATES]: () => json(400, { message: 'Field items is required.' }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected', message: 'HTTP 400: Field items is required.' });
    expect(await adapter({ [RATES]: () => json(503, {}) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [RATES]: () => 'hang' }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringContaining('timed out') });
  });

  it('bobgoRandsToCents', () => {
    expect(bobgoRandsToCents(0.1 + 0.2)).toBe(30);
    expect(bobgoRandsToCents(114.95)).toBe(11495);
    expect(bobgoRandsToCents('120.5')).toBe(12050);
    expect(bobgoRandsToCents('12.345')).toBeNull();
    expect(bobgoRandsToCents(-1)).toBeNull();
    expect(bobgoRandsToCents('R50')).toBeNull();
    expect(bobgoRandsToCents(null)).toBeNull();
  });
});

describe('Bob Go: create a shipment under our reference', () => {
  it('sends our reference, the approved courier and service level; generic label, no value, no declared value', async () => {
    const { port, calls } = adapter({ [CREATE]: () => json(200, shipment()) });
    expect(await port.createDelivery(createReq())).toEqual({
      ok: true,
      value: { providerReference: 'UASS93F8', merchantReference: REF, state: 'unknown', stateAt: '2026-10-10T08:00:01.000Z', trackingUrl: null, courierName: null, proof: [] },
    });
    expect(calls[0].url).toBe(`${SB}/v2/shipments`);
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body).toMatchObject({
      custom_tracking_reference: REF,
      provider_slug: 'testcourier',
      service_level_code: 'H2H',
      collection_contact_name: 'Desk',
      collection_contact_mobile_number: '+27110000000',
      delivery_contact_name: 'Thandi',
      delivery_contact_mobile_number: '+27110000001',
      instructions_delivery: 'Gate 2',
      timeout: BOBGO_CONTRACT.courierTimeoutMs.create,
    });
    expect(body).not.toHaveProperty('instructions_collection');
    expect(body.delivery_address.street_address).toBe('1 Test Road, Sandton');
    expect(body.parcels).toHaveLength(3);
    expect(JSON.stringify(body)).not.toMatch(/1500000|800000|2300000|declared/);
  });

  it('refuses, without sending, a quote that is not for an approved service level', async () => {
    const { port, calls } = adapter({ [CREATE]: () => json(200, shipment()) });
    const q = createReq().quote;
    for (const ref of ['pargo:H2H', 'H2H', null, 'testcourier:H2H:x']) {
      expect(await port.createDelivery(createReq({ quote: { ...q, providerQuoteRef: ref } }))).toMatchObject({ ok: false, kind: 'rejected' });
    }
    expect(calls).toHaveLength(0);
  });

  it('a shipment Bob Go recorded but did not submit to the courier is unknown (staff check)', async () => {
    for (const submission of ['', 'pending', 'failed', null]) {
      const { port } = adapter({ [CREATE]: () => json(200, shipment({ status: '', submission_status: submission, rate: 0 })) });
      expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringContaining('did not submit') });
    }
  });

  it('Bob Go books duplicates, so a create is sent once and never retried', async () => {
    let n = 0;
    const { port, calls } = adapter({ [CREATE]: () => json(200, shipment({ tracking_reference: `UAS${++n}` })) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: true, value: { providerReference: 'UAS1' } });
    expect(calls).toHaveLength(1);
  });

  it('a refusal that turns out to have booked (an earlier attempt) returns that shipment: one courier', async () => {
    const { port, calls } = adapter({
      [CREATE]: () => json(400, { message: 'some refusal' }),
      [LIST]: () => json(200, { shipments: [shipment()], count: 1 }),
    });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: true, value: { providerReference: 'UASS93F8', merchantReference: REF } });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual(['POST /v2/shipments', `GET /v2/shipments?tracking_reference=${REF}`]);
  });

  it('a refusal with no shipment of ours in the lookup is a definite refusal', async () => {
    const { port } = adapter({ [CREATE]: () => json(400, { message: 'address outside service area' }), [LIST]: () => json(200, { shipments: [], count: 0 }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('service area') });
  });

  it('a lookup that ignores our filter cannot hand us someone else’s shipment', async () => {
    const { port } = adapter({
      [CREATE]: () => json(400, { message: 'bad' }),
      [LIST]: () => json(200, { shipments: [shipment({ tracking_reference: 'UASOTHER', custom_tracking_reference: 'someone_else' })], count: 1 }),
    });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: 'HTTP 400: bad' });
  });

  it('a refusal whose lookup does not answer is unknown', async () => {
    for (const h of [(): 'hang' => 'hang', () => json(500, {}), () => json(404, {})] as Handler[]) {
      const { port } = adapter({ [CREATE]: () => json(400, { message: 'bad' }), [LIST]: h });
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
    ['200 without a tracking reference', () => json(200, { ok: true })],
  ] as const)('%s on create is unknown, with no retry and no lookup', async (_name, handler) => {
    const { port, calls } = adapter({ [CREATE]: handler as Handler });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it.each([401, 403])('%s on create is a configuration refusal, without a lookup', async (status) => {
    const { port, calls } = adapter({ [CREATE]: () => json(status, { message: 'Authentication failed, please check your API key.' }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('configuration') });
    expect(calls).toHaveLength(1);
  });
});

describe('Bob Go: find by our reference never says "none"', () => {
  it('a shipment echoing our reference exactly is returned (list or bare array)', async () => {
    for (const body of [{ shipments: [shipment()], count: 1 }, [shipment()]]) {
      const { port, calls } = adapter({ [LIST]: () => json(200, body) });
      expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: true, value: { providerReference: 'UASS93F8', merchantReference: REF } });
      expect(new URL(calls[0].url).searchParams.get('tracking_reference')).toBe(REF);
    }
  });

  it('duplicates: the one live shipment is ours; the cancelled ones book nobody', async () => {
    const { port } = adapter({
      [LIST]: () => json(200, { shipments: [shipment({ tracking_reference: 'UASOLD', status: 'cancelled' }), shipment({ tracking_reference: 'UASLIVE' })], count: 2 }),
    });
    expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: true, value: { providerReference: 'UASLIVE' } });
  });

  it('two live shipments under our reference, or two cancelled ones, are unknown', async () => {
    for (const statuses of [['pending-collection', 'collected'], ['cancelled', 'cancelled']]) {
      const { port } = adapter({ [LIST]: () => json(200, { shipments: statuses.map((s, i) => shipment({ tracking_reference: `UAS${i}`, status: s })), count: 2 }) });
      expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringContaining('2 shipments') });
    }
  });

  it('empty, 404, someone else’s shipment, errors and timeouts are all unknown', async () => {
    const cases: Handler[] = [
      () => json(200, { shipments: [], count: 0 }),
      () => json(200, []),
      () => json(404, { message: 'not found' }),
      () => json(200, { shipments: [shipment({ custom_tracking_reference: 'other' })], count: 1 }),
      () => json(400, {}),
      () => json(401, {}),
      () => json(500, {}),
      () => json(200, null),
      (): 'hang' => 'hang',
    ];
    for (const h of cases) {
      const { port } = adapter({ [LIST]: h });
      expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: false, kind: 'unknown' });
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
    for (const s of ['collected', 'submitted', 'collection-assigned', 'pending-collection', 'out-for-delivery', 'returned', 'exception', '', '  ', 'DELIVERED-ish', 3, null, undefined, { status: 'delivered' }]) {
      expect(mapBobgoStatus(s)).toBe('unknown');
    }
  });

  it('reads a shipment; no tracking reference means nothing to read', () => {
    expect(bobgoDelivery(shipment({ status: 'delivered' }), null)).toMatchObject({ providerReference: 'UASS93F8', merchantReference: REF, state: 'delivered' });
    expect(bobgoDelivery(shipment({ custom_tracking_reference: undefined }), 'fallback')).toMatchObject({ merchantReference: 'fallback' });
    expect(bobgoDelivery({ status: 'delivered', custom_tracking_reference: REF }, REF)).toBeNull();
    expect(bobgoDelivery(null, REF)).toBeNull();
  });

  it('keeps no names, phone numbers or proof images from the shipment', async () => {
    const { port } = adapter({
      [LIST]: () => json(200, { shipments: [shipment({ status: 'delivered', delivery_contact_name: 'Sipho Ndlovu', delivery_contact_mobile_number: '+27110000001', pod: { signature: 'https://img/s.png' } })], count: 1 }),
    });
    const r = await port.getDelivery('UASS93F8');
    expect(r).toMatchObject({ ok: true, value: { state: 'delivered', courierName: null, proof: [] } });
    expect(JSON.stringify(r)).not.toMatch(/Sipho|\+27|img\//);
  });
});

describe('Bob Go: read, cancel, tracking', () => {
  it('read: Bob Go’s own reference, exact match only; none is a definite refusal, errors unknown', async () => {
    const ok = adapter({ [LIST]: () => json(200, { shipments: [shipment({ tracking_reference: 'UASX' }), shipment()], count: 2 }) });
    expect(await ok.port.getDelivery('UASS93F8')).toMatchObject({ ok: true, value: { providerReference: 'UASS93F8' } });
    expect(new URL(ok.calls[0].url).searchParams.get('tracking_reference')).toBe('UASS93F8');
    expect(await adapter({ [LIST]: () => json(200, { shipments: [], count: 0 }) }).port.getDelivery('NOPE')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ [LIST]: () => json(500, {}) }).port.getDelivery('UASS93F8')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [LIST]: () => json(200, { shipments: [{ nothing: 1 }], count: 1 }) }).port.getDelivery('UASS93F8')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('cancel: POST with the tracking reference; only a "cancelled" answer counts', async () => {
    const ok = adapter({ [CANCEL]: () => json(200, shipment({ status: 'cancelled', charged_amount: 0 })) });
    expect(await ok.port.cancelDelivery('UASS93F8', 'renter cancelled')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    expect(ok.calls[0]).toMatchObject({ method: 'POST', url: `${SB}/v2/shipments/cancel` });
    expect(JSON.parse(ok.calls[0].body ?? '{}')).toEqual({ tracking_reference: 'UASS93F8' });
    // An empty 2xx or another status proves nothing: unknown (staff check, no refund on a guess).
    expect(await adapter({ [CANCEL]: () => new Response(null, { status: 204 }) }).port.cancelDelivery('UASS93F8', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [CANCEL]: () => json(200, shipment({ status: 'in-transit' })) }).port.cancelDelivery('UASS93F8', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    // The sandbox's own refusals: already cancelled, unknown reference.
    expect(await adapter({ [CANCEL]: () => json(400, { message: 'The shipment cannot be cancelled, as it has not been submitted successfully.' }) }).port.cancelDelivery('UASS93F8', 'x')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ [CANCEL]: () => json(400, { message: 'Shipment with tracking reference NOPE not found.' }) }).port.cancelDelivery('NOPE', 'x')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ [CANCEL]: () => json(500, {}) }).port.cancelDelivery('UASS93F8', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ [CANCEL]: () => 'hang' }).port.cancelDelivery('UASS93F8', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('tracking never invents an ETA, location or link', async () => {
    const { port } = adapter({ [LIST]: () => json(200, { shipments: [shipment({ status: 'in-transit' })], count: 1 }) });
    expect(await port.getTracking('UASS93F8')).toEqual({ ok: true, value: { state: 'in_transit', etaAt: null, location: null, trackingUrl: null } });
  });

  it('the production host is used in production mode', async () => {
    const { port, calls } = adapter({ [LIST]: () => json(200, { shipments: [shipment()], count: 1 }) }, { mode: 'production' });
    await port.getDelivery('UASS93F8');
    expect(calls[0].url).toBe('https://api.bobgo.co.za/v2/shipments?tracking_reference=UASS93F8');
  });
});
