import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, DISCOVERY_RATE_LIMITS } from '@/lib/discovery/api';

/**
 * OpenAPI 3.1 description of the public catalogue API at /v1, served at
 * /openapi.json. Kept beside the handlers' shapes (lib/discovery/api.ts);
 * tests/unit/discovery-api.test.ts checks every documented path has a route.
 */

const str = { type: 'string' } as const;
const nstr = { type: ['string', 'null'] } as const;
const nnum = { type: ['number', 'null'] } as const;

const limit = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: API_MAX_LIMIT, default: API_DEFAULT_LIMIT },
};
const offset = { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } };
const q = { name: 'q', in: 'query', description: 'Words to search for.', schema: str };
const city = { name: 'city', in: 'query', description: 'A South African city: slug, name or common alias (e.g. johannesburg, jhb, pretoria).', schema: str };

const errorResponse = {
  description: 'Error',
  content: { 'application/json': { schema: { type: 'object', properties: { error: str }, required: ['error'] } } },
};

const rental = {
  type: 'object',
  required: ['id', 'slug', 'title', 'category', 'currency', 'price_per_day_zar', 'url'],
  properties: {
    id: { ...str, format: 'uuid' },
    slug: str,
    title: str,
    category: str,
    category_label: nstr,
    brand: nstr,
    model: nstr,
    currency: { const: 'ZAR' },
    price_per_day_zar: { ...nnum, description: 'Rands a day. Null when no price is set.' },
    price_per_week_zar: nnum,
    deposit_zar: { ...nnum, description: 'Refundable security deposit in rands.' },
    listed_as_available: { type: 'boolean' },
    units: { type: 'integer' },
    supplied_by: { enum: ['thabangvision', 'verified_member'] },
    includes: { type: 'array', items: str },
    description: nstr,
    image: nstr,
    url: { ...str, format: 'uri', description: 'The page to book it on.' },
    markdown_url: { ...str, format: 'uri' },
    updated_at: nstr,
    available_for_dates: { type: ['boolean', 'null'], description: 'Only when dates were given.' },
  },
};

const creator = {
  type: 'object',
  required: ['handle', 'name', 'category', 'url'],
  properties: {
    handle: str,
    name: str,
    category: str,
    specializations: { type: 'array', items: str },
    location: nstr,
    cities: { type: 'array', items: str },
    currency: { const: 'ZAR' },
    hourly_rate_zar: nnum,
    years_experience: { type: ['integer', 'null'] },
    verified: { const: true },
    bio: nstr,
    avatar: nstr,
    url: { ...str, format: 'uri' },
    markdown_url: { ...str, format: 'uri' },
  },
};

const tool = {
  type: 'object',
  properties: {
    slug: str,
    name: str,
    category: str,
    tagline: str,
    capabilities: { type: 'array', items: str },
    licence: str,
    price_zar: { const: 0 },
    web_url: { ...str, format: 'uri' },
    source_url: { ...str, format: 'uri' },
    version: nstr,
    published: nstr,
    downloads: {
      type: 'array',
      items: { type: 'object', properties: { platform: str, label: str, url: { ...str, format: 'uri' } } },
    },
    url: { ...str, format: 'uri' },
    markdown_url: { ...str, format: 'uri' },
  },
};

const list = (item: string) => ({
  type: 'object',
  required: ['total', 'items'],
  properties: {
    total: { type: 'integer' },
    items: { type: 'array', items: { $ref: `#/components/schemas/${item}` } },
    notes: { type: 'array', items: str },
  },
});

export function openApiDocument(): Record<string, unknown> {
  const perMinute = DISCOVERY_RATE_LIMITS.api.max;
  return {
    openapi: '3.1.0',
    info: {
      title: `${STUDIO.name} catalogue API`,
      version: '1.0.0',
      summary: 'Read only: gear for hire, creators, categories and free tools.',
      description: `The public catalogue of ${STUDIO.name}, a South African marketplace to rent camera and production gear and book ID-checked creators. Prices are in South African rand (ZAR). No key needed; ${perMinute} requests a minute per IP. Every item has a url: booking and payment happen on that page, not through this API. Only what public pages show is returned.`,
      contact: { name: STUDIO.name, email: STUDIO.email, url: STUDIO.meta.url },
    },
    servers: [{ url: STUDIO.meta.url }],
    // Public and read only: no key, no sign in.
    security: [],
    externalDocs: { description: 'Guide for AI agents', url: `${STUDIO.meta.url}/llms.txt` },
    paths: {
      '/v1/rentals': {
        get: {
          operationId: 'listRentals',
          summary: 'Search gear for hire',
          parameters: [
            q,
            { name: 'category', in: 'query', schema: { enum: RENTAL_CATEGORIES.map((c) => c.value) } },
            city,
            { name: 'start', in: 'query', description: 'First hire day, YYYY-MM-DD. With end, keeps only items free on those dates.', schema: { ...str, format: 'date' } },
            { name: 'end', in: 'query', description: 'Last hire day, YYYY-MM-DD.', schema: { ...str, format: 'date' } },
            limit,
            offset,
          ],
          responses: {
            200: { description: 'Matching gear', content: { 'application/json': { schema: list('Rental') } } },
            400: errorResponse,
            429: errorResponse,
          },
        },
      },
      '/v1/rentals/{id}': {
        get: {
          operationId: 'getRental',
          summary: 'One item of gear by id or slug',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: {
            200: { description: 'The item', content: { 'application/json': { schema: { $ref: '#/components/schemas/Rental' } } } },
            404: errorResponse,
            429: errorResponse,
          },
        },
      },
      '/v1/creators': {
        get: {
          operationId: 'listCreators',
          summary: 'Search creators open for bookings',
          parameters: [q, { name: 'category', in: 'query', description: 'Studio category slug or a specialisation.', schema: str }, city, limit, offset],
          responses: {
            200: { description: 'Matching creators', content: { 'application/json': { schema: list('Creator') } } },
            429: errorResponse,
          },
        },
      },
      '/v1/creators/{handle}': {
        get: {
          operationId: 'getCreator',
          summary: 'One creator by handle',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: str }],
          responses: {
            200: { description: 'The creator', content: { 'application/json': { schema: { $ref: '#/components/schemas/Creator' } } } },
            404: errorResponse,
            429: errorResponse,
          },
        },
      },
      '/v1/categories': {
        get: {
          operationId: 'listCategories',
          summary: 'Gear categories with stock, and studio categories',
          responses: {
            200: {
              description: 'Categories',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      rentals: { type: 'array', items: { type: 'object', properties: { slug: str, label: str, description: str, items: { type: 'integer' }, url: str } } },
                      studio: { type: 'array', items: { type: 'object', properties: { slug: str, name: str, description: nstr, creators: { type: 'integer' }, url: str } } },
                    },
                  },
                },
              },
            },
            429: errorResponse,
          },
        },
      },
      '/v1/tools': {
        get: {
          operationId: 'listTools',
          summary: 'Free, open source photo and film apps',
          responses: {
            200: { description: 'Tools', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Tool' } } } } } } },
            429: errorResponse,
          },
        },
      },
    },
    components: { schemas: { Rental: rental, Creator: creator, Tool: tool } },
  };
}
