import { describe, it, expect } from 'vitest';
import { codesMatch, hashCode, maskPhone, newCode, normaliseSaMobile } from '@/lib/sms/phone';

describe('South African mobile numbers', () => {
  it('accepts the common ways people write them', () => {
    expect(normaliseSaMobile('082 123 4567')).toBe('+27821234567');
    expect(normaliseSaMobile('+27 82 123 4567')).toBe('+27821234567');
    expect(normaliseSaMobile('27821234567')).toBe('+27821234567');
    expect(normaliseSaMobile('071-555-0000')).toBe('+27715550000');
  });
  it('rejects landlines, short and foreign numbers', () => {
    expect(normaliseSaMobile('011 123 4567')).toBeNull();
    expect(normaliseSaMobile('08212345')).toBeNull();
    expect(normaliseSaMobile('+44 7700 900123')).toBeNull();
  });
  it('masks a number for display', () => {
    expect(maskPhone('+27821234567')).toBe('082 *** 4567');
  });
});

describe('one-time codes', () => {
  it('are six digits', () => {
    for (let i = 0; i < 20; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
  it('are stored hashed per person and compared safely', () => {
    const h = hashCode('123456', 'user-a', 's3cret');
    expect(h).not.toContain('123456');
    expect(codesMatch(hashCode('123456', 'user-a', 's3cret'), h)).toBe(true);
    expect(codesMatch(hashCode('123456', 'user-b', 's3cret'), h)).toBe(false);
    expect(codesMatch(hashCode('654321', 'user-a', 's3cret'), h)).toBe(false);
  });
});
