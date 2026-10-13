import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { coreFaqs } from '@/lib/content/faqs';
import {
  categoriesJson,
  creatorJson,
  findCreator,
  findRental,
  howToBook,
  parseDates,
  rentalJson,
  searchCreators,
  searchRentals,
  toolJson,
  type AvailabilityCheck,
} from '@/lib/discovery/api';
import { DISCOVERY_ENTITIES } from '@/lib/discovery/registry';
import { absUrl } from '@/lib/discovery/format';
import type { Catalog } from '@/lib/discovery/types';

/**
 * The ThabangVision MCP server: read only, no sign in, over Streamable HTTP
 * at /mcp (app/mcp/route.ts).
 *
 * Follows docs/ai/mcp-a2a-evaluation.md where it applies: that note holds
 * back an MCP server that acts for a signed-in user (bookings, OAuth,
 * approvals). This one does none of that. It only answers what public pages
 * already show (the catalogue scope), so it needs no OAuth and has no commit
 * or prepare tools. Tool descriptions are static text, never built from
 * user data. Every answer carries the canonical page URL so the agent sends
 * the person to the site to book; nothing here can book, pay or write.
 *
 * Stateless: a fresh server and transport per request, JSON responses (no
 * SSE stream), which suits serverless functions.
 */

export const MCP_SERVER_NAME = 'thabangvision';
export const MCP_SERVER_VERSION = '1.0.0';
export const MCP_TOOL_NAMES = [
  'search_gear',
  'get_gear',
  'search_creators',
  'get_creator',
  'list_categories',
  'list_tools',
  'how_to_book',
] as const;

export interface McpDeps {
  catalog: () => Promise<Catalog>;
  /** Availability for dates; omitted in tests that do not need it. */
  availability?: AvailabilityCheck;
  paymentsOpen: () => boolean;
  today: () => string;
}

const INSTRUCTIONS = `${STUDIO.name} is a South African marketplace to rent camera and production gear (collection in ${STUDIO.location.city}, delivery in ${STUDIO.serviceArea.province}) and to book ID-checked photographers and videographers. It also gives away ${UBUNYE_STUDIO.suiteName}, free open source photo and film apps. These tools are read only. Prices are in South African rand (ZAR). To book or pay, send the person to the url in each result.`;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Builds the server with all tools registered. Exported for tests. */
export function createDiscoveryMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: STUDIO.name, websiteUrl: STUDIO.meta.url },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'search_gear',
    {
      title: 'Search gear for hire',
      description:
        'Search camera, lens, lighting, sound and other production gear for hire. Optional filters: category (a slug from list_categories), city (a South African city), and start_date/end_date (YYYY-MM-DD) to keep only items free on those dates. Returns prices in ZAR per day and the page URL to book.',
      inputSchema: {
        query: z.string().max(200).optional().describe('What to look for, e.g. "sony fx3" or "led panel".'),
        category: z.string().max(60).optional().describe('Rental category slug, e.g. cameras-optics.'),
        city: z.string().max(60).optional().describe('City, e.g. Johannesburg or Pretoria.'),
        start_date: z.string().max(10).optional().describe('First hire day, YYYY-MM-DD.'),
        end_date: z.string().max(10).optional().describe('Last hire day, YYYY-MM-DD.'),
        limit: z.number().int().min(1).max(50).optional().describe('How many results (default 10).'),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const dates = parseDates(args.start_date, args.end_date, deps.today());
      if (dates && 'error' in dates) return fail(dates.error);
      const c = await deps.catalog();
      const res = await searchRentals(
        c,
        { query: args.query, category: args.category, city: args.city, dates, limit: args.limit ?? 10 },
        deps.availability,
      );
      return ok({ ...res, all_gear: absUrl('/rentals') });
    },
  );

  server.registerTool(
    'get_gear',
    {
      title: 'Get one item of gear',
      description: 'Full details of one rental item by its id or slug (from search_gear): price per day in ZAR, deposit, what comes with it, and the page URL to book.',
      inputSchema: { id_or_slug: z.string().min(1).max(200) },
      annotations: READ_ONLY,
    },
    async ({ id_or_slug }) => {
      const c = await deps.catalog();
      const r = findRental(c, id_or_slug);
      if (!r) return fail(`No gear with that id or slug. Search with search_gear, or see ${absUrl('/rentals')}.`);
      const schema = DISCOVERY_ENTITIES.find((e) => e.type === 'rental')?.jsonLd?.(c, r.path) ?? null;
      return ok({ ...rentalJson(r), schema_org: schema });
    },
  );

  server.registerTool(
    'search_creators',
    {
      title: 'Search creators',
      description:
        'Search ID-checked photographers, videographers and other creators open for bookings. Optional filters: category (a studio category slug from list_categories, or a specialisation like Photography) and city. Returns hourly rates in ZAR and the profile URL to book.',
      inputSchema: {
        query: z.string().max(200).optional(),
        category: z.string().max(60).optional(),
        city: z.string().max(60).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const c = await deps.catalog();
      return ok(searchCreators(c, { query: args.query, category: args.category, city: args.city, limit: args.limit ?? 10 }));
    },
  );

  server.registerTool(
    'get_creator',
    {
      title: 'Get one creator',
      description: 'A creator profile by handle (from search_creators): what they do, where they are based, their rate in ZAR and the profile URL to book.',
      inputSchema: { slug: z.string().min(1).max(200) },
      annotations: READ_ONLY,
    },
    async ({ slug }) => {
      const c = await deps.catalog();
      const p = findCreator(c, slug);
      if (!p) return fail(`No creator with that handle. Search with search_creators, or see ${absUrl('/smart-creators')}.`);
      const schema = DISCOVERY_ENTITIES.find((e) => e.type === 'creator')?.jsonLd?.(c, p.path) ?? null;
      return ok({ ...creatorJson(p), schema_org: schema });
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description: 'The gear categories that have stock (with item counts) and the studio categories for shoots (with creator counts).',
      annotations: READ_ONLY,
    },
    async () => ok(categoriesJson(await deps.catalog())),
  );

  server.registerTool(
    'list_tools',
    {
      title: 'List free tools',
      description: `${UBUNYE_STUDIO.suiteName}: free, open source apps for photo and film, with download links, the browser version and the source code.`,
      annotations: READ_ONLY,
    },
    async () => ok((await deps.catalog()).tools.map(toolJson)),
  );

  server.registerTool(
    'how_to_book',
    {
      title: 'How booking works',
      description: 'How to rent gear or book a creator: the steps, notice needed, deposit, ID check, collection and delivery, cancelling, and how to pay. Booking itself happens on the website.',
      annotations: READ_ONLY,
    },
    async () => ok(howToBook(coreFaqs({ paymentsOpen: deps.paymentsOpen() }))),
  );

  return server;
}

/** Handles one HTTP request to /mcp. */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  const server = createDiscoveryMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: nothing to keep once the answer is written.
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}

/** The server card at /.well-known/mcp.json. */
export function mcpServerCard(): Record<string, unknown> {
  return {
    name: MCP_SERVER_NAME,
    title: STUDIO.name,
    version: MCP_SERVER_VERSION,
    description: INSTRUCTIONS,
    websiteUrl: STUDIO.meta.url,
    transport: { type: 'streamable-http', url: absUrl('/mcp') },
    authentication: { required: false },
    capabilities: { tools: { listChanged: false } },
    tools: MCP_TOOL_NAMES.map((name) => ({ name })),
    readOnly: true,
    documentation: absUrl('/llms.txt'),
    openapi: absUrl('/openapi.json'),
  };
}
