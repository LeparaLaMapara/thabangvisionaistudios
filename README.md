# ThabangVision AI Studios

AI-powered creative production and equipment rental platform for South African filmmakers and photographers.

**Stack:** Next.js 16 | React 19 | TypeScript 5 | Tailwind v4 | Supabase | Cloudinary | PayFast | Anthropic Claude

**Live:** [nonprodthabangvisionaistudios.vercel.app](https://nonprodthabangvisionaistudios.vercel.app)

---

## Quick Start

```bash
npm install
cp .env.example .env.local   # Fill in Supabase, Cloudinary, PayFast keys
npm run dev                   # http://localhost:3000
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest unit tests (39 tests) |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run lint` | ESLint |

---

## Architecture

### Provider Abstraction

All external services go through abstraction layers in `lib/`. Env vars select the active provider — swap providers without touching application code.

| Layer | Providers | Env Var |
|-------|-----------|---------|
| `lib/ai/` | Anthropic, Gemini, OpenAI | `AI_PROVIDER=anthropic` |
| `lib/payments/` | PayFast, Paystack | `PAYMENT_PROVIDER=payfast` |
| `lib/storage/` | Cloudinary, S3 | `STORAGE_PROVIDER=cloudinary` |
| `lib/email/` | Gmail/Nodemailer, Resend | `EMAIL_PROVIDER=gmail` |
| `lib/search/` | Supabase, Algolia | `SEARCH_PROVIDER=supabase` |
| `lib/rag/embeddings/` | Gemini (free, 768d), OpenAI (paid, 1536d) | `EMBEDDING_PROVIDER=gemini` |

### Single Source of Truth

- All business info: `lib/constants.ts` (`STUDIO`, `PRODUCTION_SERVICES`, `ADMIN_EMAILS`)
- Equipment pricing: Supabase `smart_rentals` table
- Production rates: `PRODUCTION_SERVICES` constants
- No hardcoded prices, emails, phone numbers, or URLs outside `constants.ts`

### Authentication

- Supabase Auth with `@supabase/ssr` cookie-based sessions
- `proxy.ts` (Next.js 16 convention) refreshes sessions on every request
- Admin access: `ADMIN_EMAILS` allowlist + `requireAdmin()` helper
- All API routes auth-gated with proper status codes (401/403/429)

### Theming

- Dark theme only: `#050505` background, `#D4A843` gold accent
- No light mode, no theme toggle

---

## Route Groups

| Group | Purpose | Examples |
|-------|---------|---------|
| `(marketing)` | Public pages | Home, Contact, Careers, Press, Legal |
| `(platform)` | Product pages | Smart Rentals, Smart Production, Ubunye AI, Dashboard, Marketplace |
| `(immersive)` | Full-screen experiences | Ubunye AI Studio |
| `(admin)` | Auth-gated CMS | Admin dashboard, Content CRUD |

---

## V2 Changelog — Architecture (TASK-001 to TASK-016)

### Session 1: Security Hardening (TASK-001 to TASK-007)

- **TASK-001:** Verified `proxy.ts` correct for Next.js 16 (exports `proxy`, matcher covers all protected routes)
- **TASK-002:** Created `lib/auth/admin.ts` with `requireAdmin()` helper; all `/api/admin/*` routes guarded
- **TASK-003:** Admin layout checks `ADMIN_EMAILS`; non-admins redirected to `/dashboard`
- **TASK-004:** Cloudinary sign requires auth, delete/delete-folder require admin
- **TASK-005:** Gemini/Ubunye chat route: auth + rate limiting (10 req/min, 429 on exceed)
- **TASK-006:** Search input sanitized — PostgREST special chars stripped before `ilike` queries
- **TASK-007:** `isSafeUrl()` blocks `javascript:`/`data:` protocols on social links

Full audit: 29 findings fixed (4 Critical, 10 High, 9 Medium, 6 Low). See [SECURITY.md](./SECURITY.md).

### Session 2: AI Abstraction Layer (TASK-008)

- **TASK-008:** `AIProvider` interface with `sendMessage()` + `streamMessage()` for Anthropic, Gemini, OpenAI. Provider selected via `AI_PROVIDER` env var.

### Session 3: Provider Abstractions (TASK-009 to TASK-012)

- **TASK-009:** Payments — `lib/payments/` with PayFast + Paystack stub
- **TASK-010:** Storage — `lib/storage/` with Cloudinary + S3 stub
- **TASK-011:** Email — `lib/email/` with Gmail/Nodemailer provider
- **TASK-012:** Search — `lib/search/` with Supabase provider, route delegates to `search.search()`

### Session 4: UI Fixes (TASK-013 to TASK-016)

- **TASK-013:** Mobile nav rebuild — gold CTA, auth-aware, 44px touch targets
- **TASK-014:** Dark mode locked via `forcedTheme="dark"`
- **TASK-015:** Font optimization via `next/font/google` (Inter, Space Grotesk, Space Mono, Orbitron)
- **TASK-016:** Touch target compliance (min-h-[44px]) on all mobile interactive elements

---

## V3 Changelog — Intelligence (TASK-017 to TASK-033)

### Session 5: Ubunye Intelligence (TASK-017 to TASK-020)

- **TASK-017:** System prompt builder (`lib/ubunye/system-prompt.ts`) — extracts platform data with 5-min cache, fresh user context, zero hardcoded values
- **TASK-018:** SSE streaming via `ai.streamMessage()` at `/api/ubunye-chat`, client consumes with `ReadableStream.getReader()`
- **TASK-019:** Markdown rendering — react-markdown with gold links, code blocks, tables
- **TASK-020:** Guest message limits — 5 free messages via `sessionStorage`, counter UI, auth prompts

### Session 6: RAG Vector Database (TASK-021 to TASK-025)

- **TASK-021:** Embedding abstraction — `EmbeddingProvider` interface, Gemini (768d, free) + OpenAI (1536d, paid)
- **TASK-022:** Content indexer — `buildContentString()` for rental/production/press/career, upsert to `content_embeddings`
- **TASK-023:** Retrieval — `searchSimilar()` via `match_content` RPC, `formatRetrievalContext()` for prompts
- **TASK-024:** Admin reindex endpoint — POST `/api/admin/reindex`, admin-only, gated by `RAG_ENABLED`
- **TASK-025:** Auto-index hooks on admin CRUD routes (rentals, productions, press, careers)

> **Prereq:** Run `lib/migrations/001-pgvector-gemini.sql` (or openai variant), set `RAG_ENABLED=true`

### Session 7: Smart Productions Marketplace (TASK-026 to TASK-029)

- **TASK-026:** Layout overhaul — hero with 3 CTAs, Photography Division (7 categories), Film & Video Division (7 categories)
- **TASK-027:** Package pricing component — 6 packages from `PRODUCTION_SERVICES` constants, "Popular" highlight
- **TASK-028:** Production brief form — posts to `/api/contact` with honeypot, phone field support
- **TASK-029:** Gear cross-sell — featured rentals horizontal scroll, fetched in parallel

### Session 8: Unified Gear Marketplace (TASK-030 to TASK-033)

- **TASK-030:** SQL migration — adds `owner_type`, `owner_id`, `ranking_score`, review fields to `smart_rentals`; creates `rental_reviews` table
- **TASK-031:** Ranking algorithm — `calculateRankingScore()` (+100 studio, +50 verified, +20 per 5-star, +15 available, +30 featured, +5 complete profile); admin recalculate endpoint
- **TASK-032:** Unified display — STUDIO/VERIFIED/FEATURED badges, 4 sort options, category detail pages with item counts
- **TASK-033:** Creator listing flow — verified users insert into `smart_rentals` with `owner_type='community'`, ownership-gated CRUD

> **Prereq:** Run `lib/migrations/002-unified-marketplace.sql` in Supabase

---

## Task Status

| Phase | Tasks | Status |
|-------|-------|--------|
| V2 — Architecture | TASK-001 to TASK-016 | 16/16 complete |
| V3 — Intelligence | TASK-017 to TASK-033 | 17/17 complete |
| V4 — Actions | TASK-034 to TASK-045 | Planned |
| V5 — Platform | TASK-046 to TASK-050 | Planned |

**Total: 33/33 V2+V3 tasks complete. Build passes. 39/39 tests pass.**

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# AI (pick one)
AI_PROVIDER=anthropic          # anthropic | gemini | openai
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=

# Storage
STORAGE_PROVIDER=cloudinary
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Payments
PAYMENT_PROVIDER=payfast
NEXT_PUBLIC_PAYFAST_MERCHANT_ID=
NEXT_PUBLIC_PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
NEXT_PUBLIC_PAYFAST_SANDBOX=true

# Email
EMAIL_PROVIDER=gmail
GMAIL_USER=
GMAIL_APP_PASSWORD=

# RAG (optional)
RAG_ENABLED=false
EMBEDDING_PROVIDER=gemini

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Security

Full security audit with 29 findings (all fixed): [SECURITY.md](./SECURITY.md)

Key protections:
- Admin route auth via `requireAdmin()` + `ADMIN_EMAILS` allowlist
- Rate limiting on all sensitive endpoints (contact, AI, bookings, uploads)
- CSRF protection via Origin header validation
- PayFast: CIDR IP validation, timing-safe signatures, amount reconciliation
- Input sanitization: search queries, social links, file uploads
- Security headers: X-Frame-Options, HSTS, X-Content-Type-Options

---

## License

Proprietary. Copyright 2026 Ubunye AI Ecosystems (Pty) Ltd, trading as Thabang Vision AI Studios.
