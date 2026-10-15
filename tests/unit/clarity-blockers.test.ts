/**
 * Clarity audit 2026-10-15 (B1, B2, B5, C1, C2): Ubunye states the same way to
 * pay as /pay and never quotes a person's rate; People names only the kinds
 * of work someone offers; the FAQ, sitemap and studio page tell one story.
 */
import { describe, expect, it } from 'vitest';
import { STUDIO, RENTAL_POLICY, ON_SITE_RENTAL } from '@/lib/constants';
import { buildSystemPrompt, paymentRules, type CachedData } from '@/lib/ubunye/system-prompt';
import { buildBookingPrompt } from '@/lib/agents/agents/booking';
import { followUpsFor } from '@/components/ubunye/FollowUpSuggestions';
import { peopleWords, offeredRoles, joinWords } from '@/lib/roles/offered';
import { studioNeeds } from '@/lib/rental/on-site';
import { coreFaqs } from '@/lib/content/faqs';
import { entriesForSitemap } from '@/lib/discovery/registry';
import { emptyCatalog, type Catalog } from '@/lib/discovery/types';

const data: CachedData = {
  rentals: '',
  productions: null,
  press: '',
  careers: '',
  creators: '',
  listings: '',
  plans: '',
  services: '- Photography: R1500/hour, test service',
  crew: 'Thandi, photography, R1500/hr',
};

describe('Ubunye payment rule follows the /pay switch (B1)', () => {
  it('card open: card only, no EFT, cash or WhatsApp proof of payment, and the bank warning', () => {
    const p = buildSystemPrompt(data, null, { smart_productions: true, payments_open: true });
    expect(p).toContain('paid by card when you book');
    expect(p).toContain('never change');
    expect(p).toContain(`${STUDIO.meta.url}/pay`);
    expect(p).not.toContain('or in cash when you collect');
    expect(p).not.toContain('then send proof of payment');
    expect(p).toContain('never ask anyone to send proof of payment');
    expect(p).not.toContain(STUDIO.bank.accountNumber);
  });

  it('card closed: what /pay says then (EFT, or cash when you collect) and the bank warning', () => {
    const rule = paymentRules(false);
    expect(rule).toContain('by EFT to our business account, or in cash when you collect');
    expect(rule).toContain(`within ${STUDIO.bank.payWithinHours} hours`);
    expect(rule).toContain('cash is for collection only, not delivery');
    expect(rule).toContain('never change');
    expect(rule).not.toContain(STUDIO.bank.accountNumber);
  });

  it('no flag given keeps the cautious (closed) wording', () => {
    expect(buildSystemPrompt(data, null, { smart_productions: false })).toContain(paymentRules(false));
  });
});

describe('Ubunye never quotes a person (B1, B2)', () => {
  it('People on: points to /people, carries no hourly rates or quote tool', () => {
    const p = buildSystemPrompt(data, null, { smart_productions: true, roles_v1: true, payments_open: true });
    expect(p).toContain('[People](/people)');
    expect(p).toContain('NEVER invent, estimate or quote a rate');
    expect(p).not.toContain('R1500/hr');
    expect(p).not.toContain('R1500/hour');
    expect(p).not.toContain('PRODUCTION SERVICES');
    expect(p).not.toContain('calculate_booking_quote');
    const booking = buildBookingPrompt(data, null, { smart_productions: true, roles_v1: true });
    expect(booking).not.toContain('calculate_booking_quote');
    expect(booking).not.toContain('search_creators');
  });

  it('People off: the old Studio rules stay', () => {
    const p = buildSystemPrompt(data, null, { smart_productions: true });
    expect(p).toContain('PRODUCTION SERVICES');
    expect(p).toContain('R1500/hr');
    expect(buildBookingPrompt(data, null, { smart_productions: true })).toContain('calculate_booking_quote');
  });

  it('follow-up buttons match what the creator search found', () => {
    expect(followUpsFor('search_creators', { results: [] })).toEqual([]);
    expect(followUpsFor('search_creators', { results: [{}] })).toEqual(['See their portfolio']);
    expect(followUpsFor('search_creators', { results: [{}, {}] })).toContain('Book the top match');
    expect(followUpsFor('improve_brief')).toEqual(['Submit the improved brief', 'Add more details']);
  });
});

