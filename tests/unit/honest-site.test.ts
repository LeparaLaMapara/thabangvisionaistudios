import { describe, it, expect } from 'vitest';
import { formatRand, withServiceVat } from '@/lib/format/money';
import { categoryFromPrice } from '@/lib/productions/from-price';
import { calculatePackagePrice } from '@/lib/productions/pricing';
import { cleanRequirements } from '@/lib/content/requirements';
import { displayTag } from '@/lib/content/tags';
import { coreFaqs } from '@/lib/content/faqs';
import { PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { PAYMENTS_NOT_OPEN_NOTICE } from '@/lib/payments/offline-message';

const NBSP = '\u00A0';

describe('formatRand', () => {
  it('writes R1 300 with a space between thousands and no ZAR', () => {
    expect(formatRand(1300)).toBe(`R1${NBSP}300`);
    expect(formatRand(20)).toBe('R20');
    expect(formatRand(47495)).toBe(`R47${NBSP}495`);
    expect(formatRand(1234567)).toBe(`R1${NBSP}234${NBSP}567`);
    expect(formatRand(-150)).toBe('-R150');
    expect(formatRand(1300.5, { decimals: true })).toBe(`R1${NBSP}300.50`);
  });
});

describe('service prices are shown as the customer price', () => {
  it('adds no VAT while the company is not VAT-registered', () => {
    expect(withServiceVat(1800)).toBe(1800);
  });

  it('a category From price is its cheapest package total', () => {
    const weddings = PRODUCTION_PACKAGES.filter((p) => p.category === 'weddings-ceremonies');
    expect(categoryFromPrice(weddings)).toBe(calculatePackagePrice(weddings[0]).total);
    expect(categoryFromPrice([])).toBeNull();
  });

  it('no package is marked popular', () => {
    expect(PRODUCTION_PACKAGES.some((p) => p.popular)).toBe(false);
  });
});

describe('payment wording follows the payment switch', () => {
  const answers = (open: boolean) => coreFaqs({ paymentsOpen: open }).map((f) => f.answer).join(' ');

  it('says card payment is not open while it is closed', () => {
    expect(answers(false)).toContain(PAYMENTS_NOT_OPEN_NOTICE);
    expect(answers(false)).not.toContain('pay online');
  });

  it('drops the notice once payments open', () => {
    expect(answers(true)).not.toContain(PAYMENTS_NOT_OPEN_NOTICE);
  });

  // Founder decision 2026-10-08: not VAT-registered. The VAT answer follows
  // STUDIO.legal.vatRegistered instead of always promising VAT-inclusive prices.
  it('the VAT answer follows the VAT registration setting', () => {
    const vat = coreFaqs().find((f) => f.id === 'core-vat')!.answer;
    expect(vat).not.toContain('excluding VAT');
    if (STUDIO.legal.vatRegistered) {
      expect(vat).toContain('including VAT');
    } else {
      expect(vat).toContain('no VAT is added');
      expect(vat).not.toContain('including VAT');
    }
  });
});

describe('display tidying', () => {
  it('fixes known tag typos without touching others', () => {
    expect(displayTag('Potraits')).toBe('Portraits');
    expect(displayTag('BnW')).toBe('Black and white');
    expect(displayTag('Studio')).toBe('Studio');
  });

  it('strips pasted bullets and joins split lines', () => {
    expect(cleanRequirements(['- 5+ years shooting', 'commercial, corporate, or', 'narrative shoots', '- Own transport.'])).toEqual([
      '5+ years shooting commercial, corporate, or narrative shoots',
      'Own transport.',
    ]);
  });
});
