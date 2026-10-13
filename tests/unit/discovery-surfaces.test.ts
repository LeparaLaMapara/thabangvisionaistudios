import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RENTAL_POLICY, STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { buildLlmsFullTxt, buildLlmsTxt, DISCOVERY_ENDPOINTS } from '@/lib/discovery/llms';
import { renderMarkdownTwin } from '@/lib/discovery/markdown';
import { parseDates, searchCreators, searchRentals, findCity } from '@/lib/discovery/api';
import { openApiDocument } from '@/lib/discovery/openapi';
import { createDiscoveryMcpServer, MCP_TOOL_NAMES, mcpServerCard } from '@/lib/discovery/mcp';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { fixtureCatalog } from './helpers/discovery-catalog';

const c = fixtureCatalog();
const url = (p: string) => `${STUDIO.meta.url}${p}`;

describe('llms.txt', () => {
  const body = buildLlmsTxt(c, { paymentsOpen: false });

  it('lists live gear with ZAR per day and links, categories with counts, creators and tools', () => {
    expect(body).toContain(`[Sony FX3](${url('/rentals/cameras-optics/sony-fx3')}): R950 a day`);
    expect(body).toContain('refundable deposit R5 000');
    expect(body).toMatch(/Cameras & Optics\]\(.*\/rentals\/cameras-optics\): 2 items/);
    expect(body).toContain(`[Thandi M](${url('/studio/category/photography/thandi')})`);
    expect(body).toContain('https://downloads.thabangvision.com/light/ubunye-light-0.1.0-windows-x64.msi');
  });

  it('states the rules from constants and links every machine endpoint', () => {
    expect(body).toContain(`${RENTAL_POLICY.platformShareBps / 100}% of the hire fee`);
    expect(body).toContain(`We work in ${STUDIO.serviceArea.province}.`);
    for (const p of Object.values(DISCOVERY_ENDPOINTS).filter((x) => x !== '/llms.txt' && x !== '/v1')) expect(body).toContain(url(p));
    expect(body).toContain(url('/v1/rentals'));
  });

  it('leaves the studio out when the flag is off', () => {
    const off = buildLlmsTxt({ ...c, studioOn: false }, { paymentsOpen: false });
    expect(off).not.toContain('Thandi M');
  });

  it('llms-full.txt has the whole catalogue, the FAQ and every public page', () => {
    const full = buildLlmsFullTxt(c, { paymentsOpen: true });
    expect(full).toContain('#### Canon EOS R6');
    expect(full).toContain('Not available right now');
    expect(full).toContain('### Do you open on Sundays?');
    expect(full).toContain(url('/rentals/audio/in/johannesburg'));
    expect(full).toContain('sha256 abc');
  });
});

describe('markdown twins', () => {
  const md = (p: string) => renderMarkdownTwin(p, c, { paymentsOpen: false });

  it('renders gear, category, creator, studio category, press, tools and FAQ pages', () => {
    expect(md('/rentals/cameras-optics/sony-fx3')).toContain('# Sony FX3');
    expect(md('/rentals/cameras-optics/sony-fx3')).toContain('- Two batteries');
    expect(md('/rentals/cameras-optics')).toContain('# Cameras & Optics for hire');
    expect(md('/studio/category/photography/thandi')).toContain('From R600 an hour');
    expect(md('/studio/category/photography')).toContain('Thandi M');
    expect(md('/press/launch')).toContain('Long **markdown** body.');
    expect(md('/tools')).toContain(UBUNYE_STUDIO.suiteName);
    expect(md('/tools/light')).toContain('Ubunye Light: RAW Photo Editor');
    expect(md('/faq')).toContain('## Do you open on Sundays?');
  });

  it('has no twin for missing items or pages without one', () => {
    expect(md('/rentals/cameras-optics/nope')).toBeNull();
    expect(md('/rentals/lighting-power')).toBeNull();
    expect(md('/about')).toBeNull();
    expect(md('/login')).toBeNull();
    expect(renderMarkdownTwin('/studio/category/photography/thandi', { ...c, studioOn: false }, { paymentsOpen: false })).toBeNull();
  });

  it('pages advertise their twin', () => {
    const m = buildPageMetadata({ title: 't', description: 'd', path: '/faq', markdown: true });
    expect((m.alternates?.types as Record<string, string>)['text/markdown']).toBe(url('/faq.md'));
    const plain = buildPageMetadata({ title: 't', description: 'd', path: '/about' });
    expect((plain.alternates?.types as Record<string, string>)['text/markdown']).toBeUndefined();
  });
});

