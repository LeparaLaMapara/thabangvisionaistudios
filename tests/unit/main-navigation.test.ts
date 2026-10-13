import { describe, it, expect } from 'vitest';
import { MAIN_NAVIGATION, FOOTER_SECTIONS, UBUNYE_STUDIO } from '@/lib/constants';
import { filterNavSync } from '@/lib/nav';

describe('main navigation', () => {
  it('names the free apps "Apps" and points at /tools', () => {
    const apps = MAIN_NAVIGATION.find((i) => i.href === '/tools');
    expect(apps?.label).toBe('Apps');
    expect(UBUNYE_STUDIO.suiteName).toBe('Ubunye Apps');
  });

  it('has no Pricing item in the header; the page stays in the footer', () => {
    expect(MAIN_NAVIGATION.some((i) => i.href === '/pricing')).toBe(false);
    const footerLinks = FOOTER_SECTIONS.flatMap((s) => s.links);
    expect(footerLinks.some((l) => l.href === '/pricing')).toBe(true);
  });

  it('shows Apps only when the creative_tools switch is on', () => {
    const on = filterNavSync(MAIN_NAVIGATION, { creative_tools: true, smart_productions: true }).map((i) => i.label);
    const off = filterNavSync(MAIN_NAVIGATION, { creative_tools: false, smart_productions: true }).map((i) => i.label);
    expect(on.slice(0, 4)).toEqual(['Rentals', 'Studio', 'Apps', 'Help']);
    expect(off).not.toContain('Apps');
  });
});
