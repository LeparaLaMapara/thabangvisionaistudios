import { describe, it, expect } from 'vitest';
import { relatedRentalCategories } from '@/lib/seo/inventory';

describe('related rental categories link only to stocked ones', () => {
  it('drops empty categories such as Data & Storage', () => {
    const links = relatedRentalCategories('cameras-optics', ['cameras-optics', 'lighting-power', 'audio']);
    expect(links.map((l) => l.slug)).toEqual(['lighting-power', 'audio']);
    expect(links.some((l) => l.slug === 'data-storage')).toBe(false);
  });

  it('nothing stocked (or a failed read): no links', () => {
    expect(relatedRentalCategories('audio', [])).toEqual([]);
  });

  it('ignores unknown slugs', () => {
    expect(relatedRentalCategories('audio', ['crew-services', 'grip-motion']).map((l) => l.slug)).toEqual(['grip-motion']);
  });
});
