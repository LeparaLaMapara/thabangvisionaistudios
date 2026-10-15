import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOOTER_SECTIONS, SHOW_CAREERS } from '@/lib/constants';
import { NOT_IN_SITEMAP, SITEMAP_ROUTES } from '@/lib/seo/sitemap-registry';
import { footerSectionsSync } from '@/lib/nav';

describe('careers is hidden, reversibly (SHOW_CAREERS)', () => {
  it('the flag is off', () => {
    expect(SHOW_CAREERS).toBe(false);
  });

  it('out of the sitemap and listed as a redirect', () => {
    expect(SITEMAP_ROUTES['/careers']).toBeUndefined();
    expect(NOT_IN_SITEMAP['/careers']).toBe('redirect');
  });

  it('no footer link, flag on or off', () => {
    const links = [FOOTER_SECTIONS, footerSectionsSync(true), footerSectionsSync(false)].flatMap((secs) => secs.flatMap((s) => s.links));
    expect(links.some((l) => l.href === '/careers')).toBe(false);
  });

  it('the page sends people to Contact while hidden', () => {
    const src = readFileSync(join(process.cwd(), 'app/(marketing)/careers/page.tsx'), 'utf8');
    expect(src).toMatch(/if \(!SHOW_CAREERS\) redirect\('\/contact'\)/);
  });
});
