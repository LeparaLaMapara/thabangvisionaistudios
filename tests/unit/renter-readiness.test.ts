import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));

import { RENTAL_POLICY } from '@/lib/constants';
import {
  TRUST_REQUIREMENT_CODES,
  checkEligibility,
  earnedTier,
  type OrderLineForTrust,
  type RenterFacts,
} from '@/lib/core/rental/trust';
import { REQUIREMENT_LINKS, buildReadiness, trustLinesFromCart } from '@/lib/rental/eligibility-server';

/**
 * Phase 3 (spec §9): the requirements a renter must meet are shown before
 * they pay, from the same rules the checkout enforces. Every requirement
 * carries a machine code and a place to fix it.
 */

const NOW = new Date('2026-10-09T08:00:00Z');
const LIMITS = RENTAL_POLICY.trustTierLimitsCents;

const newRenter: RenterFacts = {
  emailVerified: true,
  phoneVerified: false,
  identityApproved: false,
  bankValidated: false,
  cleanReturns: 0,
  cleanReturnValueCents: 0,
  firstCleanReturnAt: null,
  openDisputes: 0,
  overdueNow: 0,
  overdueEscalated: 0,
  recentLateReturns: 0,
  fraudFlags: 0,
  suspended: false,
  manualReview: false,
};
const ready: RenterFacts = { ...newRenter, phoneVerified: true, identityApproved: true, bankValidated: true };

const line = (valueCents: number, quantity = 1): OrderLineForTrust => ({
  unitReplacementValueCents: valueCents,
  quantity,
  startDate: '2026-10-20',
  endDate: '2026-10-22',
});

const build = (facts: RenterFacts, lines: OrderLineForTrust[], extra: Partial<Parameters<typeof buildReadiness>[0]> = {}) =>
  buildReadiness({
    facts,
    verificationStatus: facts.identityApproved ? 'verified' : 'unverified',
    holdings: [],
    lines,
    delivery: false,
    now: NOW,
    phoneChecksAvailable: true,
    ...extra,
  });

describe('trust requirements carry machine codes', () => {
  const bools = [true, false];
  const combos: RenterFacts[] = [];
  for (const emailVerified of bools)
    for (const phoneVerified of bools)
      for (const identityApproved of bools)
        for (const bankValidated of bools)
          for (const cleanReturns of [0, 1, 6])
            for (const firstCleanReturnAt of [null, '2026-01-01T00:00:00Z'])
              combos.push({ ...newRenter, emailVerified, phoneVerified, identityApproved, bankValidated, cleanReturns, firstCleanReturnAt, cleanReturnValueCents: cleanReturns * 1_000_000 });

  it('every missing requirement has a known code, in step with the text', () => {
    for (const facts of combos) {
      const { next } = earnedTier(facts, NOW);
      if (!next) continue;
      expect(next.items.length).toBe(next.missing.length);
      expect(next.items.map((i) => i.label)).toEqual(next.missing);
      for (const item of next.items) expect(TRUST_REQUIREMENT_CODES).toContain(item.code);
    }
  });

  it('maps the steps a renter can do to the page that does them', () => {
    for (const code of TRUST_REQUIREMENT_CODES) expect(code in REQUIREMENT_LINKS).toBe(true);
    expect(REQUIREMENT_LINKS.verify_phone).toBe('/dashboard/profile#phone');
    expect(REQUIREMENT_LINKS.verify_id).toBe('/dashboard/verification');
    expect(REQUIREMENT_LINKS.validate_bank).toBe('/dashboard/banking');
    expect(REQUIREMENT_LINKS.trust_limit).toBe('/contact');
  });

  it('names email and phone first, then ID and bank', () => {
    expect(earnedTier({ ...newRenter, emailVerified: false }, NOW).next?.items.map((i) => i.code)).toEqual(['verify_email', 'verify_phone']);
    expect(earnedTier({ ...newRenter, phoneVerified: true }, NOW).next?.items.map((i) => i.code)).toEqual(['verify_id', 'validate_bank']);
  });
});

