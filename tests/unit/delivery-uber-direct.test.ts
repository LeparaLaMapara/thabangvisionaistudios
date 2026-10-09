/**
 * Uber Direct adapter (Phase 4 milestone 4B), against a mocked fetch only:
 * no network, no real keys. Covers auth/token caching, quote in cents with the
 * 15-minute expiry, the create request (our reference, hand-to-hand,
 * verification), error classification (unknown vs rejected), the "no lookup
 * by our reference" rule, cancel, tracking, the circuit breaker and the
 * signed webhook parser.
 */
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateDeliveryRequest, DeliveryQuoteRequest } from '@/lib/core/delivery/port';
import { CircuitBreaker, classifyHttpStatus, type FetchLike } from '@/lib/delivery/http';
import {
  UBER_DIRECT_CAPABILITIES,
  createUberDirectAdapter,
  createUberDirectWebhookParser,
  mapUberStatus,
  resetUberDirectTokenCache,
  uberDirectConfigFromEnv,
  uberDirectWebhookParser,
  type UberDirectConfig,
} from '@/lib/delivery/uber-direct';

const NOW = new Date('2026-10-10T08:00:00.000Z');
const WINDOW = { start: '2026-10-20T07:00:00.000Z', end: '2026-10-20T09:00:00.000Z' };

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

/** A scripted fetch: routes by "METHOD path-suffix" and records every call. */
function fakeFetch(routes: Record<string, Handler>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { method: String(init.method), url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, suffix] = k.split(' ');
      return m === call.method && new URL(url).pathname.endsWith(suffix);
    });
    if (!key) return json(404, { message: 'no route' });
    const out = routes[key](call);
    if (out === 'hang') {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return out;
  };
  return { fetch, calls };
}

const tokenOk: Handler = () => json(200, { access_token: 'tok-1', expires_in: 2592000, token_type: 'Bearer', scope: 'eats.deliveries' });

function adapter(routes: Record<string, Handler>, over: Partial<UberDirectConfig> = {}) {
  const f = fakeFetch({ 'POST /oauth/v2/token': tokenOk, ...routes });
  const port = createUberDirectAdapter({
    mode: 'sandbox',
    clientId: 'cid',
    clientSecret: 'secret',
    customerId: 'cust-1',
    fetchImpl: f.fetch,
    now: () => NOW,
    breaker: new CircuitBreaker('test', { failureThreshold: 100, cooldownMs: 1_000 }),
    timeoutsMs: { token: 30, read: 30, create: 30, cancel: 30 },
    ...over,
  });
  return { port, calls: f.calls };
}

const POINT = { lat: -26.1929, lng: 28.0305, suburb: 'Braamfontein', city: 'Johannesburg', postalCode: '2001', province: 'Gauteng' };
const POINT_B = { lat: -26.1076, lng: 28.0567, suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196', province: 'Gauteng' };
const ITEMS = [{ rentalId: 'cam-1', bookingId: 'bk-1', driverLabel: 'Camera equipment', replacementValueCents: 1_500_000, weightGrams: 2000, containsLithium: true }];

const quoteReq: DeliveryQuoteRequest = { from: POINT, to: POINT_B, window: WINDOW, items: ITEMS, leg: 'outbound' };

function createReq(over: Partial<CreateDeliveryRequest['requirements']> = {}): CreateDeliveryRequest {
  return {
    merchantReference: 'tvd_group1_o1',
    leg: 'outbound',
    quote: { providerId: 'uber_direct', providerQuoteRef: 'dqt_1', providerCostCents: 4599, expiresAt: NOW.toISOString(), window: WINDOW },
    from: { ...POINT, placeId: 'p1', formattedAddress: '99 Smith Street, Braamfontein', contactName: 'Desk', contactPhone: '+27110000000', instructions: null },
    to: { ...POINT_B, placeId: 'p2', formattedAddress: '1 Test Road, Sandton', contactName: 'Thandi', contactPhone: '+27110000001', instructions: 'Gate 2' },
    items: ITEMS,
    window: WINDOW,
    requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null, ...over },
  };
}

const delivery = (over: Record<string, unknown> = {}) => ({
  id: 'del_abc',
  external_id: 'tvd_group1_o1',
  status: 'pending',
  tracking_url: 'https://track.example/del_abc',
  courier: { name: 'Sipho Dlamini', phone_number: '+27000000000', location: { lat: -26.15, lng: 28.04 } },
  dropoff: { name: 'Thandi', phone_number: '+27110000001', address: '1 Test Road' },
  created: '2026-10-10T08:00:00Z',
  updated: '2026-10-10T08:01:00Z',
  ...over,
});

