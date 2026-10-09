import { DELIVERY_POLICY } from '@/lib/constants';
import { NO_DELIVERY_CAPABILITIES } from '@/lib/core/delivery/capabilities';
import type { DeliveryInsurancePort, DeliveryPort } from '@/lib/core/delivery/port';
import type { DeliveryProviderRegistry } from '@/lib/core/delivery/repository';
import { MANUAL_PROVIDER_ID, createManualDeliveryAdapter, type ManualTaskStore } from './manual';
import { UBER_DIRECT_PROVIDER_ID, createUberDirectAdapter, uberDirectConfigFromEnv } from './uber-direct';
import { WUMDROP_PROVIDER_ID, createWumdropAdapter, wumdropConfigFromEnv } from './wumdrop';

/**
 * The delivery providers in use, chosen by configuration (spec Phase 4 §4.15).
 * Routes, jobs and Ubunye get providers from here, never from a provider
 * module, so a new courier is one adapter plus one factory entry.
 *
 *   DELIVERY_PROVIDERS               priority list, e.g. "manual" (default) or
 *                                    "courier_a,manual". Priority never
 *                                    overrides the risk gate (policy.ts).
 *   DELIVERY_PROVIDER_<ID>_ENABLED   "false" switches one provider off.
 *   DELIVERY_PROVIDER_<ID>_MODE      "sandbox" | "production" (default).
 *   DELIVERY_ALLOW_SANDBOX           "true" lets sandbox adapters be offered;
 *                                    ignored on the production deployment.
 *
 * Couriers (uber_direct, wumdrop) are stricter: off unless explicitly enabled,
 * and production needs a recorded approval. See gatedCourierFactory below.
 *
 * An id with no adapter gets the refuse-everything adapter: no capabilities,
 * every call rejected. It is therefore excluded by the risk gate with a
 * reason, never sent anywhere unexpected.
 */

type Env = Record<string, string | undefined>;
export type DeliveryAdapterFactory = (mode: 'sandbox' | 'production') => DeliveryPort;

/** A provider we have no adapter for (or one switched off): refuses everything. */
export function refusingDeliveryAdapter(providerId: string, why = 'is not supported'): DeliveryPort {
  const no = (): Promise<{ ok: false; kind: 'rejected'; message: string }> =>
    Promise.resolve({ ok: false, kind: 'rejected', message: `delivery provider ${providerId} ${why}` });
  return {
    providerId,
    kind: 'courier',
    mode: 'production',
    capabilities: NO_DELIVERY_CAPABILITIES,
    checkServiceability: no,
    quote: no,
    createDelivery: no,
    findByMerchantReference: no,
    getDelivery: no,
    cancelDelivery: no,
    getTracking: no,
  };
}

const envKey = (id: string): string => id.toUpperCase().replace(/[^A-Z0-9]/g, '_');