describe('buildReadiness: the checklist before payment', () => {
  it('a new renter sees every step for a small hire, but no bank step', () => {
    const r = build(newRenter, [line(100_000)]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ID_REQUIRED');
    expect(r.missing.map((m) => m.code)).toEqual(['verify_phone', 'verify_id']);
    expect(r.checklist.find((c) => c.code === 'verify_email')?.status).toBe('done');
    expect(r.missing.find((m) => m.code === 'verify_phone')?.href).toBe('/dashboard/profile#phone');
    expect(r.missing.find((m) => m.code === 'verify_id')?.href).toBe('/dashboard/verification');
    expect(r.checklist.some((c) => c.code === 'validate_bank')).toBe(false);
  });

  it('asks for a bank account only when the order needs the higher limit', () => {
    const r = build({ ...newRenter, phoneVerified: true, identityApproved: true }, [line(LIMITS.contactable + 1)]);
    expect(r.missing.map((m) => m.code)).toEqual(['validate_bank']);
    expect(r.missing[0].href).toBe('/dashboard/banking');
    expect(r.code).toBe('trust_limit');
  });

  it('says when no step can unlock the order (history or a person needed)', () => {
    const r = build(ready, [line(LIMITS.verified + 1)]);
    const limit = r.missing.find((m) => m.code === 'trust_limit');
    expect(limit?.href).toBe('/contact');
    expect(r.ok).toBe(false);
    const huge = build(ready, [line(LIMITS.trusted + 1)]);
    expect(huge.missing.map((m) => m.code)).toContain('trust_limit');
  });

  it('counts gear already held on the same dates', () => {
    const r = build(ready, [line(LIMITS.verified - 100)], {
      holdings: [{ startDate: '2026-10-21', endDate: '2026-10-23', valueCents: 200 }],
    });
    expect(r.missing.map((m) => m.code)).toContain('trust_limit');
  });

  // Owner decision 2026-10-14: a step nobody can complete is switched off, not shown.
  it('hides the phone step and does not require it while phone checks are off', () => {
    const r = build({ ...newRenter, phoneRequired: false }, [line(100_000)], { phoneChecksAvailable: false });
    expect(r.missing.find((m) => m.code === 'verify_phone')).toBeUndefined();
    expect(r.phoneChecksAvailable).toBe(false);
    const tier = earnedTier({ ...newRenter, emailVerified: true, phoneRequired: false }, NOW);
    expect(tier.tier.id).toBe('contactable');
    expect(tier.next?.items.map((i) => i.code)).not.toContain('verify_phone');
  });

  it('still requires a confirmed phone once phone checks are on', () => {
    const r = build(newRenter, [line(100_000)], { phoneChecksAvailable: true });
    expect(r.missing.find((m) => m.code === 'verify_phone')?.status).toBe('missing');
    expect(earnedTier({ ...newRenter, emailVerified: true }, NOW).tier.id).toBe('none');
    expect(earnedTier({ ...newRenter, emailVerified: true, phoneRequired: true }, NOW).tier.id).toBe('none');
  });

  it('a pending ID check is shown as waiting, and blocks payment', () => {
    const r = build({ ...newRenter, phoneVerified: true }, [line(100_000)], { verificationStatus: 'pending' });
    expect(r.code).toBe('ID_PENDING');
    expect(r.ok).toBe(false);
    expect(r.checklist.find((c) => c.code === 'verify_id')?.status).toBe('pending');
  });

  it('a ready renter has nothing missing, and learns why delivery is not offered', () => {
    const r = build(ready, [line(100_000)]);
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
    expect(r.missing).toEqual([]);
    expect(r.collectionReasons).toEqual(['first_hire']);
    const high = build({ ...ready, cleanReturns: 1, firstCleanReturnAt: '2026-01-01T00:00:00Z' }, [line(RENTAL_POLICY.highValueCollectionThresholdCents + 1)]);
    expect(high.collectionReasons).toEqual(['high_value_item']);
    const seasoned = build({ ...ready, cleanReturns: 1, firstCleanReturnAt: '2026-01-01T00:00:00Z' }, [line(100_000)]);
    expect(seasoned.collectionRequired).toBe(false);
  });

  it('shows an account hold with a way to challenge it', () => {
    const r = build({ ...ready, suspended: true }, [line(100_000)]);
    expect(r.code).toBe('account_hold');
    expect(r.missing.find((m) => m.code === 'account_hold')?.href).toBe('/contact');
  });

  it('agrees with the checkout rule once identity is approved', () => {
    const facts: RenterFacts[] = [ready, { ...ready, bankValidated: false }, { ...ready, phoneVerified: false }, { ...ready, suspended: true }];
    const values = [50_000, LIMITS.contactable + 1, LIMITS.verified + 1];
    for (const f of facts) {
      for (const v of values) {
        for (const delivery of [false, true]) {
          const lines = [line(v)];
          const rule = checkEligibility({
            facts: f,
            currentExposureCents: 0,
            holdings: [],
            lines,
            delivery,
            policy: { highValueCollectionThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents, firstHireCollectionOnly: RENTAL_POLICY.firstHireCollectionOnly },
            now: NOW,
          });
          const r = build(f, lines, { delivery });
          expect(r.ok).toBe(rule.ok);
          if (!rule.ok) expect(r.code).toBe(rule.code);
        }
      }
    }
  });
});

describe('trustLinesFromCart', () => {
  it('values each line as the checkout does and keeps its own dates', () => {
    const lines = trustLinesFromCart([
      { quantity: 2, start_date: '2026-10-20', end_date: '2026-10-22', rental: { replacement_value: 1500 } },
      { quantity: 1, start_date: null, end_date: null, rental: { replacement_value: 800 } },
    ]);
    expect(lines[0]).toEqual({ unitReplacementValueCents: 150_000, quantity: 2, startDate: '2026-10-20', endDate: '2026-10-22' });
    expect(lines[1]).toEqual({ unitReplacementValueCents: 80_000, quantity: 1 });
  });
});