beforeEach(() => resetUberDirectTokenCache());

describe('Uber Direct: configuration and capabilities', () => {
  it('reads credentials per mode, so sandbox never picks up live keys', () => {
    const env = { UBER_DIRECT_CLIENT_ID: 'live', UBER_DIRECT_CLIENT_SECRET: 'live-s', UBER_DIRECT_CUSTOMER_ID: 'live-c', UBER_DIRECT_SANDBOX_CLIENT_ID: 'sb' };
    expect(uberDirectConfigFromEnv(env, 'production')).toMatchObject({ clientId: 'live', clientSecret: 'live-s', customerId: 'live-c' });
    expect(uberDirectConfigFromEnv(env, 'sandbox')).toMatchObject({ clientId: 'sb', clientSecret: null, customerId: null });
  });

  it('claims only verified capabilities: no transit cover, no idempotent create', () => {
    expect(UBER_DIRECT_CAPABILITIES.verifiedTransitCover).toBe(false);
    expect(UBER_DIRECT_CAPABILITIES.idempotentCreate).toBe(false);
    expect(UBER_DIRECT_CAPABILITIES.declaredValueSupport).toBe(false);
    expect(UBER_DIRECT_CAPABILITIES.noLeaveAtDoor).toBe(true);
    expect(UBER_DIRECT_CAPABILITIES.pickupConfirmation).toBe(true);
  });

  it('refuses without calling anything when credentials are missing', async () => {
    const { port, calls } = adapter({}, { clientSecret: null });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('not configured') });
    expect(calls).toHaveLength(0);
  });
});

