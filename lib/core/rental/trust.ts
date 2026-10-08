/**
 * Renter trust tiers and collection rules (spec §3.5, §7.9). Pure.
 *
 * The server computes the tier from facts it holds. The browser never sends
 * or stores a tier.
 *
 * The limit is checked against the replacement value of ALL gear the renter
 * holds or has booked at the same time, plus the new order. It does not look
 * at the new order's price alone.
 *
 * Meaning of the history thresholds (recorded in the decision register,
 * REQUIRES_FOUNDER_APPROVAL for final values):
 *   - "qualifying history" = whole days since the renter's FIRST clean
 *     return, provided nothing currently counts against them (open dispute,
 *     unreturned overdue gear, fraud flag, suspension).
 *   - A late return (returned after the booked end) is not "clean".
 */

export type TrustTierId = 'none' | 'contactable' | 'verified' | 'proven' | 'trusted';

export interface TrustTierRule {
  id: TrustTierId;
  label: string;
  /** Maximum replacement value held at once, in cents. */
  maxExposureCents: number;
}

export const TRUST_TIERS: readonly TrustTierRule[] = [
  { id: 'none', label: 'Not yet eligible', maxExposureCents: 0 },
  { id: 'contactable', label: 'Contactable', maxExposureCents: 200_000 },
  { id: 'verified', label: 'Verified', maxExposureCents: 1_000_000 },
  { id: 'proven', label: 'Proven', maxExposureCents: 2_500_000 },
  { id: 'trusted', label: 'Trusted', maxExposureCents: 8_000_000 },
];

export const TRUST_THRESHOLDS = {
  proven: { cleanReturns: 1, historyDays: 14 },
  trusted: { cleanReturns: 5, cleanReturnValueCents: 5_000_000, historyDays: 90 },
} as const;

export interface RenterFacts {
  emailVerified: boolean;
  phoneVerified: boolean;
  /** Government ID and selfie approved by a person (not an AI score alone). */
  identityApproved: boolean;
  /** Bank account validated against the renter's name by a provider. */
  bankValidated: boolean;
  cleanReturns: number;
  /** Sum of replacement value of gear returned clean, in cents. */
  cleanReturnValueCents: number;
  /** ISO timestamp of the first clean return, if any. */
  firstCleanReturnAt: string | null;
  openDisputes: number;
  /** Bookings currently overdue (gear not back). */
  overdueNow: number;
  /** Late returns in the last 180 days. */
  recentLateReturns: number;
  fraudFlags: number;
  suspended: boolean;
  /** Staff put the account under manual review. */
  manualReview: boolean;
}

export type TrustHold =
  | 'suspended'
  | 'open_dispute'
  | 'overdue_gear'
  | 'fraud_flag'
  | 'manual_review';

export interface TrustAssessment {
  tier: TrustTierRule;
  /** The tier the renter's history earns before any hold. */
  earned: TrustTierRule;
  /** Reasons the account cannot book right now, or needs a person to approve. */
  holds: TrustHold[];
  /** Booking may proceed only after a member of staff approves it. */
  requiresManualApproval: boolean;
  /** What would unlock the next tier, for honest "how to raise your limit" text. */
  next: { tier: TrustTierRule; missing: string[] } | null;
}