/** Pure: builds the registry from env and the known adapter factories. */
export function buildDeliveryRegistry(env: Env, factories: Readonly<Record<string, DeliveryAdapterFactory>>): DeliveryProviderRegistry {
  const ids = (env.DELIVERY_PROVIDERS ?? MANUAL_PROVIDER_ID)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ports: DeliveryPort[] = [];
  for (const id of [...new Set(ids)]) {
    if ((env[`DELIVERY_PROVIDER_${envKey(id)}_ENABLED`] ?? 'true').toLowerCase() === 'false') continue;
    const mode = (env[`DELIVERY_PROVIDER_${envKey(id)}_MODE`] ?? 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
    const factory = factories[id];
    if (!factory) {
      ports.push(refusingDeliveryAdapter(id));
      continue;
    }
    const port = factory(mode);
    ports.push(port.mode === mode ? port : { ...port, mode });
  }
  const allowSandbox = (env.DELIVERY_ALLOW_SANDBOX ?? '').toLowerCase() === 'true' && env.VERCEL_ENV !== 'production';
  return {
    list: () => ports,
    get: (id) => ports.find((p) => p.providerId === id) ?? null,
    allowSandbox,
  };
}

/**
 * Transit cover. Answers "not covered" unless a verified policy is configured
 * in DELIVERY_POLICY.insurance for this provider and every item is within its
 * limit (spec §4.13). A provider's liability limit is NOT cover.
 */
export function policyInsurance(policy: { verifiedPolicyRef: string | null; coveredProviders: readonly string[]; maxItemValueCents: number } = DELIVERY_POLICY.insurance): DeliveryInsurancePort {
  return {
    async coverFor({ providerId, items }) {
      if (!policy.verifiedPolicyRef) return { covered: false, policyRef: null, maxItemValueCents: 0, reason: 'no_verified_policy' };
      if (!policy.coveredProviders.includes(providerId)) return { covered: false, policyRef: null, maxItemValueCents: 0, reason: 'provider_not_covered' };
      if (items.some((i) => i.replacementValueCents > policy.maxItemValueCents)) {
        return { covered: false, policyRef: policy.verifiedPolicyRef, maxItemValueCents: policy.maxItemValueCents, reason: 'item_above_cover_limit' };
      }
      return { covered: true, policyRef: policy.verifiedPolicyRef, maxItemValueCents: policy.maxItemValueCents, reason: null };
    },
  };
}

export const deliveryInsurance: DeliveryInsurancePort = policyInsurance();

/**
 * Third-party couriers are OFF unless switched on explicitly. A courier is
 * built only when ALL of these hold; otherwise the refuse-everything adapter
 * stands in (no capabilities, so the risk gate excludes it with a reason):
 *
 *   - its id is listed in DELIVERY_PROVIDERS;
 *   - DELIVERY_PROVIDER_<ID>_ENABLED=true (explicit: the registry's "on by
 *     default" applies to our own fleet only);
 *   - sandbox mode: not on the production deployment (VERCEL_ENV), and offered
 *     to customers only with DELIVERY_ALLOW_SANDBOX=true (buildDeliveryRegistry);
 *   - production mode: DELIVERY_PROVIDER_<ID>_PRODUCTION_APPROVED=true, set
 *     only after the founder's approval and a verified transit-cover policy.
 *
 * Even then the core still requires the delivery_courier flag, a non-zero
 * DELIVERY_POLICY.automatedDeliveryMaxItemValueCents, verified cover in
 * DELIVERY_POLICY.insurance and the custody capabilities (policy.ts).
 */
export function gatedCourierFactory(providerId: string, env: Env, build: DeliveryAdapterFactory): DeliveryAdapterFactory {
  return (mode) => {
    const k = envKey(providerId);
    if ((env[`DELIVERY_PROVIDER_${k}_ENABLED`] ?? '').toLowerCase() !== 'true') return refusingDeliveryAdapter(providerId, 'is not enabled');
    if (mode === 'sandbox' && env.VERCEL_ENV === 'production') return refusingDeliveryAdapter(providerId, 'sandbox is not allowed on the production deployment');
    if (mode === 'production' && (env[`DELIVERY_PROVIDER_${k}_PRODUCTION_APPROVED`] ?? '').toLowerCase() !== 'true') {
      return refusingDeliveryAdapter(providerId, 'is not approved for production');
    }
    return build(mode);
  };
}

/** The courier adapters we have, each behind the explicit switch above. */
export function courierFactories(env: Env): Record<string, DeliveryAdapterFactory> {
  return {
    [UBER_DIRECT_PROVIDER_ID]: gatedCourierFactory(UBER_DIRECT_PROVIDER_ID, env, (mode) => createUberDirectAdapter(uberDirectConfigFromEnv(env, mode))),
    [WUMDROP_PROVIDER_ID]: gatedCourierFactory(WUMDROP_PROVIDER_ID, env, (mode) => createWumdropAdapter(wumdropConfigFromEnv(env, mode))),
  };
}

/** The registry for this deployment. The manual adapter's tasks live in Supabase. */
export function deliveryProviders(taskStore: ManualTaskStore, env: Env = process.env): DeliveryProviderRegistry {
  return buildDeliveryRegistry(env, {
    [MANUAL_PROVIDER_ID]: () => createManualDeliveryAdapter(taskStore),
    ...courierFactories(env),
  });
}
