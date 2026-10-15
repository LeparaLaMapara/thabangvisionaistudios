import { describe, it, expect } from 'vitest';
import { RENTAL_POLICY } from '@/lib/constants';
import { gearLimitNote } from '@/lib/rental/limit-note';

const L = RENTAL_POLICY.trustTierLimitsCents;

describe('gear page: limit said before dates are picked', () => {
  it('nothing to say when a new account can rent it', () => {
    expect(gearLimitNote(0)).toBeNull();
    expect(gearLimitNote(L.contactable)).toBeNull();
  });

  it('just above the start limit: a bank account in your own name', () => {
    const note = gearLimitNote(L.contactable + 100) ?? '';
    expect(note).toContain('New accounts can rent up to R2 000 of gear at a time at first.');
    expect(note).toContain('add a bank account in your own name');
    expect(note).toContain('R10 000');
  });

  it('a R20 000 camera: bank account, then an on-time return', () => {
    const note = gearLimitNote(2_000_000) ?? '';
    expect(note).toContain('valued at R20 000');
    expect(note).toContain('14 days after your first on-time return');
  });

  it('above every limit: WhatsApp us', () => {
    expect(gearLimitNote(L.trusted + 100)).toContain('more than our largest limit');
  });
});

describe('a R35 000 camera', () => {
  it('rises with on-time returns up to the top limit', () => {
    expect(gearLimitNote(3_500_000)).toContain('up to R80 000 once you have made 5 on-time returns');
  });
});