const tier = (id: TrustTierId): TrustTierRule => {
  const t = TRUST_TIERS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tier ${id}`);
  return t;
};

const DAY_MS = 86_400_000;

function historyDays(facts: RenterFacts, now: Date): number {
  if (!facts.firstCleanReturnAt) return 0;
  const first = new Date(facts.firstCleanReturnAt).getTime();
  if (Number.isNaN(first)) return 0;
  return Math.max(0, Math.floor((now.getTime() - first) / DAY_MS));
}

/** The tier a renter's facts earn, ignoring holds. */
export function earnedTier(facts: RenterFacts, now: Date): { tier: TrustTierRule; next: TrustAssessment['next'] } {
  const missingContactable: string[] = [];
  if (!facts.emailVerified) missingContactable.push('verify your email address');
  if (!facts.phoneVerified) missingContactable.push('verify your phone number');
  if (missingContactable.length) return { tier: tier('none'), next: { tier: tier('contactable'), missing: missingContactable } };

  const missingVerified: string[] = [];
  if (!facts.identityApproved) missingVerified.push('complete identity verification (ID and selfie)');
  if (!facts.bankValidated) missingVerified.push('add a bank account in your own name');
  if (missingVerified.length) return { tier: tier('contactable'), next: { tier: tier('verified'), missing: missingVerified } };

  const days = historyDays(facts, now);
  const p = TRUST_THRESHOLDS.proven;
  const missingProven: string[] = [];
  if (facts.cleanReturns < p.cleanReturns) missingProven.push(`return ${p.cleanReturns - facts.cleanReturns} hire on time and in good condition`);
  if (days < p.historyDays) missingProven.push(`${p.historyDays} days in good standing after your first clean return`);
  if (missingProven.length) return { tier: tier('verified'), next: { tier: tier('proven'), missing: missingProven } };

  const t = TRUST_THRESHOLDS.trusted;
  const missingTrusted: string[] = [];
  if (facts.cleanReturns < t.cleanReturns) missingTrusted.push(`${t.cleanReturns - facts.cleanReturns} more clean returns`);
  if (facts.cleanReturnValueCents < t.cleanReturnValueCents) missingTrusted.push('more gear value returned clean');
  if (days < t.historyDays) missingTrusted.push(`${t.historyDays} days in good standing`);
  if (missingTrusted.length) return { tier: tier('proven'), next: { tier: tier('trusted'), missing: missingTrusted } };

  return { tier: tier('trusted'), next: null };
}

/**
 * Full assessment, including holds. A hold never silently lowers a tier to
 * punish someone: it stops new bookings (or routes them to a person) until it
 * is resolved, and says why, so the renter can challenge it.
 */
export function assessTrust(facts: RenterFacts, now: Date): TrustAssessment {
  const { tier: earned, next } = earnedTier(facts, now);
  const holds: TrustHold[] = [];
  if (facts.suspended) holds.push('suspended');
  if (facts.openDisputes > 0) holds.push('open_dispute');
  if (facts.overdueNow > 0) holds.push('overdue_gear');
  if (facts.fraudFlags > 0) holds.push('fraud_flag');
  if (facts.manualReview) holds.push('manual_review');

  const blocking = holds.some((h) => h === 'suspended' || h === 'overdue_gear');
  const effective = blocking ? tier('none') : earned;
  const requiresManualApproval =
    !blocking && (holds.length > 0 || facts.recentLateReturns >= 2);

  return { tier: effective, earned, holds, requiresManualApproval, next };
}

export interface OrderLineForTrust {
  /** Replacement value of one unit, in cents. */
  unitReplacementValueCents: number;
  quantity: number;
}

export type EligibilityResult =
  | { ok: true; assessment: TrustAssessment; exposureCents: number; collectionRequired: boolean; collectionReasons: string[]; requiresManualApproval: boolean }
  | {
      ok: false;
      code: 'not_eligible' | 'trust_limit' | 'collection_only' | 'account_hold';
      message: string;
      assessment: TrustAssessment;
      exposureCents: number;
    };

export interface CollectionPolicy {
  highValueCollectionThresholdCents: number;
  firstHireCollectionOnly: boolean;
}

/** Why this order must be collected in person (empty = delivery may be offered). */
export function collectionReasons(
  facts: Pick<RenterFacts, 'cleanReturns'>,
  lines: readonly OrderLineForTrust[],
  policy: CollectionPolicy,
): string[] {
  const reasons: string[] = [];
  if (policy.firstHireCollectionOnly && facts.cleanReturns === 0) {
    reasons.push('first_hire');
  }
  if (lines.some((l) => l.unitReplacementValueCents > policy.highValueCollectionThresholdCents)) {
    reasons.push('high_value_item');
  }
  return reasons;
}

const zar = (cents: number): string => `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;

/**
 * Whether a renter may place this order. `currentExposureCents` is the
 * replacement value of everything they already hold or have booked
 * (EXPOSURE_STATUSES), worked out on the server.
 */
export function checkEligibility(params: {
  facts: RenterFacts;
  currentExposureCents: number;
  lines: readonly OrderLineForTrust[];
  delivery: boolean;
  policy: CollectionPolicy;
  now: Date;
}): EligibilityResult {
  const assessment = assessTrust(params.facts, params.now);
  const orderValue = params.lines.reduce((s, l) => s + l.unitReplacementValueCents * Math.max(1, l.quantity), 0);
  const exposureCents = params.currentExposureCents + orderValue;

  if (assessment.holds.includes('suspended') || assessment.holds.includes('overdue_gear')) {
    return {
      ok: false,
      code: 'account_hold',
      assessment,
      exposureCents,
      message: assessment.holds.includes('overdue_gear')
        ? 'Please return the gear you have out before booking more. Contact us if you think this is wrong.'
        : 'Your account is on hold. Contact us to resolve it; you can challenge this decision.',
    };
  }

  if (assessment.tier.id === 'none') {
    const missing = assessment.next?.missing.join(' and ') ?? 'complete your profile';
    return { ok: false, code: 'not_eligible', assessment, exposureCents, message: `Before your first hire, please ${missing}.` };
  }

  if (exposureCents > assessment.tier.maxExposureCents) {
    const held = params.currentExposureCents > 0 ? ` including ${zar(params.currentExposureCents)} you already have booked or out` : '';
    const how = assessment.next ? ` To raise it: ${assessment.next.missing.join('; ')}.` : '';
    return {
      ok: false,
      code: 'trust_limit',
      assessment,
      exposureCents,
      message: `Your current limit is ${zar(assessment.tier.maxExposureCents)} of gear at a time (${assessment.tier.label}). This order brings you to ${zar(exposureCents)}${held}.${how} For a larger hire, contact us.`,
    };
  }

  const reasons = collectionReasons(params.facts, params.lines, params.policy);
  if (params.delivery && reasons.length > 0) {
    return {
      ok: false,
      code: 'collection_only',
      assessment,
      exposureCents,
      message: reasons.includes('first_hire')
        ? 'Your first hire is collected in person so we can check it with you. Delivery opens after your first clean return.'
        : `Items worth more than ${zar(params.policy.highValueCollectionThresholdCents)} are always collected in person.`,
    };
  }

  return {
    ok: true,
    assessment,
    exposureCents,
    collectionRequired: reasons.length > 0,
    collectionReasons: reasons,
    requiresManualApproval: assessment.requiresManualApproval,
  };
}
