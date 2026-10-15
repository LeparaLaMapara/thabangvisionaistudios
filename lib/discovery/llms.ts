import { STUDIO, RENTAL_POLICY, UBUNYE_STUDIO } from '@/lib/constants';
import { LISTED_CITIES } from '@/lib/seo/cities';
import { coreFaqs } from '@/lib/content/faqs';
import { DISCOVERY_ENTITIES, rentalCategoryStats } from '@/lib/discovery/registry';
import { absUrl, creatorLine, oneLine, rand, rentalLine, rentalPriceText, toolLines } from '@/lib/discovery/format';
import type { Catalog } from '@/lib/discovery/types';

/**
 * /llms.txt and /llms-full.txt, written from the live catalogue and the
 * constants. Nothing here is a hand-typed fact: prices, counts, rules and
 * links all come from the database, lib/constants.ts or lib/content/faqs.ts
 * (the same answers the FAQ page and checkout use).
 */

/** The machine-readable doors, linked from both files and from docs. */
export const DISCOVERY_ENDPOINTS = {
  llms: '/llms.txt',
  llmsFull: '/llms-full.txt',
  openapi: '/openapi.json',
  api: '/v1',
  mcp: '/mcp',
  mcpCard: '/.well-known/mcp.json',
  sitemap: '/sitemap.xml',
  feed: '/feed.xml',
} as const;

/** How many rentals llms.txt lists before pointing at the full list. */
export const LLMS_TOP_RENTALS = 40;
export const LLMS_TOP_CREATORS = 40;

export interface LlmsOptions {
  /** onlinePaymentsOpen() at request time: changes the booking wording. */
  paymentsOpen: boolean;
}

function faqAnswer(id: string, paymentsOpen: boolean): string | null {
  return coreFaqs({ paymentsOpen }).find((f) => f.id === id)?.answer ?? null;
}

function bookingSection(opts: LlmsOptions): string[] {
  const steps: [string, string][] = [
    ['How to rent', 'core-how-rent'],
    ['Notice needed', 'core-notice'],
    ['Collection and delivery', 'core-collect-deliver'],
    ['Deposit', 'core-deposit'],
    ['ID check', 'core-id'],
    ['Cancelling', 'core-cancel'],
    ['Renting several items', 'core-bulk'],
    ['VAT', 'core-vat'],
    ['Booking a photographer or videographer', 'core-photographer'],
  ];
  return steps
    .map(([label, id]) => {
      const a = faqAnswer(id, opts.paymentsOpen);
      return a ? `- ${label}: ${a}` : null;
    })
    .filter((x): x is string => x !== null);
}

function ordersSection(): string[] {
  return [
    `${STUDIO.name} is the supplier and seller of record for every order. Customers pay ${STUDIO.name}, not individual creators.`,
    `Where a verified member supplies the gear or a creator does the shoot, they are engaged as our supplier and we keep a commission (${RENTAL_POLICY.platformShareBps / 100}% of the hire fee on gear, ${STUDIO.creators.commissionRate}% on services).`,
    'It is free to join and browse. You pay per booking; there is no subscription.',
  ];
}

function machineSection(): string[] {
  const e = DISCOVERY_ENDPOINTS;
  return [
    `- Full catalogue as markdown: ${absUrl(e.llmsFull)}`,
    `- Catalogue API (JSON, read only, no key): ${absUrl(`${e.api}/rentals`)}, ${absUrl(`${e.api}/creators`)}, ${absUrl(`${e.api}/categories`)}, ${absUrl(`${e.api}/tools`)}`,
    `- OpenAPI description of that API: ${absUrl(e.openapi)}`,
    `- MCP server (Streamable HTTP, read only, no sign in): ${absUrl(e.mcp)} (server card: ${absUrl(e.mcpCard)})`,
    `- Markdown version of a gear, creator, category, tool, press or FAQ page: add .md to its address, e.g. ${absUrl('/faq.md')}`,
    `- Sitemap: ${absUrl(e.sitemap)}`,
    `- Press feed (RSS): ${absUrl(e.feed)}`,
    'Booking and payment happen on the website: send people to the page URL to book.',
  ];
}

function areaSection(): string[] {
  const area = STUDIO.serviceArea.province;
  return [
    `We work in ${area}. ${STUDIO.serviceArea.outsideProvinceNote}`,
    `Rental and studio pages exist for these ${area} cities (examples, not the whole province): ${LISTED_CITIES.map((c) => c.name).join(', ')}.`,
    `We reply ${STUDIO.responseTime}.`,
  ];
}

