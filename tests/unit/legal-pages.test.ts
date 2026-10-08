import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '@/lib/ai/registry';
import { AI_PROVIDERS_DISCLOSED, listInProse } from '@/lib/consent/legal-facts';

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');

const terms = read('app/(marketing)/legal/page.tsx');
const privacy = read('app/(marketing)/privacy/page.tsx');
const refunds = read('app/(marketing)/refunds/page.tsx');
const consentStep = read('components/verification/ConsentStep.tsx');
const all = [terms, privacy, refunds, consentStep].join('\n');

describe('legal pages state only what is true', () => {
  it('make no VAT-vendor claims while not registered', () => {
    expect(all).not.toMatch(/registered VAT vendor/);
    expect(all).not.toMatch(/including VAT/i);
    expect(all).not.toMatch(/before VAT/i);
    expect(all).not.toMatch(/excluding VAT/i);
    expect(all).not.toMatch(/tax invoice/i);
  });

  it('do not pair a 7-day notice deadline with the CPA s56 right', () => {
    expect(refunds).not.toMatch(/section 56/);
    expect(refunds).toMatch(/Nothing in this policy limits your rights under the Consumer Protection Act/);
  });

  it('call the delivery distance an estimate', () => {
    expect(terms).toMatch(/an estimate of the road distance/);
  });

  it('give the real purpose of address coordinates', () => {
    expect(privacy).not.toMatch(/match you with nearby crew/);
    expect(privacy).toMatch(/delivery distance and fee/);
  });

  it('only say online payment is off when it is (no unconditional wording)', () => {
    expect(all).not.toMatch(/While online (card )?payment is not (yet open|offered)/);
    expect(terms).toMatch(/paymentsOpen \?/);
    expect(refunds).toMatch(/paymentsOpen \?/);
  });

  it('describe the deposit from RENTAL_POLICY, not as a fixed amount', () => {
    expect(terms).not.toMatch(/fixed amount per item/);
    expect(refunds).not.toMatch(/fixed amount per item/);
    expect(terms).toMatch(/RENTAL_POLICY\.depositRateBps/);
    expect(refunds).toMatch(/RENTAL_POLICY\.depositRateBps/);
  });

  it('do not assert a processing country for the face comparison', () => {
    expect(all).not.toMatch(/processed by Google, outside South Africa/);
    expect(all).not.toMatch(/written processing agreements/);
  });

  it('take Last updated from the versioned documents', () => {
    expect(terms).toMatch(/documents\.terms\.version/);
    expect(privacy).toMatch(/documents\.privacy\.version/);
    expect(refunds).toMatch(/documents\.refunds\.version/);
  });

  it('carry the anchors the document hrefs point at', () => {
    expect(terms).toMatch(/id="equipment-hire"/);
    expect(privacy).toMatch(/id="identity-verification"/);
  });
});

describe('AI provider disclosure', () => {
  it('names every third-party provider the model registry can route to', () => {
    const disclosed = AI_PROVIDERS_DISCLOSED.join(' ').toLowerCase();
    for (const p of PROVIDERS.filter((x) => x !== 'local')) {
      expect(disclosed).toContain(p);
    }
  });

  it('lists in prose', () => {
    expect(listInProse(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listInProse(['A'])).toBe('A');
  });
});
