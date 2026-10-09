/**
 * Who may have gear delivered, and which providers may carry it (spec Phase 4
 * §4.2, §4.6, §4.13). Pure.
 *
 * The rental rules are NOT re-implemented here: the trust tier, the first-hire
 * rule and the high-value rule all come from lib/core/rental/trust.ts
 * (checkEligibility with delivery = true, collectionReasons), so delivery can
 * never become a way around them. This module adds what only delivery needs:
 * the service area, the automated-courier value threshold, and the provider
 * risk gate (cover + custody capabilities), which no price can override.
 */

import { DELIVERY_POLICY, RENTAL_POLICY, STUDIO } from '@/lib/constants';
import {
  checkEligibility,
  collectionReasons,
  type CollectionPolicy,
  type HoldingForTrust,
  type OrderLineForTrust,
  type RenterFacts,
} from '@/lib/core/rental/trust';
import { missingCapabilities, type DeliveryCapabilities, type DeliveryNeed } from './capabilities';
import type { DeliveryInsurancePort, DeliveryWindow, ParcelItem } from './port';
import type { ShipmentLeg } from './state';

/** 'own_fleet' = our own vehicle and staff; 'courier' = an automated third-party courier. */
export type DeliveryMode = 'own_fleet' | 'courier';

export type DeliveryIneligibleCode =
  | 'first_hire'
  | 'high_value_item'
  | 'trust_limit'
  | 'not_eligible'
  | 'account_hold'
  | 'out_of_area'
  | 'delivery_disabled';

/** Why automated courier delivery is not offered (own-vehicle delivery may still be). */
export type CourierBlock = 'flag_off' | 'value_threshold';

export type DeliveryEligibility =
  | { ok: true; modes: DeliveryMode[]; courierBlockedBy: CourierBlock[]; requiresManualApproval: boolean; exposureCents: number }
  | { ok: false; code: DeliveryIneligibleCode; message: string; collectionOnly: true };