function contactSection(): string[] {
  return [
    `- Email: ${STUDIO.email}`,
    `- WhatsApp (messages only): ${STUDIO.whatsapp.display}`,
    `- Bookings: ${STUDIO.bookingEmail}`,
    `- Website: ${STUDIO.meta.url}`,
  ];
}

function intro(c: Catalog): string[] {
  const parts = [
    `${STUDIO.name} is a South African marketplace, based in ${STUDIO.location.city}, to rent camera and production gear (${c.rentals.length} items listed now) and to book ID-checked photographers and videographers.`,
    `It also gives away ${UBUNYE_STUDIO.suiteName}, free and open source apps for photo and film (${c.tools.map((t) => t.name).join(', ')}).`,
  ];
  return [parts.join(' ')];
}

/** People (roles_v1): one way to book a person, at the price on their profile. */
const PEOPLE_LLMS_LINE = `Photographers, videographers and other people are booked on ${absUrl('/people')}: choose a person, pick your days, see the total and send a request. Each profile shows its price.`;

/** /llms.txt: a short guide with the most useful links. */
export function buildLlmsTxt(c: Catalog, opts: LlmsOptions): string {
  const cats = rentalCategoryStats(c).sort((a, b) => b.count - a.count);
  const rentals = c.rentals.slice(0, LLMS_TOP_RENTALS);
  const creators = c.studioOn ? c.creators.slice(0, LLMS_TOP_CREATORS) : [];

  const out: string[] = [
    `# ${STUDIO.name}`,
    '',
    `> ${STUDIO.meta.description}`,
    '',
    ...intro(c),
    '',
    '## How booking works',
    ...bookingSection(opts),
    '',
    '## How orders and pricing work',
    ...ordersSection(),
    '',
    '## Service area',
    ...areaSection(),
    '',
    '## Equipment categories',
    ...(cats.length > 0
      ? cats.map((s) => `- [${s.label}](${absUrl(`/rentals/${encodeURIComponent(s.value)}`)}): ${s.count} item${s.count === 1 ? '' : 's'}`)
      : ['- No gear is listed right now.']),
    '',
    `## Gear for hire${c.rentals.length > rentals.length ? ` (top ${rentals.length} of ${c.rentals.length})` : ''}`,
    ...(rentals.length > 0 ? rentals.map(rentalLine) : ['- No gear is listed right now.']),
    ...(c.rentals.length > rentals.length ? [`- Everything else: ${absUrl(DISCOVERY_ENDPOINTS.llmsFull)}`] : []),
    '',
  ];

  if (c.rolesOn) out.push('## People', PEOPLE_LLMS_LINE, '');
  if (c.studioOn && !c.rolesOn) {
    out.push(
      '## Creators you can book',
      ...(creators.length > 0 ? creators.map(creatorLine) : ['- No creators are open for bookings right now.']),
      '',
      '## Shoots by request',
      ...c.studioCategories.map((s) => `- [${s.name}](${absUrl(s.path)}): ${oneLine(s.description)}`),
      '',
    );
  }

  out.push(
    `## Free tools: ${UBUNYE_STUDIO.suiteName}`,
    ...c.tools.flatMap((t) => toolLines(t)),
    '',
    '## For AI agents and developers',
    ...machineSection(),
    '',
    '## Contact',
    ...contactSection(),
    '',
    '## Key pages',
    `- Home: ${STUDIO.meta.url}`,
    `- Equipment rentals: ${absUrl('/rentals')}`,
    ...(c.studioOn && !c.rolesOn ? [`- Studio (shoots by request): ${absUrl('/studio')}`, `- Creators: ${absUrl('/smart-creators')}`] : []),
    `- Free tools: ${absUrl('/tools')}`,
    `- FAQ: ${absUrl('/faq')}`,
    `- Pricing: ${absUrl('/pricing')}`,
    `- Locations: ${absUrl('/locations')}`,
    `- About: ${absUrl('/about')}`,
    `- Contact: ${absUrl('/contact')}`,
    '',
    `Updated from live data at ${c.generatedAt}.`,
    '',
  );
  return out.join('\n');
}

