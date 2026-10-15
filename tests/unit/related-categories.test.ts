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

import { cityPageHeading } from '@/lib/rental/collection-point';

describe('city pages say where the gear really is', () => {
  it('for <city> shoots, collected in Fourways or delivered', () => {
    const h = cityPageHeading('Cameras & Optics', 'Soweto');
    expect(h.title).toBe('Cameras & Optics for Soweto shoots');
    expect(h.rest).toBe('collected in Dainfern, Fourways or delivered');
  });
});
