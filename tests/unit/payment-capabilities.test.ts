import { describe, it, expect } from 'vitest';
import {
  NO_PAYMENT_CAPABILITIES,
  NO_PAYOUT_CAPABILITIES,
  payoutRail,
  selectPaymentAdapter,
  selectPayoutAdapter,
} from '@/lib/core/payments/capabilities';
import { PAYSTACK_PAYMENT_CAPABILITIES, PAYSTACK_PAYOUT_CAPABILITIES } from '@/lib/payments/paystack-ports';

const ZA = { currency: 'ZAR', country: 'ZA' };

describe('capability-aware provider selection (spec §8.4)', () => {
  const paystack = { provider: 'paystack', capabilities: PAYSTACK_PAYMENT_CAPABILITIES };
  const none = { provider: 'other', capabilities: NO_PAYMENT_CAPABILITIES };

  it('picks the first adapter that can do everything asked, in this currency and country', () => {
    expect(selectPaymentAdapter([none, paystack], ['refundLookup', 'partialRefunds'], ZA)).toEqual({ ok: true, adapter: paystack });
  });

  it('refuses rather than falling back when no adapter has the capability', () => {
    const r = selectPaymentAdapter([paystack], ['cardPreauthorisation'], ZA);
    expect(r.ok).toBe(false);
  });

  it('respects currency and country', () => {
    expect(selectPaymentAdapter([paystack], ['cardPayments'], { currency: 'USD', country: 'ZA' }).ok).toBe(false);
    expect(selectPaymentAdapter([paystack], ['cardPayments'], { currency: 'ZAR', country: 'NG' }).ok).toBe(false);
  });

  it('payout selection works the same way', () => {
    const p = { provider: 'paystack', capabilities: PAYSTACK_PAYOUT_CAPABILITIES };
    expect(selectPayoutAdapter([p], ['bankTransfers', 'transferVerification'], ZA).ok).toBe(true);
    expect(selectPayoutAdapter([p], ['instantTransfers'], ZA).ok).toBe(false);
    expect(selectPayoutAdapter([{ provider: 'x', capabilities: NO_PAYOUT_CAPABILITIES }], [], ZA).ok).toBe(false);
  });
});

describe('instant payouts stay behind a flag and verified capability (spec §8.5)', () => {
  const instant = { ...PAYSTACK_PAYOUT_CAPABILITIES, instantTransfers: true };

  it('is standard while the flag is off, whatever the adapter can do', () => {
    expect(payoutRail({ capabilities: instant, instantFlagEnabled: false, amountCents: 1000, instantLimitCents: 5_000_000 })).toBe('standard');
  });

  it('is standard when the adapter has no verified instant rail', () => {
    expect(payoutRail({ capabilities: PAYSTACK_PAYOUT_CAPABILITIES, instantFlagEnabled: true, amountCents: 1000, instantLimitCents: 5_000_000 })).toBe('standard');
  });

  it('is standard above the rail limit or with no known limit', () => {
    expect(payoutRail({ capabilities: instant, instantFlagEnabled: true, amountCents: 6_000_000, instantLimitCents: 5_000_000 })).toBe('standard');
    expect(payoutRail({ capabilities: instant, instantFlagEnabled: true, amountCents: 1000, instantLimitCents: null })).toBe('standard');
  });

  it('is instant only when every condition holds', () => {
    expect(payoutRail({ capabilities: instant, instantFlagEnabled: true, amountCents: 1000, instantLimitCents: 5_000_000 })).toBe('instant');
  });

  it('the Paystack adapter claims no instant rail and no pre-authorisation (not implemented or verified)', () => {
    expect(PAYSTACK_PAYOUT_CAPABILITIES.instantTransfers).toBe(false);
    expect(PAYSTACK_PAYMENT_CAPABILITIES.cardPreauthorisation).toBe(false);
  });
});