export interface DeliveryPolicyValues {
  automatedDeliveryMaxItemValueCents: number;
  requireHandToHand: boolean;
  requiredCourierCapabilities: readonly DeliveryNeed[];
  serviceProvince: string;
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicyValues = {
  automatedDeliveryMaxItemValueCents: DELIVERY_POLICY.automatedDeliveryMaxItemValueCents,
  requireHandToHand: DELIVERY_POLICY.requireHandToHand,
  requiredCourierCapabilities: DELIVERY_POLICY.requiredCourierCapabilities,
  serviceProvince: STUDIO.serviceArea.province,
};

export const RENTAL_COLLECTION_POLICY: CollectionPolicy = {
  highValueCollectionThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents,
  firstHireCollectionOnly: RENTAL_POLICY.firstHireCollectionOnly,
};

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/** Whether a verified address is inside the area we deliver to (Gauteng). Unknown province = outside. */
export function inServiceArea(point: { province?: string | null }, policy: Pick<DeliveryPolicyValues, 'serviceProvince'> = DEFAULT_DELIVERY_POLICY): boolean {
  return norm(point.province) !== '' && norm(point.province) === norm(policy.serviceProvince);
}

/**
 * Whether this renter may have this order delivered, and by which means
 * (D01, D02, D03, D05). Collection in person is always the fallback: an
 * ineligible result never blocks the booking itself.
 */
export function evaluateDeliveryEligibility(p: {
  facts: RenterFacts;
  currentExposureCents: number;
  holdings?: readonly HoldingForTrust[];
  lines: readonly OrderLineForTrust[];
  destination: { province?: string | null };
  /** The `delivery_courier` feature flag. */
  courierFlagEnabled: boolean;
  /** Own-vehicle delivery switched on (STUDIO.fulfilment.delivery.enabled). */
  ownFleetEnabled: boolean;
  now: Date;
  policy?: DeliveryPolicyValues;
  collection?: CollectionPolicy;
}): DeliveryEligibility {
  const policy = p.policy ?? DEFAULT_DELIVERY_POLICY;
  const collection = p.collection ?? RENTAL_COLLECTION_POLICY;
  const r = checkEligibility({
    facts: p.facts,
    currentExposureCents: p.currentExposureCents,
    holdings: p.holdings,
    lines: p.lines,
    delivery: true,
    policy: collection,
    now: p.now,
  });
  if (!r.ok) {
    if (r.code === 'collection_only') {
      const reasons = collectionReasons(p.facts, p.lines, collection);
      const code: DeliveryIneligibleCode = reasons.includes('first_hire') ? 'first_hire' : 'high_value_item';
      return { ok: false, code, message: r.message, collectionOnly: true };
    }
    return { ok: false, code: r.code, message: r.message, collectionOnly: true };
  }

  if (!inServiceArea(p.destination, policy)) {
    return { ok: false, code: 'out_of_area', message: `We deliver in ${policy.serviceProvince} only. ${STUDIO.serviceArea.outsideProvinceNote}`, collectionOnly: true };
  }

  const modes: DeliveryMode[] = [];
  const courierBlockedBy: CourierBlock[] = [];
  if (p.ownFleetEnabled) modes.push('own_fleet');
  if (!p.courierFlagEnabled) courierBlockedBy.push('flag_off');
  if (!courierValueAllowed(p.lines, policy)) courierBlockedBy.push('value_threshold');
  if (courierBlockedBy.length === 0) modes.push('courier');

  if (modes.length === 0) {
    return { ok: false, code: 'delivery_disabled', message: 'Delivery is not available for this order. You can collect it in person.', collectionOnly: true };
  }
  return { ok: true, modes, courierBlockedBy, requiresManualApproval: r.requiresManualApproval, exposureCents: r.exposureCents };
}

/** Every item is at or below the founder-approved automated-courier threshold (0 = none is). */
export function courierValueAllowed(lines: readonly { unitReplacementValueCents: number }[], policy: Pick<DeliveryPolicyValues, 'automatedDeliveryMaxItemValueCents'> = DEFAULT_DELIVERY_POLICY): boolean {
  if (policy.automatedDeliveryMaxItemValueCents <= 0) return false;
  return lines.every((l) => l.unitReplacementValueCents <= policy.automatedDeliveryMaxItemValueCents);
}

export type InsuranceAnswer = Awaited<ReturnType<DeliveryInsurancePort['coverFor']>>;

export interface ProviderGateSubject {
  providerId: string;
  kind?: 'courier' | 'own_fleet';
  mode?: 'sandbox' | 'production';
  capabilities: DeliveryCapabilities;
}

/**
 * The provider risk gate (D04, D27). Spec §4.6 priorities 1–3 and part of 5:
 * legal/contractual eligibility, verified cover, custody capabilities, and the
 * capability the requested window needs. A provider failing any of them is
 * excluded whatever it costs. Our own fleet proves custody with our own
 * handover evidence and is not subject to the courier cover gate (it follows
 * the existing own-vehicle rules; see D-40).
 */
export function providerRiskGate(p: {
  provider: ProviderGateSubject;
  leg: ShipmentLeg;
  items: readonly ParcelItem[];
  window: DeliveryWindow;
  /** The insurance port's answer for this provider, leg and items. Required for couriers. */
  insurance: InsuranceAnswer | null;
  allowSandbox: boolean;
  policy?: DeliveryPolicyValues;
}): { eligible: boolean; reasons: string[] } {
  const policy = p.policy ?? DEFAULT_DELIVERY_POLICY;
  const reasons: string[] = [];
  const kind = p.provider.kind ?? 'courier';
  const caps = p.provider.capabilities;

  if ((p.provider.mode ?? 'production') === 'sandbox' && !p.allowSandbox) reasons.push('sandbox_provider');

  const needs: DeliveryNeed[] = [];
  if (kind === 'courier') {
    needs.push(...policy.requiredCourierCapabilities);
    if (!courierValueAllowed(p.items.map((i) => ({ unitReplacementValueCents: i.replacementValueCents })), policy)) {
      reasons.push('item_value_above_automated_threshold');
    }
    const cover = p.insurance;
    if (!cover || !cover.covered || !cover.policyRef) {
      reasons.push('not_covered');
    } else if (p.items.some((i) => i.replacementValueCents > cover.maxItemValueCents)) {
      reasons.push('item_value_above_cover');
    }
  } else {
    // Our own handover evidence: collection and delivery are confirmed by our staff and the renter.
    needs.push('pickupConfirmation', 'proofOfDelivery');
  }
  if (policy.requireHandToHand) needs.push('noLeaveAtDoor');
  if (p.leg === 'return') needs.push('reverseLogistics');
  needs.push(p.window.start === null ? 'onDemand' : 'scheduled');

  for (const m of missingCapabilities(caps, [...new Set(needs)])) reasons.push(`missing_capability:${m}`);
  return { eligible: reasons.length === 0, reasons };
}
