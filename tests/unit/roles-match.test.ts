import { describe, it, expect } from 'vitest';
import { RENTAL_CATEGORIES } from '@/lib/constants';
import {
  buildMatchPrompt,
  cleanMatchText,
  gearCategoryOf,
  isGearSlug,
  keywordMatch,
  matchCandidates,
  MAX_SUGGESTIONS,
  parseMatchAnswer,
  portfolioEvidenceRows,
  profilePrefill,
  skillsAsText,
  type MatchRole,
} from '@/lib/roles';
import { homeFor, isWelcomeIntent, journeyOf, offerRolePath } from '@/lib/welcome';

const ROLES: MatchRole[] = [
  { slug: 'photographer-videographer', name: 'Photographer or videographer', description: 'Photos and video.' },
  { slug: 'makeup-artist', name: 'Make-up artist', description: 'Make-up for shoots.' },
  { slug: 'model', name: 'Model', description: 'On camera.' },
  { slug: 'driver-with-vehicle', name: 'Driver with vehicle', description: 'You drive your own vehicle.' },
  { slug: 'drone-pilot', name: 'Drone pilot', description: 'Aerials.' },
];
const ALL = matchCandidates(ROLES, RENTAL_CATEGORIES);
const ALLOWED = ALL.map((c) => c.slug);

describe('candidates', () => {
  it('adds every rental category as gear:<category>', () => {
    expect(ALL.length).toBe(ROLES.length + RENTAL_CATEGORIES.length);
    const cam = ALL.find((c) => c.slug === 'gear:cameras-optics');
    expect(cam && isGearSlug(cam.slug)).toBe(true);
    expect(gearCategoryOf('gear:audio')).toBe('audio');
    expect(isGearSlug('model')).toBe(false);
  });
});

