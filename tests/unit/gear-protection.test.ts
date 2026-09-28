import { describe, it, expect } from 'vitest';
import { checkProtection, itemValue, nextTier, protectionLine, tierFor } from '@/lib/rental/protection';
import { handoverAgreement } from '@/lib/rental/agreement';

describe('trust ladder', () => {
  it('starts new renters at R5 000 and raises the limit with clean returns', () => {
    expect(tierFor(0).maxValue).toBe(5000);
    expect(tierFor(1).maxValue).toBe(5000);
    expect(tierFor(2).maxValue).toBe(20000);
    expect(tierFor(9).maxValue).toBe(60000);
    expect(nextTier(0)?.cleanReturns).toBe(2);
    expect(nextTier(9)).toBeNull();
  });

  it('refuses an order over the limit and says what raises it', () => {
    const r = checkProtection({ cleanReturns: 0, alreadyOut: 0, orderValue: 8000, delivery: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('trust_limit');
      expect(r.message).toMatch(/R5.000/);
      expect(r.message).toMatch(/2 more on-time returns/);
    }
  });

  it('counts gear already out against the limit', () => {
    const r = checkProtection({ cleanReturns: 2, alreadyOut: 15000, orderValue: 6000, delivery: false });
    expect(r.ok).toBe(false);
  });

  it('allows an order within the limit', () => {
    expect(checkProtection({ cleanReturns: 0, alreadyOut: 0, orderValue: 4500, delivery: false }).ok).toBe(true);
  });
});

describe('collection only', () => {
  it('first hire must be collected', () => {
    const r = checkProtection({ cleanReturns: 0, alreadyOut: 0, orderValue: 1000, delivery: true });
    expect(r.ok === false && r.code).toBe('collection_only');
  });
  it('large orders must be collected', () => {
    const r = checkProtection({ cleanReturns: 5, alreadyOut: 0, orderValue: 25000, delivery: true });
    expect(r.ok === false && r.code).toBe('collection_only');
  });
  it('a trusted renter may have a normal order delivered', () => {
    expect(checkProtection({ cleanReturns: 2, alreadyOut: 0, orderValue: 3000, delivery: true }).ok).toBe(true);
  });
});

describe('value and listing line', () => {
  it('uses the replacement value, or the deposit when none is recorded', () => {
    expect(itemValue({ replacement_value: 30000, deposit_amount: 2000 })).toBe(30000);
    expect(itemValue({ replacement_value: null, deposit_amount: 2000 })).toBe(2000);
  });
  it('claims only what is true of the item', () => {
    expect(protectionLine({ serial_number: null, tracker_fitted: true })).toBeNull();
    expect(protectionLine({ serial_number: 'ABC123', tracker_fitted: false })).toMatch(/^Serial-registered\./);
    expect(protectionLine({ serial_number: 'ABC123', tracker_fitted: true })).toMatch(/and tracked/);
  });
});

describe('handover agreement', () => {
  it('names the renter, the serial and the police step', () => {
    const lines = handoverAgreement({ renterName: 'Lerato Mokoena', reference: 'AB12', startDate: '2026-10-01', endDate: '2026-10-03', items: [{ title: 'Sony A7 IV', serial: 'S123' }], deposit: 3000 });
    const text = lines.join(' ');
    expect(text).toContain('Lerato Mokoena');
    expect(text).toContain('serial S123');
    expect(text).toMatch(/Police Service/);
  });
});
