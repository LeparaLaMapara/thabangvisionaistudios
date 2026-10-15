import { RENTAL_CATEGORIES, STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { coreFaqs } from '@/lib/content/faqs';
import { creatorMatchesCategory } from '@/lib/seo/creator-url';
import { entityOf, routeOf } from '@/lib/discovery/registry';
import { absUrl, creatorLine, oneLine, rand, rentalLine, rentalPriceText, toolLines } from '@/lib/discovery/format';
import type { Catalog } from '@/lib/discovery/types';

/**
 * Markdown twins: a plain markdown version of a public page, for AI agents
 * and readers that do not want the HTML.
 *
 * How it is reached: add ".md" to the page address, e.g.
 * /rentals/cameras-optics/sony-a7-iv.md. proxy.ts rewrites that to the
 * internal route /md/<path> (app/md/[...path]/route.ts), which calls
 * renderMarkdownTwin. One mechanism only (no Accept header negotiation), so
 * an HTML page and its twin never share a cache entry. Each HTML page with a
 * twin advertises it with <link rel="alternate" type="text/markdown">
 * (buildPageMetadata's markdown option), and the twin answers with a
 * Link: <html page>; rel="canonical" header so search engines keep the HTML
 * page as the one to index.
 *
 * Which pages have twins: entities with markdownTwin in the registry
 * (lib/discovery/registry.ts), resolved here per route.
 */

export interface MarkdownOptions {
  paymentsOpen: boolean;
}

function footer(path: string): string[] {
  return [
    '',
    '---',
    `Page: ${absUrl(path)}`,
    `To book, open the page above. ${STUDIO.name}, ${STUDIO.email}, WhatsApp ${STUDIO.whatsapp.display}.`,
    `More: ${absUrl('/llms.txt')}`,
    '',
  ];
}

function segs(path: string): string[] {
  return path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

/** The markdown for a page path, or null when it has no twin or does not exist. */
export function renderMarkdownTwin(path: string, c: Catalog, opts: MarkdownOptions): string | null {
  const clean = path.replace(/\/+$/, '') || '/';
  const entity = entityOf(clean);
  if (!entity?.markdownTwin) return null;
  const route = routeOf(clean);
  const s = segs(clean);

  switch (route) {
    case '/faq': {
      const faqs = [...coreFaqs({ paymentsOpen: opts.paymentsOpen, rolesOn: c.rolesOn }), ...c.faqs];
      return [
        `# ${STUDIO.name}: frequently asked questions`,
        '',
        ...faqs.flatMap((f) => [`## ${f.question}`, '', f.answer, '']),
        ...footer('/faq'),
      ].join('\n');
    }

    case '/rentals/[category]': {
      const cat = RENTAL_CATEGORIES.find((x) => x.value === s[1]);
      const items = c.rentals.filter((r) => r.category === s[1]);
      if (!cat || items.length === 0) return null;
      return [
        `# ${cat.label} for hire`,
        '',
        cat.description,
        '',
        `${items.length} item${items.length === 1 ? '' : 's'}. Prices are per day in South African rand.`,
        '',
        ...items.map(rentalLine),
        ...footer(clean),
      ].join('\n');
    }

    case '/rentals/[category]/[slug]': {
      const r = c.rentals.find((x) => x.category === s[1] && x.slug === s[2]);
      if (!r) return null;
      return [
        `# ${r.title}`,
        '',
        `- Category: ${r.categoryLabel ?? r.category}`,
        ...(r.brand || r.model ? [`- Make: ${[r.brand, r.model].filter(Boolean).join(' ')}`] : []),
        `- Price: ${rentalPriceText(r)}`,
        `- Supplied by: ${r.ownerType === 'community' ? 'a verified member' : STUDIO.name}`,
        ...(r.quantity > 1 ? [`- Units: ${r.quantity}`] : []),
        `- Available: ${r.isAvailable ? 'yes, pick dates on the page to check' : 'not right now'}`,
        ...(r.includes.length > 0 ? ['', '## Comes with', ...r.includes.map((i) => `- ${i}`)] : []),
        ...(r.description ? ['', '## About it', '', r.description.trim()] : []),
        '',
        '## How to book',
        coreFaqs({ paymentsOpen: opts.paymentsOpen }).find((f) => f.id === 'core-how-rent')?.answer ?? '',
        ...footer(r.path),
      ].join('\n');
    }

    case '/studio/category/[slug]': {
      if (!c.studioOn) return null;
      const cat = c.studioCategories.find((x) => x.slug === s[2]);
      if (!cat) return null;
      const creators = c.creators.filter((p) => creatorMatchesCategory(p.specializations, cat));
      return [
        `# ${cat.name}`,
        '',
        oneLine(cat.description, 2000),
        '',
        coreFaqs({ paymentsOpen: opts.paymentsOpen }).find((f) => f.id === 'core-photographer')?.answer ?? '',
        '',
        '## Creators',
        ...(creators.length > 0 ? creators.map(creatorLine) : ['- No creator is open for bookings in this category right now.']),
        ...footer(cat.path),
      ].join('\n');
    }

    case '/studio/category/[slug]/[id]': {
      if (!c.studioOn) return null;
      const p = c.creators.find((x) => x.path === clean || (x.category === s[2] && x.handle === s[3]));
      if (!p) return null;
      return [
        `# ${p.name}`,
        '',
        ...(p.specializations.length > 0 ? [`- Works in: ${p.specializations.join(', ')}`] : []),
        ...(p.location ? [`- Based in: ${p.location}`] : []),
        ...(p.hourlyRate !== null ? [`- From ${rand(p.hourlyRate)} an hour`] : []),
        ...(p.yearsExperience ? [`- Years of experience: ${p.yearsExperience}`] : []),
        `- Verified: ID checked by ${STUDIO.shortName}, open for bookings, with a complete portfolio`,
        ...(p.bio ? ['', '## About', '', p.bio.trim()] : []),
        ...footer(p.path),
      ].join('\n');
    }

    case '/press/[slug]': {
      const p = c.press.find((x) => x.slug === s[1]);
      if (!p) return null;
      return [
        `# ${p.title}`,
        '',
        ...[p.author ? `By ${p.author}` : null, p.publishedAt ? `Published ${p.publishedAt.slice(0, 10)}` : null].filter(
          (x): x is string => x !== null,
        ),
        '',
        ...(p.excerpt ? [`> ${oneLine(p.excerpt, 600)}`, ''] : []),
        (p.content ?? '').trim(),
        ...footer(p.path),
      ].join('\n');
    }

    case '/tools':
      return [
        `# ${UBUNYE_STUDIO.suiteName}`,
        '',
        `${UBUNYE_STUDIO.hero.title} ${UBUNYE_STUDIO.hero.subtitle}`,
        `Made by ${UBUNYE_STUDIO.maker}. ${UBUNYE_STUDIO.systemRequirements}`,
        '',
        ...c.tools.flatMap((t) => toolLines(t)),
        ...footer('/tools'),
      ].join('\n');

    case '/tools/[app]': {
      const t = c.tools.find((x) => x.slug === s[1]);
      if (!t) return null;
      return [
        `# ${t.name}: ${t.category}`,
        '',
        t.tagline,
        '',
        '## What it does',
        ...t.capabilities.map((x) => `- ${x}`),
        '',
        '## Get it',
        ...toolLines(t, true),
        '',
        UBUNYE_STUDIO.systemRequirements,
        ...footer(t.path),
      ].join('\n');
    }

    default:
      return null;
  }
}
