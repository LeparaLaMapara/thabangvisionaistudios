import { describe, it, expect } from 'vitest';
import { coreFaqs } from '@/lib/content/faqs';
import { RENTAL_CITIES, SA_CITIES, deliversRentals } from '@/lib/seo/cities';
import { STUDIO } from '@/lib/constants';

describe('core FAQ answers come from the settings checkout uses', () => {
  const faqs = coreFaqs();
  const text = (id: string) => faqs.find((f) => f.id === id)!.answer;

  it('has at least ten answers with unique ids', () => {
    expect(faqs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(faqs.map((f) => f.id)).size).toBe(faqs.length);
  });

  it('states the notice period, delivery radius and rate as configured', () => {
    expect(text('core-notice')).toContain(`${STUDIO.rental.minLeadTimeHours / 24} days`);
    expect(text('core-collect-deliver')).toContain(`${STUDIO.fulfilment.delivery.maxRadiusKm} km`);
    expect(text('core-collect-deliver')).toContain(`R${STUDIO.fulfilment.delivery.ratePerKm} per km`);
  });

  it('never promises what the site does not do', () => {
    const all = faqs.map((f) => f.answer).join(' ').toLowerCase();
    for (const claim of ['insured', 'instant', 'certified copy is required', 'whatsapp']) {
      expect(all).not.toContain(claim);
    }
  });
});

describe('rental city pages exist only where gear reaches', () => {
  it('keeps the Gauteng cities and drops the rest', () => {
    expect(RENTAL_CITIES.map((c) => c.slug)).toEqual(expect.arrayContaining(['johannesburg', 'pretoria', 'sandton', 'soweto']));
    expect(RENTAL_CITIES.find((c) => c.slug === 'cape-town')).toBeUndefined();
    expect(SA_CITIES.filter((c) => !deliversRentals(c)).map((c) => c.slug)).toContain('durban');
  });
});
