import { describe, it, expect } from 'vitest';
import { WELCOME_CHOICES, homeFor, isWelcomeIntent } from '@/lib/welcome';

describe('the welcome question', () => {
  it('offers the three things people come for, each with a real destination', () => {
    expect(WELCOME_CHOICES.map((c) => c.intent)).toEqual(['rent', 'hire', 'supply']);
    expect(WELCOME_CHOICES.map((c) => c.href)).toEqual(['/rentals', '/studio', '/onboarding']);
  });

  it('asks anyone who has not answered, instead of sending them to creator onboarding', () => {
    expect(homeFor(undefined, false)).toBe('/welcome');
    expect(homeFor('something-else', false)).toBe('/welcome');
  });

  it('sends a renter or a client to their dashboard, never to onboarding', () => {
    expect(homeFor('rent', false)).toBe('/dashboard');
    expect(homeFor('hire', false)).toBe('/dashboard');
    expect(homeFor('browse', false)).toBe('/dashboard');
  });

  it('sends a supplier to onboarding until it is done', () => {
    expect(homeFor('supply', false)).toBe('/onboarding');
    expect(homeFor('supply', true)).toBe('/dashboard');
  });

  it('counts "just looking around" as an answer, so nobody is asked twice', () => {
    expect(isWelcomeIntent('browse')).toBe(true);
    expect(isWelcomeIntent(undefined)).toBe(false);
  });
});
