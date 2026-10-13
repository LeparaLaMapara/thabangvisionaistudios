# Performance budget (spec 9.5)

Measured baseline, the changes made in Phase 3, and the budget each public
page should stay inside. Numbers are measurements, not targets pulled from the
air: the budget is the measured "after" value plus headroom.

## How it was measured

- Production build (`npm run build`, Next.js 16 + Turbopack), served with
  `next start`. Two builds compared: the Phase 3 starting point (`0063a8f`) and
  this change.
- Supabase replaced by a small local PostgREST stand-in returning 24 published
  rentals in 4 categories (6 each, one with a deliberately long unbroken title),
  so catalogue pages render real-shaped data. The CI env points at an
  unreachable host, which makes every server render wait on DNS/connect
  timeouts (TTFB ~7 s) and is useless for timing.
- Chromium via Playwright. Metrics from the page itself: navigation timing
  (TTFB, DCL, load), `largest-contentful-paint` and `layout-shift`
  PerformanceObservers, and resource timing for JavaScript bytes.
- "Desktop" = Desktop Chrome 1280 px. "Mobile" = iPhone 14 viewport (393 px,
  DPR 3, touch). "Throttled mobile" adds Lighthouse-like conditions through
  CDP: ~1.6 Mbps down, 150 ms RTT, 4x CPU slowdown.
- Median of 5 runs (unthrottled) or 3 runs (throttled). Images point at an
  image CDN that the sandbox cannot reach, so LCP here is text/animation
  timing; real-world LCP will usually be an image and higher. Treat the
  absolute values as lab numbers and the before/after deltas as the signal.

Next.js 16 with Turbopack no longer prints per-route "First Load JS" in the
build output (every route shows only `ƒ`), so JavaScript is measured in the
browser: the sum of `.js` resources a cold load fetches (transfer = gzip as
served; decoded = parsed size).

## Results

### Largest Contentful Paint (ms)

| Page | Desktop before | Desktop after | Mobile before | Mobile after | Throttled mobile before | Throttled mobile after |
|---|---:|---:|---:|---:|---:|---:|
| `/` | 268 | 288 | 268 | 280 | 1444 | 1292 |
| `/rentals` | 1172 | 184 | 1148 | 184 | 4092 | 1212 |
| `/rentals/[category]` | 180 | 216 | 596 | 240 | 3704 | 1252 |
| `/rentals/[category]/[slug]` | 1532 | 272 | 1460 | 228 | 4468 | 1328 |
| `/ubunye-ai-studio` | 1156 | 208 | 220 | 224 | 1148 | 1124 |

What moved it:

- Rental detail: the priority hero image faded in from opacity 0 over 1.5 s
  and the title/description were staggered in over 0.5-1.1 s. They now paint
  on arrival.
- `/rentals`: the heading faded in over 0.8 s, and the category cards stayed
  at opacity 0 until every earlier card's image had loaded (and forever if one
  failed). Cards now render immediately over a dark placeholder.
- Ubunye studio: the greeting/heading block no longer fades in.

CLS was 0.000 on every page before and after.

### JavaScript on a cold load (transfer KB / decoded KB, files)

| Page | Before | After |
|---|---|---|
| `/` | 275.0 / 914.4 (15) | 275.6 / 916.0 (15) |
| `/rentals` | 266.3 / 886.5 (14) | 266.8 / 887.7 (14) |
| `/rentals/[category]` | 269.7 / 901.0 (14) | 271.1 / 904.1 (14) |
| `/rentals/[category]/[slug]` | 275.1 / 922.1 (14) | 275.2 / 921.0 (14) |
| `/ubunye-ai-studio` | 421.4 / 1495.0 (16) | 422.7 / 1498.5 (16) |

JavaScript is flat (+0.5 to 1.4 KB for the shared focus-trap hook and the
address combobox). No dependency was added to the app bundle;
`@axe-core/playwright` is a devDependency used only by the E2E suite.

### Page payload (uncompressed HTML incl. the inline RSC payload)

| Page | Before | After |
|---|---:|---:|
| `/rentals` | 96.3 KB | 53.2 KB |
| `/rentals/[category]` (6 items) | 88.2 KB | 84.9 KB |
| `/rentals/[category]/[slug]` | 93.5 KB | 91.9 KB |

