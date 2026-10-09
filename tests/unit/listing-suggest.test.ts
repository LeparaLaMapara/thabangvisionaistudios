import { describe, it, expect } from 'vitest';
import { LISTING_SUGGESTED_RATES } from '@/lib/constants';
import {
  estimateDailyRate,
  estimateWeeklyRate,
  normaliseCondition,
  onboardingItemKey,
  parseOnboardingItem,
  PLACEHOLDER_TITLE,
  profileLocation,
  suggestListing,
  type SuggestedValues,
} from '@/lib/core/listings/suggest';
import { AI_SUGGESTIBLE_FIELDS, weekRateProblem, type AiSuggestibleField } from '@/lib/core/listings/review';

// Phase 3 photo-first listing (spec 9.3): the pricing heuristic moved out of
// the onboarding route, and the rule that every pre-filled value is an
// AI suggestion the owner must confirm.

/** Fields that ended up with a value on the draft. */
function filled(v: SuggestedValues): AiSuggestibleField[] {
  return AI_SUGGESTIBLE_FIELDS.filter((f) => {
    const value = v[f as keyof SuggestedValues];
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
}

describe('the day-rate heuristic (moved from /api/onboarding/create-rentals)', () => {
  it('gives the same numbers the onboarding route used to', () => {
    // Old: base 650 x like_new 1.0, 400 x good 0.9, 350 x new 1.1, 450 x fair 0.75, unknown 400 x 0.9.
    expect(estimateDailyRate('cameras-optics', 'like_new')).toBe(650);
    expect(estimateDailyRate('lighting-power', 'good')).toBe(360);
    expect(estimateDailyRate('audio', 'new')).toBe(385);
    expect(estimateDailyRate('grip-motion', 'fair')).toBe(338);
    expect(estimateDailyRate('data-storage', 'good')).toBe(360);
    expect(estimateDailyRate('specialized-solutions', undefined)).toBe(270);
  });

  it('reads both condition spellings the same way', () => {
    expect(estimateDailyRate('cameras-optics', 'like-new')).toBe(estimateDailyRate('cameras-optics', 'like_new'));
  });

  it('takes its numbers from constants', () => {
    expect(estimateDailyRate('cameras-optics', 'like-new')).toBe(
      LISTING_SUGGESTED_RATES.dayRateByCategory['cameras-optics'] * LISTING_SUGGESTED_RATES.conditionMultiplier['like-new'],
    );
  });

  it('suggests a week rate that is a valid week rate (never more than 7 days)', () => {
    for (const day of [1, 270, 650, 999]) {
      const week = estimateWeeklyRate(day);
      expect(week).toBe(Math.round(day * LISTING_SUGGESTED_RATES.weekBilledAsDays));
      expect(weekRateProblem(day, week)).toBeNull();
    }
  });
});

describe('condition vocabulary', () => {
  it('stores the dashboard spelling', () => {
    expect(normaliseCondition('like_new')).toBe('like-new');
    expect(normaliseCondition('Like New')).toBe('like-new');
    expect(normaliseCondition('good')).toBe('good');
  });

  it('does not turn "for parts" (or an equipment type) into a rentable condition', () => {
    expect(normaliseCondition('for_parts')).toBeNull();
    expect(normaliseCondition('camera body')).toBeNull();
    expect(normaliseCondition(undefined)).toBeNull();
  });
});

describe('location from the profile', () => {
  it('uses city and province, then the legacy location', () => {
    expect(profileLocation({ city: 'Soweto', province: 'Gauteng' })).toBe('Soweto, Gauteng');
    expect(profileLocation({ city: 'Durban', province: null })).toBe('Durban');
    expect(profileLocation({ location: 'Braamfontein, Johannesburg' })).toBe('Braamfontein, Johannesburg');
    expect(profileLocation(null)).toBeNull();
  });

  it('never fills in coordinates', () => {
    expect(profileLocation({ location: '-26.2041, 28.0473' })).toBeNull();
  });
});

describe('suggestListing: every pre-filled field is recorded as AI-suggested', () => {
  const facts = {
    brand: 'Sony',
    model: 'A7 III',
    category: 'cameras-optics',
    condition: 'like_new',
    equipmentType: 'camera body',
    confidence: 0.92,
  };
  const described = { title: 'Sony A7 III body', description: 'Full-frame body.', rentalIncludes: ['Body', 'Battery'] };

  it('marks every field it filled in, and only those', () => {
    const s = suggestListing({ facts, described, location: 'Soweto, Gauteng' });
    expect(filled(s.values).sort()).toEqual([...s.aiSuggested].sort());
    expect(s.aiSuggested).toEqual(
      expect.arrayContaining(['title', 'description', 'category', 'brand', 'model', 'condition', 'price_per_day', 'price_per_week', 'rental_includes']),
    );
    expect(s.values.condition).toBe('like-new');
    expect(s.values.price_per_day).toBe(650);
    expect(s.values.price_per_week).toBe(3250);
  });

  it('never suggests a replacement value', () => {
    const s = suggestListing({ facts, described, location: null });
    expect(s.values.replacement_value).toBeNull();
    expect(s.aiSuggested).not.toContain('replacement_value');
  });

  it('the location comes from the profile and is not an AI value', () => {
    const s = suggestListing({ facts, described, location: 'Soweto, Gauteng' });
    expect(s.values.location).toBe('Soweto, Gauteng');
  });

  it("does not mark the owner's own values", () => {
    const s = suggestListing({
      facts,
      described,
      location: null,
      owner: { title: 'My A7', category: 'cameras', condition: 'good', price_per_day: 500 },
    });
    expect(s.values.title).toBe('My A7');
    expect(s.values.category).toBe('cameras-optics');
    expect(s.values.condition).toBe('good');
    expect(s.values.price_per_day).toBe(500);
    for (const f of ['title', 'category', 'condition', 'price_per_day'] as const) expect(s.aiSuggested).not.toContain(f);
    // The week rate worked out from the owner's day rate is still a suggestion.
    expect(s.values.price_per_week).toBe(2500);
    expect(s.aiSuggested).toContain('price_per_week');
    expect(s.aiSuggested).toContain('brand');
  });

  it('falls back to brand and model, then a placeholder title, both marked', () => {
    const a = suggestListing({ facts, described: null, location: null });
    expect(a.values.title).toBe('Sony A7 III');
    expect(a.aiSuggested).toContain('title');
    const b = suggestListing({ facts: { category: 'audio' }, described: null, location: null });
    expect(b.values.title).toBe(PLACEHOLDER_TITLE);
    expect(b.aiSuggested).toContain('title');
  });

  it('flags a low-confidence recognition', () => {
    expect(suggestListing({ facts: { ...facts, confidence: 0.4 }, described: null, location: null }).lowConfidence).toBe(true);
    expect(suggestListing({ facts, described, location: null }).lowConfidence).toBe(false);
  });
});

describe('onboarding items (create-rentals mapping fixes)', () => {
  it('still reads the old item shape: everything recognised is the AI value', () => {
    const item = parseOnboardingItem({ brand: 'Sony', model: 'A7 III', category: 'cameras-optics', confidence: 0.9, thumbnailUrl: 'https://x/a.jpg' });
    expect(item?.facts?.brand).toBe('Sony');
    expect(item?.owner).toEqual({ title: null, category: null, condition: null, price_per_day: null });
    expect(item?.photoUrl).toBe('https://x/a.jpg');
  });

  it("uses what the owner changed: name, category, condition and day rate", () => {
    const item = parseOnboardingItem({
      brand: 'Sony',
      model: 'A7 III',
      category: 'lighting-power',
      condition: 'fair',
      confidence: 0.9,
      title: 'Sony A7 III with cage',
      dailyRate: '450',
      ownerEdited: { title: true, category: true, condition: false },
    });
    expect(item?.owner.title).toBe('Sony A7 III with cage');
    expect(item?.owner.category).toBe('lighting-power');
    expect(item?.owner.condition).toBeNull();
    expect(item?.owner.price_per_day).toBe(450);
    const s = suggestListing({ facts: item!.facts, described: null, owner: item!.owner, location: null });
    expect(s.values.title).toBe('Sony A7 III with cage');
    expect(s.values.price_per_day).toBe(450);
    expect(s.aiSuggested).not.toContain('title');
    expect(s.aiSuggested).not.toContain('category');
    expect(s.aiSuggested).toContain('condition');
  });

  it('keeps a low-confidence item (as a draft to check) instead of dropping it', () => {
    const item = parseOnboardingItem({ brand: 'Maybe', model: 'Light', category: 'lighting-power', confidence: 0.3 });
    expect(item).not.toBeNull();
    expect(suggestListing({ facts: item!.facts, described: null, owner: item!.owner, location: null }).lowConfidence).toBe(true);
  });

  it('keeps an item the AI did not recognise when the owner named it; its values are the owner\'s', () => {
    const item = parseOnboardingItem({ title: 'Godox SL60', category: 'lighting-power', condition: 'good' });
    expect(item?.facts).toBeNull();
    const s = suggestListing({ facts: null, described: null, owner: item!.owner, location: null });
    expect(s.values.title).toBe('Godox SL60');
    expect(s.values.condition).toBe('good');
    expect(s.aiSuggested).not.toContain('title');
    expect(s.aiSuggested).not.toContain('condition');
    // The rate is still only a suggestion.
    expect(s.aiSuggested).toContain('price_per_day');
  });

  it('stores the condition, not the equipment type, in the condition column', () => {
    const item = parseOnboardingItem({ brand: 'Sony', model: 'A7 III', category: 'cameras-optics', condition: 'like_new', equipmentType: 'camera body', confidence: 0.9 });
    const s = suggestListing({ facts: item!.facts, described: null, owner: item!.owner, location: null });
    expect(s.values.condition).toBe('like-new');
  });

  it('drops an item with nothing to make a draft from', () => {
    expect(parseOnboardingItem({ category: 'audio' })).toBeNull();
    expect(parseOnboardingItem(null)).toBeNull();
  });

  it('treats the same name, brand and model as one item', () => {
    const a = parseOnboardingItem({ brand: 'Sony', model: 'A7 III', confidence: 0.9 })!;
    const b = parseOnboardingItem({ brand: 'sony ', model: 'a7 iii', confidence: 0.8 })!;
    expect(onboardingItemKey(a, '')).toBe(onboardingItemKey(b, ''));
  });
});
