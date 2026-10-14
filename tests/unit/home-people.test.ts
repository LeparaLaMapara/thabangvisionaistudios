import { describe, expect, it } from 'vitest';
import { CAPABILITIES_PEOPLE, HOME_PEOPLE } from '@/lib/constants';

// Owner, 2026-10-14: with People on, the home page has no Studio card and two
// equal doors, Rent gear and Book people, instead of "Send us a brief".
describe('home page with People on', () => {
  it('shows Rentals and People, and no Studio card', () => {
    expect(CAPABILITIES_PEOPLE.map((c) => c.title)).toEqual(['Rentals', 'People']);
    expect(CAPABILITIES_PEOPLE.some((c) => /studio/i.test(c.title) || c.link === '/studio')).toBe(false);
  });
  it('has two plain buttons', () => {
    expect(HOME_PEOPLE.rentLabel).toBe('Rent gear');
    expect(HOME_PEOPLE.peopleLabel).toBe('Book people');
    expect(HOME_PEOPLE.peopleHref).toBe('/people');
  });
});
