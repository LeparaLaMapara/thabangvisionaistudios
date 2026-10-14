/**
 * Which sitemap lists each public page route.
 *
 * The sitemap is an index (/sitemap.xml) of child sitemaps, one per kind of
 * page (/sitemap/<id>.xml). Every public page route must appear here, or in
 * NOT_IN_SITEMAP with the reason it is left out. tests/unit/seo-route-registry
 * walks app/ and fails the build when a new public page is in neither list, so
 * a page cannot ship without anyone deciding whether search engines should
 * find it (the "built but not wired" bug class).
 *
 * Route patterns are written the way the app/ folders are, without route
 * groups: /rentals/[category]/[slug].
 *
 * Each route here must also be owned by an entity in the discovery registry
 * (lib/discovery/registry.ts), which says how to list its URLs; the
 * discovery-registry test enforces that.
 */

export const SITEMAP_IDS = ['static', 'rentals', 'creators', 'studio', 'press', 'marketplace', 'tools'] as const;
export type SitemapId = (typeof SITEMAP_IDS)[number];

/** Public, indexable routes and the child sitemap that lists them. */
export const SITEMAP_ROUTES: Record<string, SitemapId> = {
  '/': 'static',
  '/about': 'static',
  '/contact': 'static',
  '/careers': 'static',
  '/locations': 'static',
  '/faq': 'static',
  '/pricing': 'static',
  '/pay': 'static',
  '/legal': 'static',
  '/privacy': 'static',
  '/refunds': 'static',
  '/paia': 'static',
  '/resources/tools': 'static',
  '/ubunye-ai-studio': 'static',

  '/rentals': 'rentals',
  '/rentals/[category]': 'rentals',
  '/rentals/[category]/[slug]': 'rentals',
  '/rentals/[category]/in/[city]': 'rentals',

  '/smart-creators': 'creators',
  // Creator profiles live at /studio/category/[slug]/[id] (lib/seo/creator-url.ts)
  // and are listed in this sitemap; /creators/[id] only for members with gear
  // for hire.
  '/creators/[id]': 'creators',
  '/studio/category/[slug]/[id]': 'creators',

  '/studio': 'studio',
  '/studio/[slug]': 'studio',
  '/studio/category/[slug]': 'studio',
  '/studio/category/[slug]/in/[city]': 'studio',

  '/press': 'press',
  '/press/[slug]': 'press',

  '/marketplace': 'marketplace',
  '/marketplace/[slug]': 'marketplace',

  '/tools': 'tools',
  '/tools/[app]': 'tools',
};

/**
 * Public page routes deliberately left out of the sitemap, and why. Each one
 * must be noindex (metadata robots) or a redirect; the test checks that too.
 */
export const NOT_IN_SITEMAP: Record<string, 'noindex' | 'redirect'> = {
  // Account and auth flows.
  '/login': 'noindex',
  '/register': 'noindex',
  '/reset-password': 'noindex',
  '/onboarding': 'noindex',
  '/welcome': 'noindex',
  '/email-preferences': 'noindex',
  '/unsubscribe': 'noindex',
  // Forms and tools for people already on the site.
  '/book': 'noindex',
  '/support/tech': 'noindex',
  '/support/report-bug': 'noindex',
  '/qr': 'noindex',
  // Many roles, honest proof (TASK-085): noindex while the roles_v1 trial
  // runs (demo profiles live on dev). Move to SITEMAP_ROUTES at launch.
  '/join': 'redirect',
  '/join/[role]': 'redirect',
  '/people': 'noindex',
  '/people/[id]': 'noindex',
  '/offer': 'noindex',
  '/offer/[role]': 'redirect',
  '/offer/preview': 'noindex',
  '/offer/guidelines': 'noindex',
  '/people/[id]/request': 'noindex',
  '/people/requests/[rid]': 'noindex',
  // Retired gear and past work: nothing on it can be booked.
  '/archive': 'noindex',
  // Old or duplicate addresses that redirect to the real page.
  '/cart': 'redirect',
  '/creators': 'redirect',
  '/catalog/[slug]': 'redirect',
};

/** Route-group folders whose pages are private (signed in) and never crawled. */
export const PRIVATE_ROUTE_PREFIXES = ['/admin', '/dashboard'] as const;
