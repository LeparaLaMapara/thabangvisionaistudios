# The discovery engine

How ThabangVision gets found by search engines and by AI assistants, and how
that stays true by itself as gear, creators and features change.

Step 1 (PR #90) gave every page one address, structured data and an honest
sitemap. This step makes the whole thing read from one list and tell the
outside world when something changes.

## The pieces

```
              database (rentals, creators, studio, press, tools, FAQs)
                                   |
                     lib/discovery/catalog.ts   one read, cached 1 hour
                                   |
                     lib/discovery/registry.ts  one entry per kind of page
        _______________________|________________________________
       |          |           |            |           |        |
   sitemap    llms.txt    markdown      /v1 API      /mcp    daily sweep
              llms-full    twins     + openapi.json          (IndexNow)

   admin or owner saves something  ->  notifyDiscovery(paths)
        -> cache marked stale (all of the above refresh)
        -> IndexNow ping, after the response, production only
```

### 1. The catalogue (`lib/discovery/catalog.ts`)

One read of everything public: published gear, bookable creators (ID
checked, open for work, complete portfolio), studio categories and packages,
press, marketplace listings, the free Ubunye apps and published FAQs. Same
filters as the pages, and only the columns pages already show. It is cached
for an hour under the tag `discovery`.

### 2. The registry (`lib/discovery/registry.ts`)

A list with one entry per kind of public page: static pages, rentals index,
rental category, rental item, rental city page, creators list, creator
profile, member page, studio index, studio category, studio package, studio
city page, press index, press article, marketplace index and listing, tools
index and tool. Each entry says:

- which route patterns it owns (the same patterns as
  `lib/seo/sitemap-registry.ts`);
- which child sitemap lists it;
- how to list its URLs from the catalogue, with real last change dates;
- its JSON-LD builder, where one exists (gear, creators, tools);
- whether it has a markdown twin.

The sitemap, llms.txt, llms-full.txt, the daily sweep and the "is this URL
indexable" check all read this list.

### 3. notifyDiscovery (`lib/discovery/notify.ts`)

Call `notifyDiscovery(paths)` after a public thing is published, edited,
taken down or deleted. It:

1. marks the cached catalogue stale, so every surface reads fresh data on its
   next request;
2. after the response is sent (`after()`), pings IndexNow with the changed
   URLs. IndexNow is shared by Bing, Yandex, Seznam, Naver and others.

It never throws and never slows the save. URLs are batched and deduped, only
indexable pages are sent, and the ping only happens when `VERCEL_ENV` is
`production` and `INDEXNOW_KEY` is set. Path helpers live in
`lib/discovery/paths.ts` (a rental also changes its category, city and index
pages, so those are sent too).

Where it is called today:

| Write | File |
| --- | --- |
| Admin creates or edits gear | `app/api/admin/rentals/route.ts` |
| Admin approves, rejects or takes down a member's listing | `app/api/admin/listings/review/route.ts` |
| Owner edits or deletes a live listing | `app/api/listings/route.ts` |
| Owner's listing goes live on submit | `app/api/listings/[id]/submit/route.ts` |
| Admin press, studio packages, studio categories | `app/api/admin/press`, `productions`, `production-categories` |
| ID check approved or rejected | `app/api/admin/verifications/[id]/route.ts` |
| Creator saves their portfolio | `app/api/portfolio/route.ts` |
| Member suspended or reinstated | `app/api/admin/users/[id]/suspend`, `reinstate` |

### 4. The daily sweep (`lib/discovery/sweep.ts`)

Step 19 of the daily maintenance cron. It reads the catalogue fresh, finds
every page whose last change is in the past day and pings IndexNow with them
(at most 500). It catches what no write announced: a row edited in the SQL
editor, the cron that publishes creator packages, a ping that timed out.

Known gap: creator profile edits saved from the dashboard profile page go
straight from the browser to the database, and profiles have no "last
changed" date, so neither notifyDiscovery nor the sweep sees them. The
catalogue cache still refreshes within the hour.

### 5. IndexNow key file

`/<INDEXNOW_KEY>.txt` answers with the key. `proxy.ts` rewrites that address
to `app/indexnow-key/route.ts`. With no key set it is a 404.

### 6. llms.txt and llms-full.txt

`/llms.txt` is a short guide for AI assistants: what ThabangVision is, how
booking works, commission, service area, categories with counts, the top 40
items with price a day and deposit, creators, the free tools with download
links, and the machine endpoints. `/llms-full.txt` is the whole catalogue in
markdown plus the FAQ and every public URL. Both are written from data and
constants (`lib/discovery/llms.ts`); the booking answers are the same text as
the FAQ page (`lib/content/faqs.ts`). Nothing is typed by hand.

### 7. Markdown twins

Add `.md` to a gear, gear category, creator, studio category, press, tools or
FAQ page address, for example `/rentals/cameras-optics/sony-a7iv.md`, and you
get plain markdown. `proxy.ts` rewrites `<page>.md` to the internal route
`/md/<page>` (`app/md/[...path]/route.ts`). One mechanism only: there is no
`Accept: text/markdown` switch, so an HTML page and its twin never share a
cache entry. Pages advertise their twin with
`<link rel="alternate" type="text/markdown">` (`buildPageMetadata({ markdown: true })`),
and the twin answers with `Link: <page>; rel="canonical"` so search engines
keep indexing the HTML page. `/md/` itself is disallowed in robots.txt.

### 8. Catalogue API (`/v1`)

Read only, JSON, no key, 60 requests a minute per IP, CDN cached five
minutes. Not under `/api/` (which robots.txt blocks).

- `GET /v1/rentals?q=&category=&city=&start=&end=&limit=&offset=`
- `GET /v1/rentals/{id or slug}`
- `GET /v1/creators?q=&category=&city=`
- `GET /v1/creators/{handle}`
- `GET /v1/categories`
- `GET /v1/tools`

Prices are rands (`*_zar`). With `start` and `end` the gear list keeps only
items free on those dates, using the same availability check as checkout (at
most 30 items checked per request). A city outside the area we deliver to
gets an empty list and a note saying so. Described by OpenAPI 3.1 at
`/openapi.json`.

### 9. MCP server (`/mcp`)

A read-only MCP server over Streamable HTTP (stateless, JSON responses),
built with the official TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.1).
Tools: `search_gear`, `get_gear`, `search_creators`, `get_creator`,
`list_categories`, `list_tools`, `how_to_book`. No sign in, no writes, no
personal data beyond public pages; every answer has the page URL so the
agent sends the person to the site to book. Server card at
`/.well-known/mcp.json`.