describe('People names only kinds of work someone offers (B5)', () => {
  const live = [
    { slug: 'photographer-videographer', name: 'Photographer or videographer' },
    { slug: 'makeup-artist', name: 'Make-up artist' },
    { slug: 'model', name: 'Model' },
    { slug: 'driver-with-vehicle', name: 'Driver with vehicle' },
  ];

  it('one approved photographer', () => {
    const w = peopleWords(offeredRoles(live, ['photographer-videographer']), live);
    expect(w.heroLine).toBe('Book photographers and videographers, chosen on their work.');
    expect(w.tileSubtitle).toBe('Photographers and videographers');
    expect(w.offerLine).toBe('Camera gear to rent, and photographers and videographers to book.');
    expect(w.heading).toBe('Photographers and videographers');
    expect(w.askLine).toBe('Need make-up, a model or a driver? Tell us your date on WhatsApp and we will find someone.');
    for (const s of [w.heroLine, w.tileSubtitle, w.heading]) expect(s.toLowerCase()).not.toMatch(/make-up|model|driver/);
  });

  it('nobody approved: generic words', () => {
    const w = peopleWords([], live);
    expect(w.heroLine).toBe('Book people for your shoot, chosen on their work.');
    expect(w.tileSubtitle).toBe('People for your shoot');
    expect(w.heading).toBe('People');
  });

  it('everyone offered: a generic ask line', () => {
    expect(peopleWords(live, live).askLine).toBe('Need someone else for your shoot? Tell us your date on WhatsApp and we will find someone.');
    expect(joinWords(['a', 'b', 'c'], 'or')).toBe('a, b or c');
  });
});

describe('One way to book a person (B2)', () => {
  it('FAQ points to People when it is on, and keeps the old answer when off', () => {
    const on = coreFaqs({ rolesOn: true }).find((f) => f.id === 'core-photographer')!.answer;
    expect(on).toContain('Go to People');
    expect(on).not.toContain('Studio page');
    expect(coreFaqs().find((f) => f.id === 'core-photographer')!.answer).toContain('Studio page');
  });

  it('sitemaps drop the creator, category and city pages with People on', () => {
    const c: Catalog = {
      ...emptyCatalog(),
      studioOn: true,
      creators: [
        {
          id: 'x',
          name: 'T',
          path: '/studio/category/photography/t',
          category: 'photography',
          handle: 't',
          specializations: ['photography'],
          location: 'Johannesburg',
          citySlugs: ['johannesburg'],
          avatar: null,
          bio: null,
          hourlyRate: 600,
          yearsExperience: null,
        },
      ] as unknown as Catalog['creators'],
      studioCategories: [
        { slug: 'photography', name: 'Photography', path: '/studio/category/photography', description: '', updatedAt: null, creatorKeywords: ['photography'] },
      ] as unknown as Catalog['studioCategories'],
    };
    const all = (cat: Catalog) => [...entriesForSitemap(cat, 'creators'), ...entriesForSitemap(cat, 'studio')].map((e) => e.path);
    expect(all(c).some((p) => p.startsWith('/studio/category'))).toBe(true);
    const on = all({ ...c, rolesOn: true });
    expect(on.some((p) => p.startsWith('/studio/category'))).toBe(false);
    expect(on).not.toContain('/smart-creators');
    expect(on).not.toContain('/studio');
  });
});

describe('Studio page: one booking rule and what checkout enforces (C1, C2)', () => {
  it('a studio within the new-account limit says it fits, and how to raise the limit', () => {
    const text = studioNeeds(175_000).join(' ');
    expect(text).toContain('This studio counts as R');
    expect(text).toContain('so it fits');
    expect(text).not.toMatch(/collected in person|bulk discount|cart/i);
  });

  it('above the new-account limit it asks for the bank account', () => {
    expect(studioNeeds(RENTAL_POLICY.trustTierLimitsCents.contactable + 100).join(' ')).toContain('you also need a bank account in your own name');
  });

  it('one rule: full days online, half day on WhatsApp; no minimum booking', () => {
    expect(ON_SITE_RENTAL.bookingRule).toBe('Book full days here. For a half day, WhatsApp us.');
    expect('minimumBooking' in ON_SITE_RENTAL).toBe(false);
  });
});
