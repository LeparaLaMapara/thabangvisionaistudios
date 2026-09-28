import { describe, it, expect } from 'vitest';
import { paystackReady } from '@/lib/payments/paystack';

describe('Paystack may take payments', () => {
  it('never with test keys on the live site', () => {
    expect(paystackReady('sk_test_abc', 'production')).toBe(false);
  });
  it('with live keys on the live site', () => {
    expect(paystackReady('sk_live_abc', 'production')).toBe(true);
  });
  it('with test keys in previews and locally', () => {
    expect(paystackReady('sk_test_abc', 'preview')).toBe(true);
    expect(paystackReady('sk_test_abc', undefined)).toBe(true);
  });
  it('not without a secret key', () => {
    expect(paystackReady(undefined, 'production')).toBe(false);
  });
});
