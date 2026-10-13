import { RENTAL_POLICY } from '@/lib/constants';
import type { DeliveryInsurancePort } from '@/lib/core/delivery/port';
import { DEFAULT_DELIVERY_POLICY, type DeliveryPolicyValues } from '@/lib/core/delivery/policy';
import type { DeliveryProviderRegistry } from '@/lib/core/delivery/repository';

type Env = Record<string, string | undefined>;

/**
 * Courier trial on test deployments only (owner request 2026-10-13: "try the
 * whole delivery flow in a preview"). It lifts the three gates that keep every
 * courier off today, and ONLY for couriers running on test keys:
 *
 *   - the delivery_courier flag (D-37 tooling),
 *   - DELIVERY_POLICY.automatedDeliveryMaxItemValueCents = 0 (D-37),
 *   - no verified transit cover (D-41).
 *
 * Never on the production deployment: VERCEL_ENV=production returns null
 * whatever else is set, and so does a registry that does not allow sandbox
 * providers (buildDeliveryRegistry refuses that on production too). A live
 * courier (mode production) is never "covered" by the trial, so live
 * couriers stay behind the real gates even on a preview.
 *
 * Switch: DELIVERY_SANDBOX_TRIAL=true, with DELIVERY_ALLOW_SANDBOX=true and a
 * courier set to DELIVERY_PROVIDER_<ID>_MODE=sandbox.
 */
export interface SandboxCourierTrial {
  courierEnabled: true;
  policy: DeliveryPolicyValues;
  insurance: DeliveryInsurancePort;
}

/** The trial's stand-in for cover. Says plainly that it is not insurance. */
export const SANDBOX_TRIAL_POLICY_REF = 'sandbox-trial-not-insurance';

export function sandboxCourierTrial(env: Env, registry: Pick<DeliveryProviderRegistry, 'list' | 'allowSandbox'>): SandboxCourierTrial | null {
  if (env.VERCEL_ENV === 'production') return null;
  if ((env.DELIVERY_SANDBOX_TRIAL ?? '').toLowerCase() !== 'true') return null;
  if (!registry.allowSandbox) return null;
  const sandboxCouriers = new Set(
    registry
      .list()
      .filter((p) => (p.kind ?? 'courier') === 'courier' && p.mode === 'sandbox')
      .map((p) => p.providerId),
  );
  if (sandboxCouriers.size === 0) return null;
  // Items at or above this are collection-only anyway (RENTAL_POLICY).
  const maxItemValueCents = RENTAL_POLICY.highValueCollectionThresholdCents;
  return {
    courierEnabled: true,
    policy: { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: maxItemValueCents },
    insurance: {
      async coverFor({ providerId }) {
        if (!sandboxCouriers.has(providerId)) return { covered: false, policyRef: null, maxItemValueCents: 0, reason: 'provider_not_covered' };
        return { covered: true, policyRef: SANDBOX_TRIAL_POLICY_REF, maxItemValueCents, reason: null };
      },
    },
  };
}