/** /llms-full.txt: the whole public catalogue in markdown. */
export function buildLlmsFullTxt(c: Catalog, opts: LlmsOptions): string {
  const out: string[] = [
    `# ${STUDIO.name}: full catalogue`,
    '',
    `> ${STUDIO.meta.description}`,
    '',
    ...intro(c),
    `Short version: ${absUrl(DISCOVERY_ENDPOINTS.llms)}`,
    '',
    '## How booking works',
    ...bookingSection(opts),
    '',
    '## How orders and pricing work',
    ...ordersSection(),
    '',
    '## Service area',
    ...areaSection(),
    '',
    '## Gear for hire',
  ];

  for (const s of rentalCategoryStats(c).sort((a, b) => a.label.localeCompare(b.label))) {
    out.push('', `### ${s.label} (${s.count})`, `Category page: ${absUrl(`/rentals/${encodeURIComponent(s.value)}`)}`, '');
    for (const r of c.rentals.filter((x) => x.category === s.value)) {
      out.push(`#### ${r.title}`);
      out.push(`- Page: ${absUrl(r.path)}`);
      out.push(`- ID: ${r.id}`);
      if (r.brand || r.model) out.push(`- Make: ${[r.brand, r.model].filter(Boolean).join(' ')}`);
      out.push(`- Price: ${rentalPriceText(r)}`);
      out.push(`- Supplied by: ${r.ownerType === 'community' ? 'a verified member' : STUDIO.name}`);
      if (r.quantity > 1) out.push(`- Units: ${r.quantity}`);
      if (!r.isAvailable) out.push('- Not available right now');
      if (r.includes.length > 0) out.push(`- Comes with: ${r.includes.join('; ')}`);
      if (r.description) out.push('', oneLine(r.description, 1200));
      out.push('');
    }
  }
  if (c.rentals.length === 0) out.push('No gear is listed right now.', '');

  if (c.rolesOn) out.push('## People', '', PEOPLE_LLMS_LINE, '');
  if (c.studioOn && !c.rolesOn) {
    out.push('## Creators you can book', '');
    for (const p of c.creators) {
      out.push(`### ${p.name}`, `- Profile: ${absUrl(p.path)}`);
      if (p.specializations.length > 0) out.push(`- Works in: ${p.specializations.join(', ')}`);
      if (p.location) out.push(`- Based in: ${p.location}`);
      if (p.hourlyRate !== null) out.push(`- From ${rand(p.hourlyRate)} an hour`);
      if (p.yearsExperience) out.push(`- Years of experience: ${p.yearsExperience}`);
      if (p.bio) out.push('', oneLine(p.bio, 1200));
      out.push('');
    }
    if (c.creators.length === 0) out.push('No creators are open for bookings right now.', '');

    out.push('## Shoots by request', '');
    for (const s of c.studioCategories) out.push(`- [${s.name}](${absUrl(s.path)}): ${oneLine(s.description)}`);
    for (const p of c.productions) {
      const price = p.price ? `, from ${rand(p.price)}${p.priceUnit ? ` per ${p.priceUnit}` : ''}` : '';
      out.push(`- [${p.title}](${absUrl(p.path)})${price}: ${oneLine(p.description, 300)}`);
    }
    out.push('');
  }

  out.push(`## Free tools: ${UBUNYE_STUDIO.suiteName}`, '', ...c.tools.flatMap((t) => toolLines(t, true)), '');

  out.push('## Questions people ask', '');
  for (const f of [...coreFaqs({ paymentsOpen: opts.paymentsOpen, rolesOn: c.rolesOn }), ...c.faqs]) {
    out.push(`### ${f.question}`, f.answer, '');
  }

  if (c.press.length > 0) {
    out.push('## Press', '');
    for (const p of c.press) out.push(`- [${p.title}](${absUrl(p.path)})${p.publishedAt ? ` (${p.publishedAt.slice(0, 10)})` : ''}: ${oneLine(p.excerpt, 300)}`);
    out.push('');
  }

  out.push('## Every public page', '');
  for (const e of DISCOVERY_ENTITIES) {
    const entries = e.entries(c);
    if (entries.length === 0) continue;
    out.push(`### ${e.label}`);
    for (const x of entries) out.push(`- ${absUrl(x.path)}${x.title ? ` (${x.title})` : ''}`);
    out.push('');
  }

  out.push('## For AI agents and developers', ...machineSection(), '', '## Contact', ...contactSection(), '', `Updated from live data at ${c.generatedAt}.`, '');
  return out.join('\n');
}
