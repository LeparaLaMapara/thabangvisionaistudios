# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AI-powered creative production and equipment rental platform for South African filmmakers and photographers.
Built by ThabangVision (Pty) Ltd, trading as ThabangVision Labs.

**Stack:** Next.js 16, React 19, TypeScript 5, Tailwind v4, Supabase, Cloudinary, Paystack (active) / PayFast (supported), Anthropic Claude
**Repo:** https://github.com/LeparaLaMapara/thabangvision
**Live:** https://nonprodthabangvisionaistudios.vercel.app
**Supabase:** https://zbdsqvpxpsygbuqnuekm.supabase.co

## Architecture Rules

### Single Source of Truth
- ALL business info comes from `lib/constants.ts` (STUDIO, PRODUCTION_SERVICES)
- Never hardcode prices, phone numbers, emails, URLs, or business terms in any file
- If a value might change, it lives in constants.ts or Supabase — nowhere else

### Provider Abstraction
- ALL provider calls go through abstraction layers in `lib/` — never import SDKs directly in pages or API routes
- `lib/ai/` → AI providers (Anthropic, Gemini, OpenAI)
- `lib/payments/` → Payment providers (PayFast, Paystack)
- `lib/storage/` → Storage providers (Cloudinary, S3)
- `lib/email/` → Email providers (Gmail/Nodemailer, Resend)
- `lib/search/` → Search providers (Supabase, Algolia)
- Env vars control which provider is active:
  - `AI_PROVIDER=anthropic`
  - `PAYMENT_PROVIDER=paystack` (currently active; `payfast` is also supported by the abstraction)
  - `STORAGE_PROVIDER=cloudinary`
  - `EMAIL_PROVIDER=gmail`
  - `SEARCH_PROVIDER=supabase`
  - `RAG_ENABLED=false`

### AI Cost Tracking (`trackedCompletion`)
- NEVER call `generateText`, `streamText`, or provider SDKs directly from a route or tool. Wrap every AI call with `trackedCompletion()` from `lib/ai/tracked.ts`.
- For streaming (`streamText`), use `logTokenUsage()` inside the `onFinish` callback instead.
- `trackedCompletion()` captures `{ agentId, provider, model, userId }` plus token usage and writes one row per call to `ai_token_usage` (cost accounting). Per-user daily message caps still live in `ubunye_usage`.
- Agents are registered in `lib/agents/registry.ts`. Current roster:
  - `assistant` — Ubunye chat (`claude-sonnet-4-20250514`)
  - `booking` — booking-flow tool agent (`claude-sonnet-4-20250514`)
  - `bio-writer` — auto-bio from portfolio + profile (`claude-sonnet-4-20250514`)
  - `listing-describer` — draft rental listing title/description/includes (`claude-sonnet-4-20250514`)
  - `onboarding`, `portfolios` — vision/tagging helpers (`gemma-4-31b-it`, free tier)
  - `rates` — market-aligned rate suggestions (`claude-sonnet-4-20250514`)
- Model pricing: `lib/ai/pricing.ts`. When adding a new model, add its cost there too so budget alerts work.
- **Agent routing** (`lib/agents/router.ts`): intent classification picks the agent — priority is booking > portfolios > rates > assistant. The booking agent has a pre-selected creator flow (from portfolio page "Book Creator" button) that skips creator search.
- **Per-agent rate limits**: each agent defines `rateLimit: { guest, free, pro, studio }` (messages/day). `-1` = unlimited. Guest users get 5 assistant messages, 0 booking messages. Tracked in `ubunye_usage` table.
- **Booking flow** is a strict 3-step script: (1) collect location/date/duration, (2) call `calculate_booking_quote` tool and show ZAR breakdown, (3) confirm and return payment link. Never estimate prices — always use the tool.
- **System prompt caching**: platform data (equipment, productions, crew) is fetched once and cached in-memory for 5 minutes, keyed by feature flags. Authenticated users get their profile + active bookings + listings injected into context.

### Feature Flags
- Flags stored in `feature_flags` Supabase table, cached in-memory for 60 seconds via `unstable_cache`
- `lib/features.ts` provides `getFlags()` — async, returns `{ smart_productions: boolean, ... }`
- Navigation gating: `lib/nav.ts` filters nav items by flag state (e.g., `/smart-production` routes gated by `smart_productions` flag)
- Admin UI at `/admin/flags` for toggling flags
- System prompt cache is keyed by flag values — flag changes automatically refresh AI context

