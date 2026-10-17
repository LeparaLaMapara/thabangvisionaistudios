import { describe, it, expect } from 'vitest';
import { areaFit, placesIn, resolveArea } from '@/lib/roles/areas';

describe('Gauteng area aliases', () => {
  it('reads the ways people write Johannesburg and Pretoria', () => {
    for (const w of ['Johannesburg', 'Joburg', "Jo'burg", 'Jozi', 'JHB', 'joburg north']) {
      expect(resolveArea(w)).toMatchObject({ kind: 'place', name: 'Johannesburg', metro: 'johannesburg' });
    }
    for (const w of ['Pretoria', 'Tshwane', 'PTA']) {
      expect(resolveArea(w)).toMatchObject({ kind: 'place', name: 'Pretoria', metro: 'tshwane' });
    }
    expect(resolveArea('Centurion')).toMatchObject({ name: 'Centurion', metro: 'tshwane' });
    expect(resolveArea('Sandton')).toMatchObject({ name: 'Sandton', metro: 'johannesburg' });
    expect(resolveArea('Midrand')).toMatchObject({ name: 'Midrand', metro: 'johannesburg' });
    expect(resolveArea('Soweto, Joburg')).toMatchObject({ name: 'Soweto' });
  });

  it('knows Gauteng, places outside it, and what it does not know', () => {
    expect(resolveArea('anywhere in Gauteng')).toEqual({ kind: 'gauteng' });
    expect(resolveArea('Cape Town')).toEqual({ kind: 'outside', name: 'Cape Town' });
    expect(resolveArea('Durban')).toMatchObject({ kind: 'outside' });
    expect(resolveArea('my house')).toEqual({ kind: 'unknown' });
    expect(resolveArea('')).toEqual({ kind: 'unknown' });
  });

  it('matches whole words only', () => {
    expect(placesIn('Springbok Park')).toEqual([]);
    expect(placesIn('Germiston and East Rand').map((p) => p.name)).toEqual(['East Rand', 'Germiston']);
  });
});

describe('areaFit: does this person serve the place asked for?', () => {
  const jhb = resolveArea('Johannesburg');
  const soweto = resolveArea('Soweto');
  it('Joburg, Soweto and Midrand all serve Johannesburg (the city)', () => {
    expect(areaFit('Joburg', jhb)).toBe('same_place');
    expect(areaFit('Joburg north', jhb)).toBe('same_place');
    expect(areaFit('Soweto and Joburg south', jhb)).toBe('same_place');
    expect(areaFit('Midrand', jhb)).toBe('same_place');
    expect(areaFit('Pretoria and Joburg', jhb)).toBe('same_place');
  });
  it('Pretoria and the East Rand do not serve Johannesburg', () => {
    expect(areaFit('Pretoria', jhb)).toBe('none');
    expect(areaFit('Germiston and East Rand', jhb)).toBe('none');
  });
  it('a request for Soweto: Soweto first, the rest of Johannesburg nearby', () => {
    expect(areaFit('Soweto', soweto)).toBe('same_place');
    expect(areaFit('Johannesburg', soweto)).toBe('same_city');
    expect(areaFit('Pretoria', soweto)).toBe('none');
  });
  it('Gauteng-wide people, and areas nobody can read', () => {
    expect(areaFit('All of Gauteng', jhb)).toBe('all_gauteng');
    expect(areaFit('Anywhere', jhb)).toBe('unknown');
    expect(areaFit('Joburg', resolveArea('somewhere'))).toBe('unknown');
  });
});
