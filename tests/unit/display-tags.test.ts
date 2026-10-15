import { describe, it, expect } from 'vitest';
import { categoryLabel, displayTag } from '@/lib/content/tags';

describe('visitors never read a raw slug', () => {
  it('category slugs show their category name', () => {
    expect(displayTag('aerial-support')).toBe('Aerial Support');
    expect(displayTag('cameras-optics')).toBe('Cameras & Optics');
    expect(displayTag('CAMERAS-OPTICS')).toBe('Cameras & Optics');
  });

  it('other slugs become plain words', () => {
    expect(displayTag('prime-lens')).toBe('Prime lens');
    expect(displayTag('full_frame')).toBe('Full frame');
  });

  it('typed tags and known typos', () => {
    expect(displayTag('Sony')).toBe('Sony');
    expect(displayTag('Studio Portraits')).toBe('Studio Portraits');
    expect(displayTag('Potraits')).toBe('Portraits');
    expect(displayTag('4K')).toBe('4K');
  });

  it('categoryLabel: known and unknown slugs', () => {
    expect(categoryLabel('lighting-power')).toBe('Lighting & Power');
    expect(categoryLabel('specialized-solutions')).toBe('Specialised Solutions');
    expect(categoryLabel('new-thing')).toBe('New thing');
  });
});

import { formatRate, rateWords } from '@/lib/format/money';

describe('one price format: "R1 300 a day"', () => {
  it('rand symbol, a space between thousands, the unit in words', () => {
    expect(formatRate(1300, 'day')).toBe('R1 300 a day');
    expect(formatRate(900, 'hour')).toBe('R900 an hour');
    expect(formatRate(4500, 'week')).toBe('R4 500 a week');
    expect(formatRate(3500, 'full_day')).toBe('R3 500 a full day');
    expect(formatRate(11, 'km')).toBe('R11 a km');
  });

  it('unknown units read "a project"', () => {
    expect(rateWords('mystery')).toBe('a project');
    expect(rateWords('event')).toBe('an event');
  });
});