describe('keyword fallback (no AI)', () => {
  const top = (t: string, mode: 'find' | 'offer' = 'offer') => keywordMatch(t, ALL, mode).map((s) => s.slug);

  it('offer: skills in plain words', () => {
    expect(top('I do makeup for weddings')[0]).toBe('makeup-artist');
    expect(top('I have a Quantum and drive crews')[0]).toBe('driver-with-vehicle');
    expect(top('I take photos at weddings and parties')[0]).toBe('photographer-videographer');
  });

  it('offer: gear to rent out goes to gear, not to the photographer role', () => {
    expect(top('Sony camera to rent out')[0]).toBe('gear:cameras-optics');
  });

  it('find: people and gear', () => {
    expect(top('make-up artist for a wedding in Soweto on Saturday', 'find')[0]).toBe('makeup-artist');
    expect(top('Sony camera for 2 days', 'find')[0]).toBe('gear:cameras-optics');
    expect(top('a gimbal and a tripod', 'find')[0]).toBe('gear:grip-motion');
  });

  it('never more than two, and nothing for nonsense', () => {
    expect(keywordMatch('makeup model driver camera drone lights', ALL).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(top('hello there')).toEqual([]);
    expect(top('')).toEqual([]);
  });
});

describe('slug validation of the model answer', () => {
  it('keeps only known slugs, deduped, at most two, confidence clamped', () => {
    const r = parseMatchAnswer(
      { roles: [{ slug: 'makeup-artist', confidence: 1.7 }, { slug: 'hacker' }, { slug: 'makeup-artist' }, { slug: 'model', confidence: -1 }, { slug: 'gear:audio' }] },
      ALLOWED,
    );
    expect(r).toEqual([
      { slug: 'makeup-artist', confidence: 1 },
      { slug: 'model', confidence: 0 },
    ]);
  });

  it('accepts bare strings, refuses everything else', () => {
    expect(parseMatchAnswer({ roles: ['gear:audio'] }, ALLOWED)).toEqual([{ slug: 'gear:audio', confidence: 0.5 }]);
    expect(parseMatchAnswer(null, ALLOWED)).toEqual([]);
    expect(parseMatchAnswer({ roles: 'model' }, ALLOWED)).toEqual([]);
    expect(parseMatchAnswer({ roles: [{ slug: 'DROP TABLE' }] }, ALLOWED)).toEqual([]);
  });
});

describe('prompt construction', () => {
  it('lists only the candidates and the cleaned words', () => {
    const p = buildMatchPrompt('I do makeup', ALL, false, 'offer');
    for (const c of ALL) expect(p).toContain(`"${c.slug}"`);
    expect(p).toContain('I do makeup');
    expect(p).toContain('Never invent a slug');
    expect(p).toContain('There is no photo');
    expect(p).toMatch(/offer/);
  });

  it('find mode asks what they need; a photo is mentioned', () => {
    const p = buildMatchPrompt('a camera', ALL, true, 'find');
    expect(p).toMatch(/looking for/);
    expect(p).toContain('one photo');
  });

  it('removes emails, phone numbers and links before anything is sent', () => {
    const t = cleanMatchText('Call me on 072 123 4567 or thandi@example.com, see https://x.co/me. I do braids <b>');
    expect(t).not.toMatch(/072|thandi|example|https/);
    expect(t).not.toContain('<');
    expect(t).toContain('I do braids');
    expect(cleanMatchText('x'.repeat(1000)).length).toBe(300);
    expect(cleanMatchText(42)).toBe('');
  });

  it('profile skills become the words to match', () => {
    expect(skillsAsText(['photography', 'video'], ['photography', 'events'])).toBe('photography, video, events');
    expect(skillsAsText(null, undefined)).toBe('');
  });
});

describe('prefill from an existing account', () => {
  it('takes area, about and a headline from the profile', () => {
    expect(profilePrefill({ location: 'Soweto', bio: 'I love light', specializations: ['photography', 'events'] })).toEqual({
      headline: 'Photography, Events',
      area: 'Soweto',
      about: 'I love light',
    });
    expect(profilePrefill(null)).toEqual({ headline: '', area: '', about: '' });
  });

  it('old portfolio photos become uploaded evidence, https only, no duplicates, capped', () => {
    const photos = Array.from({ length: 10 }, (_, i) => ({ url: `https://res.cloudinary.com/x/image/upload/p${i}.jpg`, public_id: `u/p${i}` }));
    const rows = portfolioEvidenceRows('pr-1', [
      { id: 'a', title: 'A', project_type: 'x', photos: [...photos.slice(0, 2), photos[0], { url: 'http://bad', public_id: 'b' }], video: null },
      { id: 'b', title: 'B', project_type: 'x', photos: photos.slice(2), video: null },
    ]);
    expect(rows.length).toBe(6);
    expect(new Set(rows.map((r) => r.url)).size).toBe(6);
    expect(rows.every((r) => r.source === 'uploaded' && r.kind === 'photo' && r.step_key === 'best_work')).toBe(true);
    expect(portfolioEvidenceRows('pr-1', null)).toEqual([]);
  });
});

describe('two journeys', () => {
  it('old answers map onto find and offer; browse stays browse', () => {
    expect(journeyOf('rent')).toBe('find');
    expect(journeyOf('hire')).toBe('find');
    expect(journeyOf('list')).toBe('offer');
    expect(journeyOf('supply')).toBe('offer');
    expect(journeyOf('browse')).toBe('browse');
    expect(journeyOf(undefined)).toBeNull();
  });

  it('new answers are valid saved intents and land in the right place', () => {
    expect(isWelcomeIntent('find')).toBe(true);
    expect(isWelcomeIntent('offer')).toBe(true);
    expect(homeFor('offer', false)).toBe('/offer');
    expect(homeFor('offer', true)).toBe('/dashboard');
    expect(homeFor('find', false)).toBe('/dashboard');
    expect(homeFor('supply', false)).toBe('/onboarding');
    expect(offerRolePath('makeup-artist')).toBe('/offer/makeup-artist');
  });
});