describe('catalogue search', () => {
  it('finds gear by words, category and city, and reports the service area honestly', async () => {
    expect((await searchRentals(c, { query: 'sony' })).items.map((r) => r.slug)).toEqual(['sony-fx3']);
    expect((await searchRentals(c, { category: 'audio' })).items.map((r) => r.slug)).toEqual(['rode-ntg']);
    expect((await searchRentals(c, { city: 'jhb' })).total).toBe(3);
    const far = await searchRentals(c, { city: 'Cape Town' });
    expect(far.total).toBe(0);
    expect(far.notes.join(' ')).toContain(STUDIO.serviceArea.outsideProvinceNote);
    const first = (await searchRentals(c, {})).items[0];
    expect(first).toMatchObject({ currency: 'ZAR', price_per_day_zar: 950, url: url('/rentals/cameras-optics/sony-fx3') });
  });

  it('filters by dates with the availability check, and drops gear listed as unavailable', async () => {
    const check = vi.fn(async (r: { slug: string }) => r.slug !== 'rode-ntg');
    const res = await searchRentals(c, { dates: { start: '2026-11-01', end: '2026-11-02' } }, check);
    expect(res.items.map((r) => r.slug)).toEqual(['sony-fx3']);
    expect(res.items[0].available_for_dates).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('checks dates', () => {
    expect(parseDates('2026-11-01', '2026-11-03', '2026-10-13')).toEqual({ start: '2026-11-01', end: '2026-11-03' });
    expect(parseDates('2026-10-01', null, '2026-10-13')).toMatchObject({ error: expect.stringContaining('past') });
    expect(parseDates('1 Nov', null, '2026-10-13')).toMatchObject({ error: expect.any(String) });
    expect(parseDates('2026-11-05', '2026-11-01', '2026-10-13')).toMatchObject({ error: expect.any(String) });
    expect(parseDates(null, null, '2026-10-13')).toBeNull();
  });

  it('finds creators by category and city; no personal data beyond the page', () => {
    const res = searchCreators(c, { category: 'photography', city: 'johannesburg' });
    expect(res.items).toHaveLength(1);
    expect(Object.keys(res.items[0]).sort()).toEqual(
      ['avatar', 'bio', 'category', 'cities', 'currency', 'handle', 'hourly_rate_zar', 'location', 'markdown_url', 'name', 'specializations', 'url', 'verified', 'years_experience'].sort(),
    );
    expect(searchCreators(c, { city: 'pretoria' }).total).toBe(0);
    expect(findCity('Joburg')?.slug).toBe('johannesburg');
  });
});

describe('OpenAPI document', () => {
  const doc = openApiDocument() as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };

  it('is OpenAPI 3.1 and every path has a route handler', () => {
    expect(doc.openapi).toBe('3.1.0');
    for (const p of Object.keys(doc.paths)) {
      const dir = p.replace(/\{(\w+)\}/g, '[$1]');
      expect(existsSync(join(process.cwd(), 'app', dir, 'route.ts')), `${p} has no app${dir}/route.ts`).toBe(true);
    }
  });

  it('every $ref points at a schema that exists', () => {
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g) ?? [];
    for (const r of refs) expect(doc.components.schemas).toHaveProperty(r.split('/').pop() as string);
  });
});

describe('MCP server', () => {
  async function connect() {
    const server = createDiscoveryMcpServer({
      catalog: async () => c,
      availability: async () => true,
      paymentsOpen: () => false,
      today: () => '2026-10-13',
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

  it('lists exactly the read-only tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it('search_gear and get_gear return ZAR prices and the page URL', async () => {
    const client = await connect();
    const found = json(await client.callTool({ name: 'search_gear', arguments: { query: 'fx3', start_date: '2026-11-01', end_date: '2026-11-02' } }));
    expect(found.items[0]).toMatchObject({ slug: 'sony-fx3', price_per_day_zar: 950, available_for_dates: true, url: url('/rentals/cameras-optics/sony-fx3') });
    const one = json(await client.callTool({ name: 'get_gear', arguments: { id_or_slug: 'rode-ntg' } }));
    expect(one).toMatchObject({ title: 'Rode NTG shotgun mic', supplied_by: 'verified_member' });
    expect(one.schema_org['@type']).toBe('Product');
    const missing = await client.callTool({ name: 'get_gear', arguments: { id_or_slug: 'nope' } });
    expect(missing.isError).toBe(true);
    const badDates = await client.callTool({ name: 'search_gear', arguments: { start_date: '2020-01-01' } });
    expect(badDates.isError).toBe(true);
  });

  it('search_creators and get_creator', async () => {
    const client = await connect();
    const found = json(await client.callTool({ name: 'search_creators', arguments: { category: 'photography' } }));
    expect(found.items[0].handle).toBe('thandi');
    const one = json(await client.callTool({ name: 'get_creator', arguments: { slug: 'thandi' } }));
    expect(one).toMatchObject({ name: 'Thandi M', hourly_rate_zar: 600, url: url('/studio/category/photography/thandi') });
  });

  it('list_categories, list_tools and how_to_book', async () => {
    const client = await connect();
    const cats = json(await client.callTool({ name: 'list_categories', arguments: {} }));
    expect(cats.rentals.map((x: { slug: string }) => x.slug).sort()).toEqual(['audio', 'cameras-optics']);
    expect(cats.studio.find((x: { slug: string }) => x.slug === 'photography').creators).toBe(1);
    const tools = json(await client.callTool({ name: 'list_tools', arguments: {} }));
    expect(tools[0]).toMatchObject({ slug: 'light', price_zar: 0 });
    const how = json(await client.callTool({ name: 'how_to_book', arguments: {} }));
    expect(how.gear_url).toBe(url('/rentals'));
    expect(how.rules.length).toBeGreaterThan(4);
  });

  it('publishes a server card', () => {
    const card = mcpServerCard() as { transport: { url: string }; tools: unknown[] };
    expect(card.transport.url).toBe(url('/mcp'));
    expect(card.tools).toHaveLength(MCP_TOOL_NAMES.length);
  });
});
