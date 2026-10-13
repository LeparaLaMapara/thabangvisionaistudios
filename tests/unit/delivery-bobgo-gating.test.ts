/**
 * Bob Go is registered like the other couriers and goes through the SAME
 * selection path, so every existing gate applies to it:
 *
 *   - registry: off unless listed AND DELIVERY_PROVIDER_BOBGO_ENABLED=true;
 *     production needs DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED=true and
 *     BOBGO_API_KEY; sandbox never on the production deployment;
 *   - core policy: the delivery_courier flag, the D-37 value threshold, the
 *     D-41 verified-insurance gate and the custody capabilities (risk gate);
 *   - webhooks: registered, and closed (503, nothing stored) whatever is set.
 *
 * No network: fetch is stubbed to fail, and must never be called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/delivery/webhook-adapters';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import type { CreateDeliveryRequest } from '@/lib/core/delivery/port';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { quoteDelivery } from '@/lib/core/delivery/use-cases';
import { BOBGO_CAPABILITIES, createBobgoWebhookParser } from '@/lib/delivery/bobgo';
import { InMemoryManualTaskStore } from '@/lib/delivery/manual';
import { aggregatorCourierFactories, courierFactories, deliveryProviders, policyInsurance } from '@/lib/delivery/ports';
import { handleDeliveryWebhook, registeredDeliveryWebhookProviders, resolveDeliveryWebhookParser } from '@/lib/delivery/webhooks';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world } from './helpers/delivery-fakes';

type Env = Record<string, string>;
const LISTED: Env = { DELIVERY_PROVIDERS: 'bobgo,manual', BOBGO_SANDBOX_API_KEY: 'sb-key', BOBGO_API_KEY: 'live-key' };
const ON_SANDBOX: Env = { ...LISTED, DELIVERY_PROVIDER_BOBGO_ENABLED: 'true', DELIVERY_PROVIDER_BOBGO_MODE: 'sandbox', DELIVERY_ALLOW_SANDBOX: 'true' };
const ON_PRODUCTION: Env = { ...LISTED, DELIVERY_PROVIDER_BOBGO_ENABLED: 'true', DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED: 'true', VERCEL_ENV: 'production' };

const store = (): InMemoryManualTaskStore => new InMemoryManualTaskStore();
const bobgo = (env: Env) => deliveryProviders(store(), env).get('bobgo');
const POINT = { placeId: 'p', lat: -26.19, lng: 28.03, formattedAddress: '1 Road', suburb: null, city: null, postalCode: null, contactName: 'A', contactPhone: '+27110000000', instructions: null };
const CREATE: CreateDeliveryRequest = {
  merchantReference: 'tvd_1',
  leg: 'outbound',
  quote: { providerId: 'bobgo', providerQuoteRef: 'ANY_LEVEL', providerCostCents: 5000, expiresAt: '2026-10-10T08:15:00Z', window: { start: null, end: null } },
  from: POINT,
  to: { ...POINT, lat: -26.1 },
  items: [],
  window: { start: null, end: null },
  requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null },
};
const createMsg = async (env: Env): Promise<string> => {
  const r = await bobgo(env)?.createDelivery(CREATE);
  return r && !r.ok ? r.message : 'ok';
};

afterEach(() => vi.unstubAllGlobals());

describe('Bob Go registration', () => {
  it('is not on the default deployment, and is an aggregator factory (direct couriers unchanged)', () => {
    expect(deliveryProviders(store(), {}).list().map((p) => p.providerId)).toEqual(['manual']);
    expect(Object.keys(aggregatorCourierFactories({}))).toEqual(['bobgo']);
    expect(Object.keys(courierFactories({}))).not.toContain('bobgo');
  });

  it('listing it is not enough: it must be enabled explicitly', async () => {
    expect(bobgo(LISTED)?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(await createMsg(LISTED)).toContain('is not enabled');
    expect(await createMsg({ ...LISTED, DELIVERY_PROVIDER_BOBGO_ENABLED: 'yes' })).toContain('is not enabled');
    expect(await createMsg({ ...ON_SANDBOX, DELIVERY_PROVIDER_BOBGO_ENABLED: '' })).toContain('is not enabled');
  });

  it('DELIVERY_PROVIDER_BOBGO_ENABLED=false removes it', () => {
    expect(bobgo({ ...ON_SANDBOX, DELIVERY_PROVIDER_BOBGO_ENABLED: 'false' })).toBeNull();
  });

  it('enabled in sandbox: the real adapter, labelled sandbox (and it still sends nothing: no approved service level)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    const port = bobgo(ON_SANDBOX);
    expect(port).toMatchObject({ providerId: 'bobgo', mode: 'sandbox', kind: 'courier', capabilities: BOBGO_CAPABILITIES });
    expect(await createMsg(ON_SANDBOX)).toContain('not for an approved service level');
    expect(await port?.quote({ from: { lat: -26.19, lng: 28.03, suburb: null, city: null, postalCode: null }, to: { lat: -26.1, lng: 28.05, suburb: null, city: null, postalCode: null }, window: { start: null, end: null }, items: [], leg: 'outbound' })).toMatchObject({ ok: false, kind: 'rejected' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sandbox is refused on the production deployment', async () => {
    expect(await createMsg({ ...ON_SANDBOX, VERCEL_ENV: 'production' })).toContain('sandbox is not allowed on the production deployment');
    expect(deliveryProviders(store(), { ...ON_SANDBOX, VERCEL_ENV: 'production' }).allowSandbox).toBe(false);
  });

  it('production needs the recorded approval, then the production key', async () => {
    const enabled = { ...LISTED, DELIVERY_PROVIDER_BOBGO_ENABLED: 'true' };
    expect(await createMsg(enabled)).toContain('not approved for production');
    expect(await createMsg({ ...enabled, DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED: 'TRUE ' })).toContain('not approved for production');
    // Approved but no production key (the sandbox key is never used in production).
    const noKey = { DELIVERY_PROVIDERS: 'bobgo', BOBGO_SANDBOX_API_KEY: 'sb', DELIVERY_PROVIDER_BOBGO_ENABLED: 'true', DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED: 'true' };
    expect(await createMsg(noKey)).toContain('not configured');
    expect(bobgo(ON_PRODUCTION)).toMatchObject({ mode: 'production', kind: 'courier', capabilities: BOBGO_CAPABILITIES });
  });
});

describe('the shared selection path still excludes Bob Go', () => {
  const WINDOW = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
  const renter = { kind: 'renter' as const, userId: RENTER };
  const input = { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound' as const, originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW };

  function setup(env: Env, opts: { courierFlag: boolean; ownFleet?: boolean; cover?: Record<string, number>; threshold?: number }) {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    const w = world({ courierEnabled: opts.courierFlag, ownFleetEnabled: opts.ownFleet ?? true, cover: opts.cover });
    w.deps.providers = deliveryProviders(w.tasks, env);
    if (!opts.cover) w.deps.insurance = policyInsurance();
    w.deps.policy = opts.threshold === undefined ? DEFAULT_DELIVERY_POLICY : { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: opts.threshold };
    return { w, fetchSpy };
  }

  it('production approved + key, but the delivery_courier flag off: own vehicle only, Bob Go never called', async () => {
    const { w, fetchSpy } = setup(ON_PRODUCTION, { courierFlag: false });
    const r = await quoteDelivery(input, w.deps);
    if (!r.ok) throw new Error(`expected own-vehicle quote, got ${r.code}`);
    expect(r.quotes.map((q) => q.providerId)).toEqual(['manual']);
    expect(r.excluded).toEqual(expect.arrayContaining([{ providerId: 'bobgo', reasons: expect.arrayContaining(['courier_flag_off']) }]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('flag on: the D-37 threshold (0) and D-41 (no verified insurance) still keep it out', async () => {
    const { w, fetchSpy } = setup(ON_PRODUCTION, { courierFlag: true });
    const r = await quoteDelivery(input, w.deps);
    if (!r.ok) throw new Error(`expected own-vehicle quote, got ${r.code}`);
    expect(r.quotes.map((q) => q.providerId)).toEqual(['manual']);
    expect(r.excluded.map((e) => e.providerId)).toEqual(['bobgo']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('threshold opened, insurance still unverified: excluded as not covered', async () => {
    const { w, fetchSpy } = setup(ON_PRODUCTION, { courierFlag: true, threshold: 5_000_000 });
    const r = await quoteDelivery(input, w.deps);
    const excluded = 'excluded' in r ? (r.excluded ?? []) : [];
    expect(excluded.find((e) => e.providerId === 'bobgo')?.reasons).toContain('not_covered');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with every policy gate opened in a test, the unverified capabilities still exclude it', async () => {
    const { w, fetchSpy } = setup(ON_PRODUCTION, { courierFlag: true, ownFleet: false, cover: { bobgo: 5_000_000 }, threshold: 5_000_000 });
    const r = await quoteDelivery(input, w.deps);
    expect(r).toMatchObject({ ok: false, code: 'no_provider', collectionOnly: true });
    const excluded = 'excluded' in r ? (r.excluded ?? []) : [];
    expect(excluded.find((e) => e.providerId === 'bobgo')?.reasons).toEqual(
      expect.arrayContaining([
        'missing_capability:pickupConfirmation',
        'missing_capability:proofOfDelivery',
        'missing_capability:noLeaveAtDoor',
        'missing_capability:idempotentCreate',
        'missing_capability:scheduled',
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Bob Go webhooks stay closed', () => {
  // A shipment, as the Bob Go API returns it.
  const body = JSON.stringify({ tracking_reference: 'bg_77', custom_tracking_reference: 'tvd_1', status: 'delivered', time_modified: '2026-10-10T09:00:00Z', delivery_contact_mobile_number: '+27110000001' });

  it('is registered with the route', () => {
    expect(registeredDeliveryWebhookProviders()).toEqual(expect.arrayContaining(['bobgo', 'uber_direct', 'wumdrop']));
  });

  it('no parser under any configuration (no signing scheme is known)', () => {
    for (const env of [{}, ON_SANDBOX, ON_PRODUCTION, { ...ON_PRODUCTION, BOBGO_WEBHOOK_SECRET: 's', DELIVERY_PROVIDER_BOBGO_WEBHOOK_SECRET: 's' }]) {
      expect(resolveDeliveryWebhookParser('bobgo', env)).toEqual({ kind: 'not_configured' });
    }
  });

  it('the route answers 503 and builds no deps (nothing stored)', async () => {
    const deps = vi.fn(() => {
      throw new Error('must not be built');
    });
    expect(await handleDeliveryWebhook({ providerId: 'bobgo', rawBody: body, headers: { authorization: 'Bearer x' }, env: ON_PRODUCTION, deps })).toEqual({ status: 503, outcome: 'not_configured' });
    expect(deps).not.toHaveBeenCalled();
  });

  it('a parser without a verifier refuses everything; parse keeps ids, status and time only', () => {
    const p = createBobgoWebhookParser({ verify: null });
    expect(p.verify(body, {})).toBe(false);
    expect(p.verify(body, { 'x-bobgo-signature': 'anything', authorization: 'Bearer live-key' })).toBe(false);
    expect(createBobgoWebhookParser({ verify: () => { throw new Error('bad'); } }).verify(body, {})).toBe(false);
    const parsed = p.parse(body);
    expect(parsed).toEqual({
      eventId: null,
      merchantReference: 'tvd_1',
      providerReference: 'bg_77',
      state: 'delivered',
      stateAt: '2026-10-10T09:00:00.000Z',
      trackingUrl: null,
      courierName: null,
      proof: [],
      minimal: { providerReference: 'bg_77', merchantReference: 'tvd_1', status: 'delivered', stateAt: '2026-10-10T09:00:00.000Z' },
    });
    expect(JSON.stringify(parsed)).not.toContain('+27');
    expect(p.parse('nope')).toBeNull();
    expect(p.parse('{"status":"delivered"}')).toBeNull();
  });
});