This follows `docs/ai/mcp-a2a-evaluation.md`: that note holds back an MCP
server acting for a signed-in user (bookings, OAuth, approvals). This server
does none of that, so it needs none of it. How to list it in directories:
`docs/discovery/mcp-listing.md`.

### 10. Product feeds

Not built, on purpose. Google Merchant Center and the ChatGPT merchant feed
are for goods people buy; renting is a service. Details:
`docs/discovery/feeds.md`.

## Adding a new kind of public page

1. Add its route to `SITEMAP_ROUTES` (or `NOT_IN_SITEMAP` with the reason) in
   `lib/seo/sitemap-registry.ts`. The #90 test fails until you do.
2. Add an entity to `DISCOVERY_ENTITIES` in `lib/discovery/registry.ts` that
   owns the route and lists its URLs from the catalogue. If the data is not
   in the catalogue yet, add it to `lib/discovery/catalog.ts`.
   `tests/unit/discovery-registry.test.ts` fails until you do.
3. Call `notifyDiscovery(...)` in the routes that publish, edit or remove it.
4. Optional: a markdown twin (`markdownTwin: true` and a case in
   `lib/discovery/markdown.ts`), API fields (`lib/discovery/api.ts` plus
   `lib/discovery/openapi.ts`) and an MCP tool (`lib/discovery/mcp.ts`).

It then shows up in the sitemap, llms-full.txt and the daily sweep without
anything else.

## Settings

| Variable | Needed | What it does |
| --- | --- | --- |
| `INDEXNOW_KEY` | Optional | 8 to 128 letters, digits or dashes. Unset: no IndexNow pings and no key file; everything else works. |

No other new settings.

## Owner checklist

1. Make an IndexNow key (for example 32 random hex characters) and set
   `INDEXNOW_KEY` in Vercel Production. Check
   `https://www.thabangvision.com/<key>.txt` shows it.
2. Google Search Console: add the `www.thabangvision.com` property (domain
   property is best) and submit `https://www.thabangvision.com/sitemap.xml`.
3. Bing Webmaster Tools: import from Search Console or add the site, and
   submit the same sitemap. Bing then reads the IndexNow pings.
4. Google Business Profile for the collection point (99 Smith Street,
   Braamfontein) with the website link; this is what wins "camera rental near
   me" in Johannesburg.
5. List the MCP server: follow `docs/discovery/mcp-listing.md`.
6. Approve or edit the proposed FAQ answers in `docs/discovery/feeds.md`
   (section "FAQ questions waiting for the owner").