### AI Model Routing (Fast vs. Smart)
- `lib/ai/index.ts` implements intelligent routing: simple queries (greetings, contact info) go to Gemini Flash (cheap), complex queries (booking, reasoning) go to Claude Sonnet
- Routing only activates when `AI_PROVIDER=anthropic` AND `GOOGLE_GENERATIVE_AI_API_KEY` is set
- Pattern matching in `SIMPLE_PATTERNS` and `COMPLEX_PATTERNS` determines tier
- AI pricing in `lib/constants.ts` (`STUDIO.ai.pricing`) uses assumed ~R18/USD exchange rate — update manually when rates shift
- **Two Google AI env vars**: `GOOGLE_GENERATIVE_AI_API_KEY` is read by `@ai-sdk/google` (model routing in `lib/ai/index.ts`). `GEMINI_API_KEY` is read by `@google/generative-ai` (vision/portfolio tools, RAG embeddings). Both need the same API key.

### Authentication & Authorization
- Admin access has 3-level fallback: (1) JWT `app_metadata.role === 'admin'`, (2) `profiles.role` column, (3) `ADMIN_EMAILS` array in `lib/constants.ts`
- All `/api/admin/*` routes: check session AND check admin status via `requireAdmin()`
- All `/dashboard/*` routes: check session via proxy
- Ubunye chat: requires login (unauthenticated get 5 free messages via guest rate limit)
- Cloudinary delete: admin only. Cloudinary sign: authenticated users only.
- Idle session timeout: auto-logout after `STUDIO.session.idleTimeoutMinutes` (30 min) of inactivity, tracked in `providers/AuthProvider.tsx`

### Theming
- Dark theme ONLY — no light mode, no theme toggle, no "Switch to Light Mode"
- Background: #050505, accent: #D4A843 (warm gold)
- Typography: `font-display` for headlines, `font-mono` for labels/data
- Animations: Framer Motion for page transitions and hover effects
- Mobile-first with 44px minimum touch targets
- Never use bg-white, text-black, bg-gray-50 in any component

### Route Groups
The `app/` directory uses four Next.js route groups:
- `(marketing)` — public pages: home, about, contact, careers, press, auth flows (login, register, reset-password), legal, privacy
- `(platform)` — product pages: smart-production, smart-rentals, ubunye-ai-studio, catalog, resources. Public Header/Footer, but separate group for future layout divergence
- `(admin)` — admin dashboard (`/admin/*`). Layout guards: redirects unauthenticated → `/login`, non-admin → `/dashboard`
- `(immersive)` — standalone immersive experiences (Ubunye AI studio)
- Root-level `api/` — all API routes
- Root-level `auth/` — Supabase OAuth callback

### Rendering Strategy
- `force-dynamic`: dashboard/, admin/, ubunye-ai-studio/, pricing/, api/ routes
- `revalidate = 60`: smart-rentals/, smart-production/, press/, careers/, contact, lab, home
- Static: legal/, privacy/, login/, register/
- No generateStaticParams anywhere

## File Ownership & Structure

```
lib/
├── constants.ts   # STUDIO, PRODUCTION_SERVICES, ADMIN_EMAILS — single source of truth
├── features.ts    # getFlags() — feature flag reader with 60s cache
├── nav.ts         # filterNavForFlags() — nav items gated by feature flags
├── agents/        # Agent framework: registry, router, runtime, tools, agents/*
├── ai/            # AI provider abstraction (Vercel AI SDK) — getModel() by AI_PROVIDER
├── auth/          # requireAuth, requireAdmin, rate limiting, URL safety
├── cart/          # Cart state helpers
├── cloudinary/    # Cloudinary server helpers (signing, deletion)
├── cron/          # Scheduled job logic (invoked via Vercel cron)
├── data/          # Shared data fetchers / aggregations
├── email/         # Email provider abstraction (Gmail/Nodemailer)
├── metadata/      # EXIF extraction, SA ID validation, fraud detection
├── migrations/    # SQL migrations (run MANUALLY in Supabase SQL Editor)
├── payments/      # Payment abstraction — paystack.ts (active), payfast.ts, payout.ts
├── pdf/           # PDF generation (invoices, quotes)
├── portfolio/     # Portfolio / showcase helpers
├── productions/   # Smart productions domain logic
├── rag/           # Vector search (embeddings, indexer, retrieval) — gated by RAG_ENABLED
├── ranking/       # Gear marketplace ranking algorithm
├── search/        # Search provider abstraction
├── storage/       # Storage provider abstraction (Cloudinary)
├── supabase/      # client.ts, server.ts, queries/* per domain
├── ubunye/        # Ubunye AI system prompt + tool definitions
└── whatsapp/      # WhatsApp gateway abstraction (not yet active)

types/             # Domain type definitions
├── booking-system.ts  # Comprehensive booking types (service + equipment)
├── cart.ts            # Shopping cart types
├── equipment.ts       # Rental equipment types
├── marketplace.ts     # Marketplace listing types
├── order.ts           # Order types
├── portfolio.ts       # Creator portfolio types
└── production.ts      # Production service types
```

