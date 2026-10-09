/**
 * WumDrop adapter (Phase 4 milestone 4D), against a mocked fetch only: no
 * network, no real keys. Covers Basic auth, create with order_reference, the
 * duplicate-reference path (a refusal is checked by lookup before it counts),
 * lookup by our reference, unknown vs rejected, rands → cents, cancel and the
 * fail-closed webhook parser.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CreateDeliveryRequest, DeliveryQuoteRequest } from '@/lib/core/delivery/port';
import { CircuitBreaker, type FetchLike } from '@/lib/delivery/http';
import {
  WUMDROP_CAPABILITIES,
  createWumdropAdapter,
  createWumdropWebhookParser,
  mapWumdropStatus,
  randsToCents,
  wumdropConfigFromEnv,
  wumdropWebhookParser,
  type WumdropConfig,
} from '@/lib/delivery/wumdrop';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW = { start: null, end: null };

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

function adapter(routes: Record<string, Handler>, over: Partial<WumdropConfig> = {}) {
  const f = fakeFetch(routes);
  const port = createWumdropAdapter({
    mode: 'sandbox',
    apiKey: 'wd-key',
    fetchImpl: f.fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('wd-test', { failureThreshold: 100, cooldownMs: 1_000 }),
    timeoutsMs: { read: 30, create: 30, cancel: 30 },
    ...over,
  });
  return { port, calls: f.calls };
}

const POINT = { lat: -26.1929, lng: 28.0305, suburb: 'Braamfontein', city: 'Johannesburg', postalCode: '2001', province: 'Gauteng' };
const POINT_B = { lat: -26.1076, lng: 28.0567, suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196', province: 'Gauteng' };
const ITEMS = [
  { rentalId: 'cam-1', bookingId: 'bk-1', driverLabel: 'Camera equipment', replacementValueCents: 1_500_000, weightGrams: 2000, containsLithium: true },
  { rentalId: 'lens-1', bookingId: 'bk-2', driverLabel: 'Camera equipment', replacementValueCents: 800_000, weightGrams: 900, containsLithium: false },
];
const quoteReq: DeliveryQuoteRequest = { from: POINT, to: POINT_B, window: WINDOW, items: ITEMS, leg: 'outbound' };
const REF = 'tvd_group1_o1';
const createReq: CreateDeliveryRequest = {
  merchantReference: REF,
  leg: 'outbound',
  quote: { providerId: 'wumdrop', providerQuoteRef: null, providerCostCents: 9000, expiresAt: NOW.toISOString(), window: WINDOW },
  from: { ...POINT, placeId: 'p1', formattedAddress: '99 Smith Street, Braamfontein', contactName: 'Desk', contactPhone: '+27110000000', instructions: null },
  to: { ...POINT_B, placeId: 'p2', formattedAddress: '1 Test Road, Sandton', contactName: 'Thandi', contactPhone: '+27110000001', instructions: 'Gate 2' },
  items: ITEMS,
  window: WINDOW,
  requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null },
};
const job = (over: Record<string, unknown> = {}) => ({ id: 'wd_77', order_reference: REF, status: 'new', created_at: '2026-10-10T08:00:00Z', ...over });

describe('WumDrop: configuration and capabilities', () => {
  it('reads the key per mode', () => {
    expect(wumdropConfigFromEnv({ WUMDROP_API_KEY: 'live', WUMDROP_SANDBOX_API_KEY: 'sb' }, 'sandbox').apiKey).toBe('sb');
    expect(wumdropConfigFromEnv({ WUMDROP_API_KEY: 'live' }, 'production').apiKey).toBe('live');
    expect(wumdropConfigFromEnv({ WUMDROP_API_KEY: 'live' }, 'sandbox').apiKey).toBeNull();
  });

  it('is honest: idempotent create yes; cover, pickup confirmation, hand-to-hand and webhooks no', () => {
    expect(WUMDROP_CAPABILITIES).toMatchObject({
      idempotentCreate: true,
      proofOfDelivery: true,
      verifiedTransitCover: false,
      pickupConfirmation: false,
      noLeaveAtDoor: false,
      trackingWebhooks: false,
      recipientPin: false,
    });
  });

  it('refuses without calling anything when the key is missing', async () => {
    const { port, calls } = adapter({}, { apiKey: null });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('not configured') });
    expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: false, kind: 'rejected' });
    expect(calls).toHaveLength(0);
  });
});

describe('WumDrop: quote', () => {
  it('converts the rand price to integer cents without float drift', async () => {
    const { port, calls } = adapter({ 'POST /v1/quotes': () => json(200, { id: 'wq_1', price: '89.90' }) });
    expect(await port.quote(quoteReq)).toEqual({ ok: true, value: { providerId: 'wumdrop', providerQuoteRef: 'wq_1', providerCostCents: 8990, expiresAt: '2026-10-10T08:15:00.000Z', window: WINDOW } });
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('wd-key:').toString('base64')}`);
  });

  it('randsToCents', () => {
    expect(randsToCents(0.1 + 0.2)).toBe(30);
    expect(randsToCents(89.9)).toBe(8990);
    expect(randsToCents('120')).toBe(12000);
    expect(randsToCents('120.5')).toBe(12050);
    expect(randsToCents('12.345')).toBeNull();
    expect(randsToCents('-5')).toBeNull();
    expect(randsToCents(-1)).toBeNull();
    expect(randsToCents(null)).toBeNull();
    expect(randsToCents('R50')).toBeNull();
  });

  it('a quote without a usable price is unknown', async () => {
    expect(await adapter({ 'POST /v1/quotes': () => json(200, { id: 'wq_1' }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
  });
});

describe('WumDrop: create', () => {
  it('sends order_reference = our merchant reference and a generic label only', async () => {
    const { port, calls } = adapter({ 'POST /v1/deliveries': () => json(201, job()) });
    expect(await port.createDelivery(createReq)).toEqual({
      ok: true,
      value: { providerReference: 'wd_77', merchantReference: REF, state: 'unknown', stateAt: '2026-10-10T08:00:00.000Z', trackingUrl: null, courierName: null, proof: [] },
    });
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body).toMatchObject({ order_reference: REF, parcel_description: 'Camera equipment', parcel_count: 2 });
    expect(JSON.stringify(body)).not.toMatch(/1500000|800000/);
  });

  it('a duplicate-reference refusal returns the job that already exists (no second courier)', async () => {
    const { port, calls } = adapter({
      'POST /v1/deliveries': () => json(422, { message: 'order_reference has already been taken' }),
      [`GET /v1/deliveries/ext/${REF}`]: () => json(200, job({ status: 'delivered' })),
    });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: true, value: { providerReference: 'wd_77', merchantReference: REF, state: 'delivered' } });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /v1/deliveries', `GET /v1/deliveries/ext/${REF}`]);
  });

  it('a refusal with no job under our reference is a definite refusal', async () => {
    const { port } = adapter({ 'POST /v1/deliveries': () => json(400, { message: 'address outside service area' }) });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('service area') });
  });

  it('a refusal whose lookup does not answer is unknown', async () => {
    const { port } = adapter({ 'POST /v1/deliveries': () => json(400, { message: 'bad' }), [`GET /v1/deliveries/ext/${REF}`]: () => 'hang' });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it.each([
    ['timeout', (): 'hang' => 'hang'],
    ['500', () => json(500, {})],
    ['429', () => json(429, {})],
    ['409', () => json(409, { message: 'duplicate' })],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['201 without an id', () => json(201, { ok: true })],
  ] as const)('%s on create is unknown, with no retry and no lookup', async (_name, handler) => {
    const { port, calls } = adapter({ 'POST /v1/deliveries': handler as Handler });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it('401 on create is a configuration refusal without a lookup', async () => {
    const { port, calls } = adapter({ 'POST /v1/deliveries': () => json(401, { message: 'unauthorised' }) });
    expect(await port.createDelivery(createReq)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('configuration') });
    expect(calls).toHaveLength(1);
  });
});

describe('WumDrop: lookup by our reference', () => {
  it('found → the job; 404 → definitely none', async () => {
    const found = adapter({ [`GET /v1/deliveries/ext/${REF}`]: () => json(200, job()) });
    expect(await found.port.findByMerchantReference(REF)).toMatchObject({ ok: true, value: { providerReference: 'wd_77', merchantReference: REF } });
    const none = adapter({});
    expect(await none.port.findByMerchantReference(REF)).toEqual({ ok: true, value: null });
  });

  it('anything else is unknown, never "not found"', async () => {
    for (const h of [() => json(500, {}), () => json(401, {}), () => json(400, {}), (): 'hang' => 'hang', () => json(200, { nothing: true })] as Handler[]) {
      const { port } = adapter({ [`GET /v1/deliveries/ext/${REF}`]: h });
      expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: false, kind: 'unknown' });
    }
  });

  it('a job under a different reference is not ours', async () => {
    const { port } = adapter({ [`GET /v1/deliveries/ext/${REF}`]: () => json(200, job({ order_reference: 'someone_else' })) });
    expect(await port.findByMerchantReference(REF)).toMatchObject({ ok: false, kind: 'unknown' });
  });
});

describe('WumDrop: get, cancel, tracking', () => {
  it('maps only unambiguous statuses', () => {
    expect(mapWumdropStatus('Delivered')).toBe('delivered');
    expect(mapWumdropStatus('cancelled')).toBe('cancelled');
    expect(mapWumdropStatus('in_progress')).toBe('unknown');
  });

  it('proof of delivery is kept as references only', async () => {
    const { port } = adapter({ 'GET /v1/deliveries/wd_77': () => json(200, job({ status: 'delivered', proof_of_delivery: { signature: 'https://img/s.png', image: 'https://img/p.png', id_number: '8001015009087' } })) });
    const r = await port.getDelivery('wd_77');
    expect(r).toMatchObject({ ok: true, value: { proof: [{ kind: 'signature', ref: 'wumdrop:wd_77:signature' }, { kind: 'photo', ref: 'wumdrop:wd_77:photo' }] } });
    expect(JSON.stringify(r)).not.toMatch(/img\/|8001015009087/);
  });

  it('cancel uses DELETE; an unrecognised answer is unknown, a refusal is rejected', async () => {
    const ok = adapter({ 'DELETE /v1/deliveries/wd_77': () => new Response(null, { status: 204 }) });
    expect(await ok.port.cancelDelivery('wd_77', 'renter cancelled')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    const said = adapter({ 'DELETE /v1/deliveries/wd_77': () => json(200, job({ status: 'cancelled' })) });
    expect(await said.port.cancelDelivery('wd_77', 'x')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    const odd = adapter({ 'DELETE /v1/deliveries/wd_77': () => json(200, job({ status: 'collected' })) });
    expect(await odd.port.cancelDelivery('wd_77', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    const late = adapter({ 'DELETE /v1/deliveries/wd_77': () => json(422, { message: 'already collected' }) });
    expect(await late.port.cancelDelivery('wd_77', 'x')).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('tracking never invents an ETA or location', async () => {
    const { port } = adapter({ 'GET /v1/deliveries/wd_77': () => json(200, job({ status: 'delivered', tracking_url: 'https://wd.example/t/1' })) });
    expect(await port.getTracking('wd_77')).toEqual({ ok: true, value: { state: 'delivered', etaAt: null, location: null, trackingUrl: 'https://wd.example/t/1' } });
  });
});

describe('WumDrop: webhooks fail closed', () => {
  const body = JSON.stringify({ event_id: 'e1', delivery: { id: 'wd_77', order_reference: REF, status: 'delivered', updated_at: '2026-10-10T09:00:00Z', recipient_phone: '+27110000001' } });

  it('refuses every request when no signing scheme is configured (the default)', () => {
    const p = wumdropWebhookParser({ WUMDROP_API_KEY: 'k' });
    for (const headers of [{}, { 'x-wumdrop-signature': createHmac('sha256', 'k').update(body).digest('hex') }, { authorization: 'Basic abc' }] as Record<string, string>[]) {
      expect(p.verify(body, headers)).toBe(false);
    }
    expect(createWumdropWebhookParser({ scheme: null }).verify(body, { 'x-signature': 'anything' })).toBe(false);
  });

  it('verifies once a scheme is configured in code (after WumDrop confirms one)', () => {
    const p = createWumdropWebhookParser({ scheme: { algorithm: 'hmac-sha256-hex', header: 'X-Test-Signature', secret: 's3cret' } });
    const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(p.verify(body, { 'x-test-signature': sig })).toBe(true);
    expect(p.verify(`${body} `, { 'x-test-signature': sig })).toBe(false);
    expect(p.verify(body, { 'x-test-signature': createHmac('sha256', 'wrong').update(body).digest('hex') })).toBe(false);
    expect(createWumdropWebhookParser({ scheme: { algorithm: 'hmac-sha256-hex', header: 'X-Test-Signature', secret: '' } }).verify(body, { 'x-test-signature': sig })).toBe(false);
  });

  it('parses ids, status and time only', () => {
    const parsed = createWumdropWebhookParser({ scheme: null }).parse(body);
    expect(parsed).toEqual({
      eventId: 'e1',
      merchantReference: REF,
      providerReference: 'wd_77',
      state: 'delivered',
      stateAt: '2026-10-10T09:00:00.000Z',
      trackingUrl: null,
      courierName: null,
      proof: [],
      minimal: { providerReference: 'wd_77', merchantReference: REF, status: 'delivered', stateAt: '2026-10-10T09:00:00.000Z' },
    });
    expect(JSON.stringify(parsed)).not.toContain('+27');
    expect(createWumdropWebhookParser({ scheme: null }).parse('nope')).toBeNull();
  });
});
