/**
 * Courier registration (Phase 4 §4.15): Uber Direct and WumDrop are in the
 * registry but OFF unless switched on explicitly; production needs a recorded
 * approval; sandbox never runs on the production deployment. And even when
 * switched on, the shipped policy (delivery_courier flag off, value threshold
 * 0, no verified insurance, missing custody capabilities) still leaves
 * collection or our own vehicle as the only options.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { quoteDelivery } from '@/lib/core/delivery/use-cases';
import { InMemoryManualTaskStore } from '@/lib/delivery/manual';
import { courierFactories, deliveryProviders, policyInsurance } from '@/lib/delivery/ports';
import { UBER_DIRECT_CAPABILITIES } from '@/lib/delivery/uber-direct';
import { WUMDROP_CAPABILITIES } from '@/lib/delivery/wumdrop';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world } from './helpers/delivery-fakes';

const CREDS = {
  UBER_DIRECT_SANDBOX_CLIENT_ID: 'sb-id',
  UBER_DIRECT_SANDBOX_CLIENT_SECRET: 'sb-secret',
  UBER_DIRECT_SANDBOX_CUSTOMER_ID: 'sb-cust',
  UBER_DIRECT_CLIENT_ID: 'live-id',
  UBER_DIRECT_CLIENT_SECRET: 'live-secret',
  UBER_DIRECT_CUSTOMER_ID: 'live-cust',
  WUMDROP_SANDBOX_API_KEY: 'sb-key',
  WUMDROP_API_KEY: 'live-key',
};
const ALL = { DELIVERY_PROVIDERS: 'uber_direct,wumdrop,manual', ...CREDS };
const ON_SANDBOX = {
  ...ALL,
  DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: 'true',
  DELIVERY_PROVIDER_UBER_DIRECT_MODE: 'sandbox',
  DELIVERY_PROVIDER_WUMDROP_ENABLED: 'true',
  DELIVERY_PROVIDER_WUMDROP_MODE: 'sandbox',
  DELIVERY_ALLOW_SANDBOX: 'true',
};

const store = (): InMemoryManualTaskStore => new InMemoryManualTaskStore();
const caps = (env: Record<string, string>, id: string) => deliveryProviders(store(), env).get(id)?.capabilities;

afterEach(() => vi.unstubAllGlobals());

describe('registration', () => {
  it('the default deployment has our own vehicle only', () => {
    expect(deliveryProviders(store(), {}).list().map((p) => p.providerId)).toEqual(['manual']);
  });

  it('listing a courier is not enough: it must be enabled explicitly', () => {
    const r = deliveryProviders(store(), ALL);
    expect(r.list().map((p) => p.providerId)).toEqual(['uber_direct', 'wumdrop', 'manual']);
    expect(r.get('uber_direct')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(r.get('wumdrop')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(caps({ ...ALL, DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: 'yes' }, 'uber_direct')).toEqual(NO_DELIVERY_CAPABILITIES);
    // Sandbox mode and sandbox allowed, but not enabled: still off.
    const notEnabled = { ...ON_SANDBOX, DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: undefined, DELIVERY_PROVIDER_WUMDROP_ENABLED: undefined } as unknown as Record<string, string>;
    expect(caps(notEnabled, 'uber_direct')).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(caps(notEnabled, 'wumdrop')).toEqual(NO_DELIVERY_CAPABILITIES);
  });

  it('enabled in sandbox: the real adapters, labelled sandbox', () => {
    const r = deliveryProviders(store(), ON_SANDBOX);
    expect(r.get('uber_direct')).toMatchObject({ mode: 'sandbox', kind: 'courier', capabilities: UBER_DIRECT_CAPABILITIES });
    expect(r.get('wumdrop')).toMatchObject({ mode: 'sandbox', kind: 'courier', capabilities: WUMDROP_CAPABILITIES });
    expect(r.allowSandbox).toBe(true);
  });

  it('sandbox is refused on the production deployment', () => {
    const r = deliveryProviders(store(), { ...ON_SANDBOX, VERCEL_ENV: 'production' });
    expect(r.get('uber_direct')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(r.get('wumdrop')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(r.allowSandbox).toBe(false);
  });

  it('production mode needs the recorded approval', async () => {
    const enabled = { ...ALL, DELIVERY_PROVIDER_UBER_DIRECT_ENABLED: 'true', DELIVERY_PROVIDER_WUMDROP_ENABLED: 'true' };
    const r = deliveryProviders(store(), enabled);
    expect(r.get('uber_direct')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
    expect(await r.get('uber_direct')?.createDelivery({} as never)).toMatchObject({ ok: false, kind: 'rejected', message: expect.stringContaining('not approved for production') });
    const approved = deliveryProviders(store(), { ...enabled, DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED: 'true' });
    expect(approved.get('uber_direct')).toMatchObject({ mode: 'production', capabilities: UBER_DIRECT_CAPABILITIES });
    expect(approved.get('wumdrop')?.capabilities).toEqual(NO_DELIVERY_CAPABILITIES);
  });

  it('DELIVERY_PROVIDER_<ID>_ENABLED=false still switches a courier off', () => {
    expect(deliveryProviders(store(), { ...ON_SANDBOX, DELIVERY_PROVIDER_WUMDROP_ENABLED: 'false' }).get('wumdrop')).toBeNull();
  });

  it('exposes one factory per courier', () => {
    expect(Object.keys(courierFactories({})).sort()).toEqual(['uber_direct', 'wumdrop']);
  });
});

describe('the shipped policy still excludes the couriers', () => {
  const WINDOW = { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' };
  const renter = { kind: 'renter' as const, userId: RENTER };

  async function quoteWith(env: Record<string, string>, courierFlag: boolean) {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    const w = world({ courierEnabled: courierFlag, ownFleetEnabled: true });
    // Real registry and the real (not-covered) insurance answer; the default policy (threshold 0).
    w.deps.providers = deliveryProviders(w.tasks, env);
    w.deps.insurance = policyInsurance();
    w.deps.policy = DEFAULT_DELIVERY_POLICY;
    const r = await quoteDelivery(
      { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW },
      w.deps,
    );
    return { r, fetchSpy };
  }

  it('flag off: own vehicle only, couriers never called', async () => {
    const { r, fetchSpy } = await quoteWith(ON_SANDBOX, false);
    if (!r.ok) throw new Error(`expected own-vehicle quote, got ${r.code}`);
    expect(r.quotes.map((q) => q.providerId)).toEqual(['manual']);
    expect(r.quotes[0].providerKind).toBe('own_fleet');
    expect(r.excluded).toEqual(
      expect.arrayContaining([
        { providerId: 'uber_direct', reasons: expect.arrayContaining(['courier_flag_off', 'courier_value_threshold']) },
        { providerId: 'wumdrop', reasons: expect.arrayContaining(['courier_flag_off', 'courier_value_threshold']) },
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('even with the flag on, threshold 0 and no verified insurance keep them out', async () => {
    const { r, fetchSpy } = await quoteWith(ON_SANDBOX, true);
    if (!r.ok) throw new Error(`expected own-vehicle quote, got ${r.code}`);
    expect(r.quotes.map((q) => q.providerId)).toEqual(['manual']);
    expect(r.excluded.map((e) => e.providerId).sort()).toEqual(['uber_direct', 'wumdrop']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with the policy gates opened in a test, the missing custody capabilities still exclude both', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in tests')));
    vi.stubGlobal('fetch', fetchSpy);
    const w = world({ courierEnabled: true, ownFleetEnabled: false, cover: { uber_direct: 5_000_000, wumdrop: 5_000_000 } });
    w.deps.providers = deliveryProviders(w.tasks, ON_SANDBOX);
    w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 5_000_000 };
    const r = await quoteDelivery(
      { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: WINDOW },
      w.deps,
    );
    expect(r).toMatchObject({ ok: false, code: 'no_provider', collectionOnly: true });
    const excluded = 'excluded' in r ? (r.excluded ?? []) : [];
    expect(excluded.find((e) => e.providerId === 'uber_direct')?.reasons).toContain('missing_capability:idempotentCreate');
    expect(excluded.find((e) => e.providerId === 'wumdrop')?.reasons).toEqual(expect.arrayContaining(['missing_capability:pickupConfirmation', 'missing_capability:noLeaveAtDoor']));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