### Supabase Query Modules
Database access is organized by domain in `lib/supabase/queries/`:
- `banking.ts`, `bookings.ts`, `cart.ts`, `crew.ts`, `marketplace.ts`, `notifications.ts`, `profiles.ts`, `service-bookings.ts`, `smartProductions.ts`, `smartRentals.ts`, `verifications.ts`, `creatorReviews.ts`, `productionCategories.ts`, `careers.ts`, `press.ts`
- Import queries from these modules — don't write raw Supabase queries in API routes or components

## Code Style

### TypeScript
- Strict mode
- Explicit types on function params and returns
- No `any` unless unavoidable — use `unknown` and narrow

### Imports
- Use `@/` path alias for all project imports
- Never import provider SDKs directly in pages — always through `lib/` abstraction
- Example: `import { ai } from '@/lib/ai'` NOT `import Anthropic from '@anthropic-ai/sdk'`

### API Routes
- Every route: check auth where needed, validate input, handle errors with try/catch
- Admin routes: check session + check ADMIN_EMAILS
- Return proper status codes: 200, 201, 400, 401, 403, 404, 429, 500
- Never expose stack traces to client in production

### Pricing & Booking Types
- All prices in ZAR
- Booking amounts (bookings, booking_payments) stored as integer **ZAR cents** to avoid floating-point drift
- **Two distinct booking types:**
  - **Service bookings** (`bookings` table): time-based production services (photography, video). Handles creator payouts via Paystack Transfers API.
  - **Equipment bookings** (`equipment_bookings` table): date-based rental of gear from `smart_rentals`. Simpler payment flow.
- Production rates come from PRODUCTION_SERVICES in constants.ts
- Equipment rates come from Supabase smart_rentals table
- VAT: PRODUCTION_SERVICES.billing.vatRate (currently 15%)
- Deposit: STUDIO.rental.depositPercent (currently 50%)
- Active payment provider: **Paystack** (checkout + creator payouts via Transfers API). PayFast code is kept in `lib/payments/payfast.ts` as a switchable alternative — do not wire new flows to it without instruction.

## CI Pipeline
- GitHub Actions (`.github/workflows/ci.yml`) runs on push to `main` and PRs to `main`
- Pipeline: `npm ci` → `npx tsc --noEmit` → `npm run build` → `npm run test`
- Separate security-checks job: scans for hardcoded secrets, hardcoded business values in app/, and direct SDK imports in app/
- CI uses `PAYMENT_PROVIDER=payfast` for build validation — this differs from the active production provider (Paystack)

## Branch Strategy
- `main` — production, auto-deploys to Vercel
- `develop` — integration branch, auto-deploys to Vercel Preview (uses dev Supabase)
- `feature/*` — branch from develop, merge back via PR
- `hotfix/*` — branch from main for urgent fixes
- Always merge to main only after build + tests pass

## Commands
- `npm run dev` — Next.js dev server on localhost:3000
- `npm run build` — production build (type + import errors surface here)
- `npm run lint` — ESLint
- `npx tsc --noEmit` — TypeScript type check without emit
- `npm run test` — vitest unit tests
- `npm run test:watch` — vitest in watch mode
- `npm run test:e2e` — Playwright E2E tests (builds prod first, runs against `localhost:3000`)
- `npm run test:e2e:ui` — Playwright with UI inspector
- Single unit test: `npx vitest run <path> -t "<test name>"`
- Single E2E test: `npx playwright test <path> -g "<name>"`
- `npm run build`, `npm run test`, and `npm run test:e2e` must all pass before merging to main.
- Unit tests live in `tests/unit/*.test.ts` (jsdom env, `@` alias works, vitest globals enabled)
- E2E tests live in `tests/e2e/*.spec.ts` (Playwright, 60s timeout)
- E2E runs two projects: `chromium` (desktop) and `mobile` (iPhone 14 emulation, 393×852). Mobile tests live in `mobile.spec.ts` — all other specs run desktop only.
- Test setup: `tests/setup.ts` (auto-loaded by vitest)

