/**
 * Paths no crawler needs: signed-in areas, auth flows and the API.
 *
 * /api/og is the one API path that IS allowed: it draws the share images that
 * X, LinkedIn, WhatsApp and Facebook fetch for link previews, and a blocked
 * image means a preview with no picture. (The longer, more specific Allow
 * wins over the shorter Disallow.)
 *
 * /api/search stays blocked on purpose: its rate limit is in memory and resets
 * on every cold start, a search with no results is recorded as unmet demand
 * (crawler queries would pollute that signal), and with RAG on each query
 * costs an embedding call. Every result it returns is also on a page that is
 * in the sitemap, so crawlers lose nothing.
 */
export const PRIVATE_PATHS = [
  '/admin/',
  '/dashboard/',
  '/api/',
  '/onboarding',
  '/reset-password',
  '/auth/',
  // Internal target of the <page>.md rewrite (lib/discovery/proxy-rewrite.ts);
  // the public address of a markdown twin is <page>.md, which stays allowed.
  '/md/',
] as const;

export const PUBLIC_API_PATHS = ['/api/og'] as const;

/**
 * The machine-readable doors for AI agents and tools (lib/discovery/llms.ts
 * DISCOVERY_ENDPOINTS), named so a crawler that reads robots.txt sees they
 * are meant for it. The catalogue API lives at /v1, not under the blocked
 * /api/.
 */
export const DISCOVERY_PATHS = ['/llms.txt', '/llms-full.txt', '/openapi.json', '/v1/', '/mcp', '/.well-known/'] as const;

/**
 * Search and AI crawlers we name and welcome. The site wants to be found by
 * people searching and by people asking an AI assistant, so the answer
 * engines (OpenAI, Anthropic, Perplexity, Google, Apple, Microsoft, Meta) and
 * Common Crawl, which many open models are trained on, are all allowed.
 *
 * A crawler that matches a named group ignores the `*` group, so each group
 * repeats the same private paths.
 */
export const ALLOWED_AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'CCBot',
  'meta-externalagent',
] as const;

/**
 * Crawlers refused outright. Bytespider (ByteDance) is widely reported to
 * crawl at very high volume and to ignore crawl limits, and it sends no
 * visitors back. Note robots.txt is a request, not a wall: a crawler that
 * ignores it has to be blocked at the firewall (Vercel WAF) instead.
 */
export const BLOCKED_CRAWLERS = ['Bytespider'] as const;
