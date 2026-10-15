import { describe, it, expect } from 'vitest';
import { FOOTER_SECTIONS } from '@/lib/constants';
import { footerSectionsSync } from '@/lib/nav';
import { footerForViewer } from '@/lib/nav-viewer';

describe('the footer is written for strangers', () => {
  it('signed out: no Dashboard and no Report a Bug', () => {
    for (const secs of [FOOTER_SECTIONS, footerSectionsSync(true)]) {
      const hrefs = footerForViewer(secs, false).flatMap((s) => s.links.map((l) => l.href));
      expect(hrefs).not.toContain('/dashboard');
      expect(hrefs).not.toContain('/support/report-bug');
    }
  });

  it('signed in: both come back', () => {
    const hrefs = footerForViewer(FOOTER_SECTIONS, true).flatMap((s) => s.links.map((l) => l.href));
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/support/report-bug');
  });

  it('has a Help and FAQ link for everyone', () => {
    const links = footerForViewer(FOOTER_SECTIONS, false).flatMap((s) => s.links);
    expect(links.find((l) => l.href === '/faq')?.label).toBe('Help and FAQ');
  });
});