## Platform Conventions
- **Proxy, not middleware** — Next.js 16 uses `proxy.ts` at repo root and exports a function named `proxy` (not `middleware`). It handles Supabase session refresh + CSRF Origin validation.
- **Pending migrations are manual** — migrations live in `lib/migrations/` (001–031). Applied by hand in the Supabase SQL Editor. Before assuming a table exists, check `docs/tasks/` or the README migration table.
- **Supabase clients** — three patterns:
  - `@/lib/supabase/server` (`createClient()`) — async, cookie-based. For Server Components and API routes. Cookies are async in Next.js 16 (`await cookies()`).
  - `@/lib/supabase/client` (`createClient()`) — `createBrowserClient`. For `'use client'` components.
  - `createAdminClient()` — service role, bypasses RLS. Only for admin operations.
- **Auth bridge** — `providers/AuthProvider.tsx` bridges server-resolved session to the client to prevent auth flicker; don't replace it with client-only auth state.
- **Image optimization** — Next.js `<Image>` uses a custom Cloudinary loader (`lib/cloudinary/loader.ts`) for on-the-fly resize/format conversion.
- **In-memory rate limiter** (`lib/auth/index.ts`) — `checkRateLimit(key, maxRequests, windowMs)` for contact forms, onboarding, etc. Does NOT persist across restarts — Vercel cold starts reset it.
- **Security headers** — `next.config.ts` sets CSP, HSTS, X-Frame-Options, etc. When adding a new external service, update the CSP `connect-src` (API calls), `img-src` (images), or `frame-src` (iframes) directives there.
- **Environment setup** — copy `.env.example` to `.env.local` and fill in real values. See `.env.example` for all provider-specific variables grouped by service.

## Documentation
- `README.md` — authoritative reference: full DB schema, money flow diagrams, API route inventory, env var list, migration status
- `docs/processes/` — business process design docs (client payment, creator payout, data engine, AI architecture, smart productions, ubunye agents)
- `docs/tasks/done/` + `docs/tasks/todo/` — task tracking
- `docs/design/` — historical design audits
- `docs/architecture.md` — provider abstraction layers
- `docs/security.md` — security audit (29 findings, all fixed)
- `docs/strategy.md` — company vision, revenue model, platform roadmap

## Agent Teams

Use parallel agent teams when a task is large enough to benefit from concurrent work. Three teams are defined:

### Team: research
**When:** Any task that references a process doc or needs database/codebase context before coding.
**What:** Front-load all context gathering in parallel so coding starts immediately.
```
Spawn agents to read in parallel:
  - Relevant docs/processes/ files
  - Supabase table schemas (via MCP)
  - Existing code patterns in lib/ and app/
  - Related type definitions in types/
Return: summarized context to coordinator
```

### Team: build
**When:** A task touches 3+ independent file groups (e.g. API routes + frontend components + lib utilities).
**What:** Split work across isolated worktrees so agents code in parallel without conflicts.
```
Agent "api" (worktree):     API routes in app/api/
Agent "frontend" (worktree): Page components in app/
Agent "infra" (worktree):    Shared lib code, types, cron jobs, email templates
Coordinator:                 Merge worktrees, resolve conflicts, final integration
```
Each agent follows all CLAUDE.md rules independently. Each worktree must pass `npm run build` before merge.

### Team: qa
**When:** Every coding task. Run in background alongside build work.
**What:** Continuous quality checks that catch issues while code is still being written.
```
Background checks (run after each file change):
  - npm run build (type errors, import errors)
  - npm run test (regression)
  - /check-constants (no hardcoded business values)
  - /verify-abstractions (no direct SDK imports)
  - /security-check (no auth bypasses, no exposed secrets)
Report: flag issues immediately so the coding agent can fix inline
```

### Routing Rules
```
Task size < 3 files         → work solo (no teams)
Task size 3-6 files         → research + qa teams
Task size 7+ files          → research + build + qa teams
Task references process doc → always spawn research team
/pre-merge                  → qa team runs all checks in parallel
```

## Do NOT
- Modify files outside the scope of the current task
- Refactor working code that isn't part of the current task
- Add light mode or theme toggles
- Hardcode prices, emails, phone numbers, or URLs
- Import provider SDKs directly in pages (use lib/ abstraction)
- Remove or modify existing passing tests
- Change ADMIN_EMAILS without explicit instruction
- Expose user data to other users
- Include bank details in AI prompts
- Use `localStorage` or `sessionStorage` for auth (use Supabase session)