`/rentals` used to load every published rental, full gallery included, just to
count items per category, and shipped all of it to the browser. It now reads
one `category` column per row. The saving grows with the catalogue: with the
real stock (dozens of items, several gallery images each) it is larger than
the 24-item fixture shows. Category pages now read only the fields a card
shows, with the first gallery image (`gallery->0`) instead of the array.

### Mobile layout (393 px)

| Page | scrollWidth before | after |
|---|---:|---:|
| `/rentals/[category]` with a long title | 481 | 393 |

## Database reads

- `/rentals`: `select('category')` capped at `RENTAL_COUNT_SCAN_LIMIT` (5000),
  instead of every column of every rental.
- `/rentals/[category]`: card columns only, capped at
  `RENTAL_CATEGORY_PAGE_LIMIT` (200) with one extra row read to detect "there
  is more" (the page then says it is showing the top N).
- Rental detail: `getRentalBySlug` is wrapped in React `cache()`, so
  `generateMetadata` and the page share one query per request (was two).
- A failed read is now reported as failed, not as an empty list: `/rentals`
  falls back to the fixed category list with a "couldn't load live stock" note
  and a retry; a category page shows "couldn't load" with Try again instead of
  "No equipment published in this category yet".

### Caching: why `revalidate = 60` does nothing today

The catalogue pages declare `export const revalidate = 60`, but every route
builds as dynamic (`ƒ`). Two reasons, both outside this change:

1. `app/layout.tsx` reads the session (`supabase.auth.getUser()` through the
   cookie-bound server client) on every request to bridge auth state to the
   client, which opts every route into dynamic rendering.
2. The query modules use the cookie-bound server client. There is no
   cookieless anon client in `lib/supabase/`.

Making catalogue reads cacheable needs both a cookieless public client for
published-catalogue reads and moving the root layout's session read out of the
shared path (for example, let `AuthProvider` resolve it, or scope it to the
route groups that need it). That touches the auth bridge, which CLAUDE.md asks
to keep, so it is left as a follow-up rather than done here.

## Budget

Checked against a production build with the method above. A change that
breaks a line should either fix it or update this file with the reason.

| Metric | Budget | Applies to |
|---|---|---|
| LCP, throttled mobile (lab) | <= 1.8 s | `/`, `/rentals`, `/rentals/[category]`, rental detail, `/ubunye-ai-studio` |
| LCP, field (Vercel Speed Insights, p75 mobile) | <= 2.5 s | same pages (Core Web Vitals "good") |
| CLS | <= 0.05 lab, <= 0.1 field p75 | all public pages |
| JavaScript, cold load, gzip | <= 300 KB | catalogue pages and `/` |
| JavaScript, cold load, gzip | <= 450 KB | `/ubunye-ai-studio` (chat runtime + markdown) |
| `/rentals` HTML+RSC | <= 70 KB | at current stock; grows only with category count |
| Category page HTML+RSC | <= 2 KB per listed item + 75 KB | `/rentals/[category]` |
| Horizontal overflow at 393 px | none (`scrollWidth <= clientWidth`) | all public pages (tests/e2e/mobile.spec.ts) |
| Serious/critical axe violations | 0 | pages in tests/e2e/a11y.spec.ts |
| Touch targets | >= 44 x 44 CSS px | controls covered by tests/e2e/mobile.spec.ts |
| New runtime dependency | must show a measured win on this table | all |

## Not done (with reasons)

- **framer-motion (used in ~60 files)**: a `LazyMotion` + `m` conversion only
  pays off if no eagerly-loaded component still imports `motion`; the shared
  Header, the Ubunye studio and most pages do, so converting the few files
  owned by this change would save nothing measurable. A repo-wide conversion
  is a separate, mechanical task.
- **Splitting `RentalDetailView` into server and client parts**: the static
  sections (specs table, related items, owner card) could render on the
  server, but the component interleaves them with the gallery and tab state
  and the booking widget. JavaScript for the route is already flat, so the
  split was judged not worth the risk in this change.
- **Orbitron font**: removed from `app/layout.tsx` (six weights, unused). It
  was never preloaded, so this trims one `@font-face` block and one font file
  from the build rather than moving LCP.
