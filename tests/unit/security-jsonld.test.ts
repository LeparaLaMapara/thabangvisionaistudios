/**
 * Phase 6 security, INJ-1: JSON-LD is written into a <script> element with
 * dangerouslySetInnerHTML. Any "</script>" (or "<!--") inside a value that a
 * user controls (creator location, display name, review text) must not be able
 * to close the element and start a script of its own.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateRatingJsonLd,
  personJsonLd,
  renderJsonLd,
} from '@/lib/seo/structured-data';

const PAYLOAD = 'Jozi</script><script>window.__XSS__=1</script><!--&\u2028\u2029';

describe('renderJsonLd escaping (INJ-1)', () => {
  it('never emits a raw <, > or & so a value cannot close the script element', () => {
    const out = renderJsonLd(
      personJsonLd({
        display_name: PAYLOAD,
        crew_slug: 'x',
        specializations: ['Photography'],
        hourly_rate: 100,
        location: PAYLOAD,
        avatar_url: null,
      }),
    );
    expect(out).not.toMatch(/[<>&]/);
    expect(out.toLowerCase()).not.toContain('</script');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
  });

  it('still parses back to exactly the same data', () => {
    const data = aggregateRatingJsonLd({
      name: PAYLOAD,
      url: 'https://example.test/a?b=1&c=2',
      ratingValue: 4.5,
      reviewCount: 1,
      reviews: [{ rating: 5, author: PAYLOAD, comment: PAYLOAD, date: '2026-01-01' }],
    });
    expect(JSON.parse(renderJsonLd(data))).toEqual(data);
  });

  it('a browser HTML parser sees one script element whose text is the whole JSON', () => {
    const html = `<script type="application/ld+json">${renderJsonLd({ a: PAYLOAD })}</script>`;
    const doc = new DOMParser().parseFromString(`<!doctype html><html><head>${html}</head></html>`, 'text/html');
    const scripts = doc.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent ?? '')).toEqual({ a: PAYLOAD });
  });
});
