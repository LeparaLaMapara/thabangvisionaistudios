import { describe, it, expect } from 'vitest';
import { CREATOR_SPECIALIZATIONS } from '@/lib/constants';
import { mergeSpecializations, toSpecialization } from '@/lib/creators/specializations';
import { creatorBookableChecklist, isCreatorBookable } from '@/lib/creators/bookable';
import { homeFor, isWelcomeIntent, LIST_GEAR_HREF, WELCOME_CHOICES } from '@/lib/welcome';

// Phase 3 supply side: creators' confirmed skills reach search, what makes a
// creator bookable is visible, and gear owners skip creator onboarding.

describe('creator specialisations', () => {
  it('maps detected skills onto the search vocabulary', () => {
    expect(toSpecialization('wedding_photography')).toBe('photography');
    expect(toSpecialization('Product Photography')).toBe('photography');
    expect(toSpecialization('Music Video')).toBe('cinematography');
    expect(toSpecialization('Colour grading')).toBe('editing');
    expect(toSpecialization('Audio')).toBe('sound');
    expect(toSpecialization('Producing')).toBe('producing');
    expect(toSpecialization('knitting')).toBeNull();
  });

  it('keeps existing values and adds new ones once, lower-case', () => {
    expect(mergeSpecializations(['Cinematography'], ['wedding_photography', 'portrait_photography', 'Editing'])).toEqual([
      'cinematography',
      'photography',
      'editing',
    ]);
    expect(mergeSpecializations(null, [])).toEqual([]);
  });

  it('only produces values from the shared list', () => {
    const values = CREATOR_SPECIALIZATIONS.map((s) => s.value) as string[];
    for (const v of mergeSpecializations([], ['wedding_photography', 'Music Video', 'sound', 'lighting', 'directing'])) {
      expect(values).toContain(v);
    }
  });
});

describe('what makes a creator bookable', () => {
  const all = { verificationStatus: 'verified', portfolioComplete: true, hasPayoutAccount: true, availableForHire: true };

  it('is bookable only when every item is done', () => {
    expect(isCreatorBookable(all)).toBe(true);
    for (const key of ['portfolioComplete', 'hasPayoutAccount', 'availableForHire'] as const) {
      expect(isCreatorBookable({ ...all, [key]: false })).toBe(false);
    }
    expect(isCreatorBookable({ ...all, verificationStatus: 'pending' })).toBe(false);
  });

  it('does not count "available" before the ID check passes', () => {
    const items = creatorBookableChecklist({ ...all, verificationStatus: 'unverified' });
    expect(items.find((i) => i.step === 'available_for_hire')?.done).toBe(false);
    expect(items.map((i) => i.step)).toEqual(['id_verified', 'portfolio_complete', 'payout_account', 'available_for_hire']);
  });
});

describe('welcome: gear owners and creators are separate answers', () => {
  it('"List my gear" goes straight to a photo-first listing', () => {
    const list = WELCOME_CHOICES.find((c) => c.intent === 'list');
    expect(list?.title).toBe('List my gear');
    expect(list?.href).toBe(LIST_GEAR_HREF);
    expect(LIST_GEAR_HREF).toBe('/dashboard/listings?new=1');
  });

  it('"Offer my services" goes to creator onboarding', () => {
    const supply = WELCOME_CHOICES.find((c) => c.intent === 'supply');
    expect(supply?.title).toBe('Offer my services');
    expect(supply?.href).toBe('/onboarding');
  });

  it('an owner is never sent to creator onboarding after signing in', () => {
    expect(isWelcomeIntent('list')).toBe(true);
    expect(homeFor('list', false)).toBe('/dashboard/listings');
    expect(homeFor('list', true)).toBe('/dashboard/listings');
  });
});