describe('Uber Direct: auth', () => {
  it('uses client credentials with the eats.deliveries scope and caches the token', async () => {
    const { port, calls } = adapter({ 'POST /delivery_quotes': () => json(200, { id: 'dqt_1', fee: 4599, currency_type: 'ZAR', expires: '2026-10-10T08:15:00Z' }) });
    await port.quote(quoteReq);
    await port.quote(quoteReq);
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth/v2/token'));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0].body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('eats.deliveries');
    const api = calls.filter((c) => c.url.includes('/delivery_quotes'));
    expect(api).toHaveLength(2);
    expect(api[0].headers.Authorization).toBe('Bearer tok-1');
    expect(api[0].url).toContain('/v1/customers/cust-1/delivery_quotes');
  });

  it('refreshes an expired token', async () => {
    let t = NOW.getTime();
    let n = 0;
    const { port, calls } = adapter(
      { 'POST /oauth/v2/token': () => json(200, { access_token: `tok-${++n}`, expires_in: 600 }), 'POST /delivery_quotes': () => json(200, { id: 'q', fee: 100 }) },
      { now: () => new Date(t) },
    );
    await port.quote(quoteReq);
    t += 6 * 60_000; // past expiry minus the refresh margin
    await port.quote(quoteReq);
    expect(calls.filter((c) => c.url.includes('/oauth/v2/token'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('/delivery_quotes')).map((c) => c.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('a refused token is a configuration refusal; a token timeout is unknown', async () => {
    const bad = adapter({ 'POST /oauth/v2/token': () => json(401, { error: 'invalid_client' }) });
    expect(await bad.port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('credentials') });
    expect(bad.calls.some((c) => c.url.includes('/deliveries'))).toBe(false);
    resetUberDirectTokenCache();
    const slow = adapter({ 'POST /oauth/v2/token': () => 'hang' });
    expect(await slow.port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('drops the cached token after a 401 from the API, without repeating the call', async () => {
    let first = true;
    const { port, calls } = adapter({
      'POST /delivery_quotes': () => {
        if (first) {
          first = false;
          return json(401, { message: 'token expired' });
        }
        return json(200, { id: 'q', fee: 100 });
      },
    });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected' });
    expect(calls.filter((c) => c.url.includes('/delivery_quotes'))).toHaveLength(1);
    expect(await port.quote(quoteReq)).toMatchObject({ ok: true });
    expect(calls.filter((c) => c.url.includes('/oauth/v2/token'))).toHaveLength(2);
  });
});

describe('Uber Direct: quote', () => {
  it('returns the fee as integer cents and never holds it past 15 minutes', async () => {
    const { port, calls } = adapter({ 'POST /delivery_quotes': () => json(200, { id: 'dqt_9', fee: 4599, currency_type: 'ZAR', expires: '2026-10-10T09:00:00Z' }) });
    const q = await port.quote(quoteReq);
    expect(q).toEqual({ ok: true, value: { providerId: 'uber_direct', providerQuoteRef: 'dqt_9', providerCostCents: 4599, expiresAt: '2026-10-10T08:15:00.000Z', window: WINDOW } });
    const body = JSON.parse(calls.find((c) => c.url.includes('delivery_quotes'))?.body ?? '{}');
    expect(body).toMatchObject({ pickup_latitude: POINT.lat, dropoff_longitude: POINT_B.lng, pickup_ready_dt: WINDOW.start, dropoff_deadline_dt: WINDOW.end });
    expect(JSON.parse(body.pickup_address)).toMatchObject({ city: 'Johannesburg', country: 'ZA' });
  });

  it('keeps an earlier provider expiry', async () => {
    const { port } = adapter({ 'POST /delivery_quotes': () => json(200, { id: 'q', fee: 100, expires: '2026-10-10T08:05:00Z' }) });
    expect(await port.quote(quoteReq)).toMatchObject({ ok: true, value: { expiresAt: '2026-10-10T08:05:00.000Z' } });
  });

  it('a non-integer or missing fee is not a price (unknown); another currency is refused', async () => {
    expect(await adapter({ 'POST /delivery_quotes': () => json(200, { id: 'q', fee: 45.99 }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'POST /delivery_quotes': () => json(200, { id: 'q' }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown' });
    expect(await adapter({ 'POST /delivery_quotes': () => json(200, { id: 'q', fee: 100, currency_type: 'USD' }) }).port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('serviceability is a local check and makes no call', async () => {
    const { port, calls } = adapter({});
    expect(await port.checkServiceability(quoteReq)).toEqual({ ok: true, value: { serviceable: true, reason: null } });
    expect(await port.checkServiceability({ ...quoteReq, to: { ...POINT_B, lat: 0, lng: 0 } })).toEqual({ ok: true, value: { serviceable: false, reason: 'invalid_location' } });
    expect(calls).toHaveLength(0);
  });
});

describe('Uber Direct: create', () => {
  it('sends our reference, hand-to-hand and verification; never the value or brand', async () => {
    const { port, calls } = adapter({ 'POST /deliveries': () => json(200, delivery()) });
    const r = await port.createDelivery(createReq({ recipientPin: '4821' }));
    expect(r).toEqual({
      ok: true,
      value: { providerReference: 'del_abc', merchantReference: 'tvd_group1_o1', state: 'pending', stateAt: '2026-10-10T08:01:00.000Z', trackingUrl: 'https://track.example/del_abc', courierName: 'Sipho', proof: [] },
    });
    const body = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/deliveries'))?.body ?? '{}');
    expect(body).toMatchObject({
      quote_id: 'dqt_1',
      external_id: 'tvd_group1_o1',
      idempotency_key: 'tvd_group1_o1',
      deliverable_action: 'deliverable_action_meet_at_door',
      undeliverable_action: 'return',
      pickup_verification: { picture: true },
      dropoff_verification: { signature_requirement: { enabled: true }, picture: true, pincode: { enabled: true, value: '4821' } },
      manifest_items: [{ name: 'Camera equipment', quantity: 1, weight: 2000 }],
    });
    expect(body).not.toHaveProperty('manifest_total_value');
    expect(JSON.stringify(body)).not.toContain('1500000');
  });

  it('never asks for leave-at-door', async () => {
    const { port, calls } = adapter({ 'POST /deliveries': () => json(200, delivery()) });
    await port.createDelivery(createReq({ noLeaveAtDoor: true }));
    expect(calls.map((c) => c.body ?? '').join('')).not.toContain('leave_at_door');
  });

  it('declares a value only when the core passes one', async () => {
    const { port, calls } = adapter({ 'POST /deliveries': () => json(200, delivery()) });
    await port.createDelivery(createReq({ declaredValueCents: 250_000 }));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/deliveries'))?.body ?? '{}').manifest_total_value).toBe(250_000);
  });

  it.each([
    ['timeout', (): 'hang' => 'hang', 'unknown'],
    ['500', () => json(500, { message: 'internal' }), 'unknown'],
    ['502 html', () => new Response('<html>bad gateway</html>', { status: 502 }), 'unknown'],
    ['429', () => json(429, { message: 'slow down' }), 'unknown'],
    ['408', () => json(408, {}), 'unknown'],
    ['409 (may be a duplicate)', () => json(409, { message: 'duplicate' }), 'unknown'],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'unknown'],
    ['200 without an id', () => json(200, { status: 'pending' }), 'unknown'],
    ['400 refusal', () => json(400, { code: 'invalid_params', message: 'dropoff address undeliverable' }), 'rejected'],
    ['422 refusal', () => json(422, { message: 'quote expired' }), 'rejected'],
    ['403 credentials', () => json(403, { message: 'forbidden' }), 'rejected'],
  ] as const)('classifies %s as %s, and never repeats the create', async (_name, handler, kind) => {
    const { port, calls } = adapter({ 'POST /deliveries': handler as Handler });
    const r = await port.createDelivery(createReq());
    expect(r).toMatchObject({ ok: false, kind });
    expect(calls.filter((c) => c.url.endsWith('/deliveries'))).toHaveLength(1);
  });

  it('a 403 says it is a configuration problem', async () => {
    const { port } = adapter({ 'POST /deliveries': () => json(403, { message: 'forbidden' }) });
    expect(await port.createDelivery(createReq())).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('configuration') });
  });

  it('error messages carry no request data', async () => {
    const { port } = adapter({ 'POST /deliveries': () => json(400, { message: 'bad request' }) });
    const r = await port.createDelivery(createReq());
    expect(JSON.stringify(r)).not.toMatch(/Thandi|\+2711|Test Road/);
  });
});

describe('Uber Direct: lookup by our reference', () => {
  it('always answers unknown (no verified lookup), so the core escalates instead of re-dispatching', async () => {
    const { port, calls } = adapter({ 'GET /deliveries': () => json(200, { data: [delivery()] }) });
    const r = await port.findByMerchantReference('tvd_group1_o1');
    expect(r).toMatchObject({ ok: false, kind: 'unknown' });
    // Never "not found": that would let the core create a second courier.
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('Uber Direct: get, cancel, tracking', () => {
  it('maps statuses conservatively', () => {
    expect(mapUberStatus('pending')).toBe('pending');
    expect(mapUberStatus('pickup')).toBe('courier_assigned');
    expect(mapUberStatus('pickup_complete')).toBe('collected');
    expect(mapUberStatus('dropoff')).toBe('in_transit');
    expect(mapUberStatus('delivered')).toBe('delivered');
    expect(mapUberStatus('canceled')).toBe('cancelled');
    expect(mapUberStatus('returned')).toBe('return_to_sender');
    expect(mapUberStatus('something_new')).toBe('unknown');
    expect(mapUberStatus(undefined)).toBe('unknown');
  });

  it('getDelivery returns proof references only (no image URLs or signer names)', async () => {
    const d = delivery({
      status: 'delivered',
      dropoff: { verification: { signature: { image_url: 'https://img/s.png', signer_name: 'Thandi M' }, picture: { image_url: 'https://img/p.png' }, pin_code: { entered: '4821' } } },
      pickup: { verification: { picture: { image_url: 'https://img/pk.png' } } },
    });
    const { port } = adapter({ 'GET /deliveries/del_abc': () => json(200, d) });
    const r = await port.getDelivery('del_abc');
    expect(r).toMatchObject({ ok: true, value: { state: 'delivered' } });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.proof).toEqual([
      { kind: 'photo', ref: 'uber_direct:del_abc:pickup:photo' },
      { kind: 'pin', ref: 'uber_direct:del_abc:dropoff:pin' },
      { kind: 'signature', ref: 'uber_direct:del_abc:dropoff:signature' },
      { kind: 'photo', ref: 'uber_direct:del_abc:dropoff:photo' },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/img\/|Thandi M|4821/);
  });

  it('getDelivery of an unknown id is a refusal; a 503 is unknown', async () => {
    expect(await adapter({ 'GET /deliveries/nope': () => json(404, { message: 'not found' }) }).port.getDelivery('nope')).toMatchObject({ ok: false, kind: 'rejected' });
    expect(await adapter({ 'GET /deliveries/x': () => json(503, {}) }).port.getDelivery('x')).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('cancel posts to the cancel endpoint and needs a cancelled status to say so', async () => {
    const ok = adapter({ 'POST /deliveries/del_abc/cancel': () => json(200, delivery({ status: 'canceled' })) });
    expect(await ok.port.cancelDelivery('del_abc', 'renter cancelled')).toEqual({ ok: true, value: { cancelled: true, feeCents: 0 } });
    expect(ok.calls.find((c) => c.url.endsWith('/cancel'))?.method).toBe('POST');
    const odd = adapter({ 'POST /deliveries/del_abc/cancel': () => json(200, delivery({ status: 'pickup_complete' })) });
    expect(await odd.port.cancelDelivery('del_abc', 'x')).toMatchObject({ ok: false, kind: 'unknown' });
    const late = adapter({ 'POST /deliveries/del_abc/cancel': () => json(400, { message: 'cannot cancel after pickup' }) });
    expect(await late.port.cancelDelivery('del_abc', 'x')).toMatchObject({ ok: false, kind: 'rejected' });
  });

  it('tracking reports only what Uber says', async () => {
    const { port } = adapter({ 'GET /deliveries/del_abc': () => json(200, delivery({ status: 'dropoff', dropoff_eta: '2026-10-10T09:00:00Z' })) });
    expect(await port.getTracking('del_abc')).toEqual({
      ok: true,
      value: { state: 'in_transit', etaAt: '2026-10-10T09:00:00.000Z', location: { lat: -26.15, lng: 28.04, at: '2026-10-10T08:01:00.000Z' }, trackingUrl: 'https://track.example/del_abc' },
    });
    const bare = adapter({ 'GET /deliveries/del_abc': () => json(200, { id: 'del_abc', status: 'pending' }) });
    expect(await bare.port.getTracking('del_abc')).toEqual({ ok: true, value: { state: 'pending', etaAt: null, location: null, trackingUrl: null } });
  });
});

describe('Uber Direct: circuit breaker', () => {
  it('opens after repeated unknown outcomes and then skips the network', async () => {
    let t = 0;
    const breaker = new CircuitBreaker('uber-test', { failureThreshold: 2, cooldownMs: 1_000, now: () => t });
    const { port, calls } = adapter({ 'POST /delivery_quotes': () => json(503, {}) }, { breaker });
    await port.quote(quoteReq); // token ok (success), quote 503 (1)
    await port.quote(quoteReq); // quote 503 (2) → open
    const before = calls.length;
    expect(await port.quote(quoteReq)).toMatchObject({ ok: false, kind: 'unknown', message: expect.stringContaining('circuit open') });
    expect(calls.length).toBe(before);
    t += 1_000; // half-open: one trial call
    await port.quote(quoteReq);
    expect(calls.length).toBe(before + 1);
    expect(breaker.state).toBe('open');
  });

  it('a refusal does not trip the breaker', async () => {
    const breaker = new CircuitBreaker('uber-test-2', { failureThreshold: 1, cooldownMs: 1_000 });
    const { port } = adapter({ 'POST /delivery_quotes': () => json(400, { message: 'bad' }) }, { breaker });
    await port.quote(quoteReq);
    await port.quote(quoteReq);
    expect(breaker.state).toBe('closed');
  });

  it('classifies HTTP statuses', () => {
    expect([200, 201, 204].map(classifyHttpStatus)).toEqual(['ok', 'ok', 'ok']);
    expect([400, 401, 403, 404, 422].map(classifyHttpStatus)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
    expect([408, 409, 425, 429, 500, 502, 503, 504, 302].map(classifyHttpStatus)).toEqual(Array(9).fill('unknown'));
  });
});

describe('Uber Direct: webhooks', () => {
  const KEY = 'whsec_test_key';
  const sign = (body: string, key = KEY): string => createHmac('sha256', key).update(body).digest('hex');
  const event = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: 'evt_1',
      kind: 'event.delivery_status',
      status: 'pickup_complete',
      delivery_id: 'del_abc',
      created: '2026-10-10T08:30:00Z',
      live_mode: false,
      data: delivery({ status: 'pickup_complete', pickup: { verification: { picture: { image_url: 'https://img/pk.png' } } } }),
      ...over,
    });

  it('accepts a correct HMAC-SHA256 signature on the raw body (either header)', () => {
    const p = createUberDirectWebhookParser({ signingKey: KEY, mode: 'sandbox' });
    const body = event();
    expect(p.verify(body, { 'x-uber-signature': sign(body) })).toBe(true);
    expect(p.verify(body, { 'X-Postmates-Signature': sign(body) })).toBe(true);
    expect(p.verify(body, { 'x-uber-signature': sign(body).toUpperCase() })).toBe(true);
  });

  it('signs the raw bytes as received (whitespace and key order matter)', () => {
    const p = createUberDirectWebhookParser({ signingKey: KEY, mode: 'sandbox' });
    const raw = '{ "kind": "event.delivery_status",\n  "status": "delivered", "delivery_id": "del_abc" }';
    expect(p.verify(raw, { 'x-uber-signature': sign(raw) })).toBe(true);
    expect(p.verify(raw, { 'x-uber-signature': sign(JSON.stringify(JSON.parse(raw))) })).toBe(false);
  });

  it('refuses a tampered body, a wrong key, a missing or malformed signature, or no key', () => {
    const p = createUberDirectWebhookParser({ signingKey: KEY, mode: 'sandbox' });
    const body = event();
    expect(p.verify(body.replace('pickup_complete', 'delivered'), { 'x-uber-signature': sign(body) })).toBe(false);
    expect(p.verify(body, { 'x-uber-signature': sign(body, 'other') })).toBe(false);
    expect(p.verify(body, {})).toBe(false);
    expect(p.verify(body, { 'x-uber-signature': 'zz' })).toBe(false);
    expect(p.verify(body, { 'x-uber-signature': sign(body).slice(0, 40) })).toBe(false);
    expect(createUberDirectWebhookParser({ signingKey: null, mode: 'sandbox' }).verify(body, { 'x-uber-signature': sign(body, '') })).toBe(false);
  });

  it('reads the signing key for the configured mode from env', () => {
    const body = event();
    const env = { DELIVERY_PROVIDER_UBER_DIRECT_MODE: 'sandbox', UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY: KEY, UBER_DIRECT_WEBHOOK_SIGNING_KEY: 'live-key' };
    expect(uberDirectWebhookParser(env).verify(body, { 'x-uber-signature': sign(body) })).toBe(true);
    expect(uberDirectWebhookParser({ ...env, DELIVERY_PROVIDER_UBER_DIRECT_MODE: 'production' }).verify(body, { 'x-uber-signature': sign(body) })).toBe(false);
    expect(uberDirectWebhookParser({}).verify(body, { 'x-uber-signature': sign(body) })).toBe(false);
  });

  it('parses a status event into a minimal record with no personal data', () => {
    const p = createUberDirectWebhookParser({ signingKey: KEY, mode: 'sandbox' });
    const parsed = p.parse(event());
    expect(parsed).toEqual({
      eventId: 'evt_1',
      merchantReference: 'tvd_group1_o1',
      providerReference: 'del_abc',
      state: 'collected',
      stateAt: '2026-10-10T08:30:00.000Z',
      trackingUrl: 'https://track.example/del_abc',
      courierName: 'Sipho',
      proof: [{ kind: 'photo', ref: 'uber_direct:del_abc:pickup:photo' }],
      minimal: { kind: 'event.delivery_status', eventId: 'evt_1', deliveryId: 'del_abc', externalId: 'tvd_group1_o1', status: 'pickup_complete', liveMode: false, created: '2026-10-10T08:30:00.000Z' },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/\+27|Dlamini|Test Road|img\/|-26\.15/);
  });

  it('ignores other event kinds, test events in production, unreadable bodies and unknown statuses safely', () => {
    const sandbox = createUberDirectWebhookParser({ signingKey: KEY, mode: 'sandbox' });
    const live = createUberDirectWebhookParser({ signingKey: KEY, mode: 'production' });
    expect(sandbox.parse(event({ kind: 'event.courier_update' }))).toBeNull();
    expect(live.parse(event({ live_mode: false }))).toBeNull();
    expect(sandbox.parse(event({ live_mode: true }))).toBeNull();
    expect(sandbox.parse('not json')).toBeNull();
    expect(sandbox.parse(event({ delivery_id: undefined, data: {} }))).toBeNull();
    expect(sandbox.parse(event({ status: 'teleported', data: { id: 'del_abc', status: 'teleported' } }))?.state).toBe('unknown');
  });
});
