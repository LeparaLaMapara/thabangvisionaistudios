# ThabangVision AI Studios

AI-powered creative production and equipment rental platform for South African filmmakers and photographers.

**Stack:** Next.js 16 | React 19 | TypeScript 5 | Tailwind v4 | Supabase | Cloudinary | PayFast/Paystack | Vercel AI SDK
**Live:** [nonprodthabangvisionaistudios.vercel.app](https://nonprodthabangvisionaistudios.vercel.app)
**License:** Proprietary — Ubunye AI Ecosystems (Pty) Ltd, trading as Thabang Vision AI Studios

---

## Quick Start

```bash
npm install
cp .env.example .env.local   # Fill in Supabase, Cloudinary, payment keys
npm run dev                   # http://localhost:3000
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run test` | Vitest unit tests (39 tests) |
| `npm run test:e2e` | Playwright E2E tests (62+ tests) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | TypeScript type check |

---

## Project Structure

```
thabangvisionaistudios/
├── app/                          # Next.js App Router
│   ├── (marketing)/              # Public pages: home, contact, careers, press, legal, login, register
│   ├── (platform)/               # Product pages: smart-rentals, smart-production, ubunye-ai-studio,
│   │                             #   marketplace, pricing, dashboard, creators, book, onboarding
│   ├── (immersive)/              # Full-screen: ubunye-ai-studio (Three.js energy sphere)
│   ├── (admin)/                  # Auth-gated CMS: admin dashboard, content CRUD, bookings, verifications
│   ├── api/                      # API routes (all auth-gated where needed)
│   └── auth/callback/            # OAuth + magic link callback handler
│
├── lib/                          # Business logic & abstraction layers
│   ├── constants.ts              # STUDIO, PRODUCTION_SERVICES, ADMIN_EMAILS — single source of truth
│   ├── ai/                       # AI provider abstraction (Vercel AI SDK)
│   ├── auth/                     # Auth provider abstraction (Supabase)
│   ├── payments/                 # Payment provider abstraction (PayFast, Paystack)
│   ├── storage/                  # Storage provider abstraction (Cloudinary)
│   ├── email/                    # Email provider abstraction (Gmail/Nodemailer)
│   ├── search/                   # Search provider abstraction (Supabase)
│   ├── rag/                      # Vector search infrastructure (embeddings, indexer, retrieval)
│   ├── ubunye/                   # Ubunye AI system prompt builder + tool definitions
│   ├── ranking/                  # Gear marketplace ranking algorithm
│   ├── metadata/                 # EXIF extraction, fraud detection, SA ID validation
│   ├── supabase/                 # Supabase clients (server.ts, client.ts) + query modules
│   │   └── queries/              # smartProductions, smartRentals, careers, press, profiles,
│   │                             #   bookings, marketplace, orders, reviews, crew, service-bookings,
│   │                             #   verifications
│   └── migrations/               # SQL migrations (run manually in Supabase SQL Editor)
│
├── components/                   # React components
│   ├── ui/                       # 14 shared components (Button, Input, Card, Modal, Toast, Badge, etc.)
│   ├── booking/                  # BookingWidget (equipment rental date picker + price calc)
│   ├── admin/                    # AdminNav (mobile-responsive admin navigation)
│   └── dashboard/                # BankingDetails, ProfileForm, etc.
│
├── providers/                    # React context providers
│   └── AuthProvider.tsx          # Server→client auth state bridge (prevents auth flicker)
│
├── types/                        # TypeScript type definitions
│   ├── equipment.ts              # Equipment, Project, RentalProduct, NavItem
│   ├── booking.ts                # EquipmentBooking, BookingPayment, Invoice
│   ├── booking-system.ts         # Service booking types (Booking, BookingStatus, etc.)
│   └── marketplace.ts            # Listing, Order, Review, SubscriptionPlan
│
├── tests/
│   ├── unit/                     # Vitest: api.test.ts, constants.test.ts, payfast.test.ts
│   └── e2e/                      # Playwright: full-journey, auth, admin, booking, rentals, mobile
│
├── docs/                         # Documentation (architecture, security, design audits, test results)
├── tasks/                        # Task tracking (done/, todo/)
├── proxy.ts                      # Next.js 16 middleware (Supabase session refresh + CSRF)
├── CLAUDE.md                     # AI agent instructions (architecture rules, code style, "Do NOT" list)
└── .env.example                  # All required env vars (no values)
```

---

## Database Schema

All tables live in **Supabase** (PostgreSQL). The platform has 3 main domains: **content management**, **booking/payment**, and **user/marketplace**.

### Entity Relationship Diagram

```
                          ┌─────────────────────┐
                          │    auth.users        │  (Supabase Auth)
                          │    id, email         │
                          └──────────┬──────────┘
                                     │ 1:1
                          ┌──────────▼──────────┐
                          │     profiles         │  User profiles, skills, banking
                          │  id (FK auth.users)  │
                          └──┬───────┬───────┬──┘
                             │       │       │
            ┌────────────────┘       │       └────────────────┐
            │                        │                        │
   ┌────────▼────────┐    ┌─────────▼─────────┐   ┌─────────▼─────────┐
   │   bookings      │    │  crew_requests     │   │    listings       │
   │ (service)       │    │  (legacy crew)     │   │  (marketplace)    │
   │ client_id (FK)  │    │  creator_id (FK)   │   │  user_id (FK)     │
   │ creator_id (FK) │    │  client_email      │   └─────────┬─────────┘
   └─────────────────┘    └────────────────────┘             │
                                                    ┌────────▼────────┐
                                                    │     orders      │
                                                    │  buyer_id (FK)  │
                                                    │  seller_id (FK) │
                                                    └────────┬────────┘
                                                             │
                                                    ┌────────▼────────┐
                                                    │    reviews      │
                                                    │  reviewer_id    │
                                                    │  reviewee_id    │
                                                    └─────────────────┘

   ┌───────────────────┐    ┌───────────────────┐
   │  smart_rentals    │    │ smart_productions  │  Content (admin-managed)
   │  (equipment)      │    │  (portfolio)       │
   └────────┬──────────┘    └────────────────────┘
            │
   ┌────────▼──────────┐    ┌───────────────────┐    ┌───────────────────┐
   │ equipment_bookings│    │      press         │    │     careers       │
   │  user_id (FK)     │    │  (articles)        │    │  (job posts)      │
   │  rental_id (FK)   │    └───────────────────┘    └───────────────────┘
   └────────┬──────────┘
            │
   ┌────────▼──────────┐    ┌───────────────────┐
   │ booking_payments  │    │    invoices        │
   │  booking_id (FK)  │    │  booking_id (FK)   │
   └───────────────────┘    └───────────────────┘
```

### Table Details

#### User Domain

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `profiles` | id (FK auth.users), display_name, bio, avatar_url, skills[], social_links, location, phone, is_verified, available_for_hire, no_show_count | User profiles. Auto-created on registration via DB trigger (migration 006). |
| `banking_details` | id, user_id (FK), bank_name, account_number (encrypted), branch_code, account_holder, paystack_recipient_code | Creator payout info. Required before enabling "available for hire". |
| `verifications` | id, user_id (FK), id_front_path, id_back_path, selfie_with_id_path, status, fraud_flags, id_hash, exif_metadata | Identity verification with selfie+ID flow, EXIF fraud detection, SA ID validation. |
| `notifications` | id, user_id (FK), type, title, body, link, is_read | In-app notifications for booking events. |

#### Content Domain (Admin-Managed)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `smart_rentals` | id, slug, title, category, brand, price_per_day, price_per_week, deposit_amount, owner_type, owner_id, ranking_score, is_available | Equipment catalog. Studio-owned + community listings. |
| `smart_productions` | id, slug, title, project_type, video_url, gallery, is_published | Portfolio showcase. |
| `press` | id, slug, title, content, cover_url, author, category, is_published | Blog/press articles. |
| `careers` | id, title, department, location, employment_type, requirements, is_published | Job listings. |

#### Booking Domain

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `bookings` | id, reference, client_id (FK auth.users), creator_id (FK profiles), booking_type, subtotal/vat/total (ZAR cents), platform_amount, creator_amount, payment_status, payout_status, status | **Service bookings** (production, rental, crew). Client pays 100% upfront via Paystack. Platform holds funds, pays creator 85% on completion. |
| `crew_requests` | id, creator_id (FK), client_email, project_type, status, total_amount, commission_amount | Legacy crew booking system (being replaced by `bookings`). |
| `equipment_bookings` | id, user_id (FK), rental_id (FK smart_rentals), start_date, end_date, total_price, status | Equipment rental bookings with date-based availability. |
| `booking_payments` | id, booking_id (FK equipment_bookings), payfast_payment_id, amount, status | Payment records for equipment bookings. |
| `invoices` | id, booking_id (FK), invoice_number, amount, pdf_url, status | Invoice records. |

#### Marketplace Domain

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `listings` | id, user_id (FK), type (gear/service), title, price, pricing_model, category | User-created marketplace listings. |
| `orders` | id, buyer_id, seller_id, listing_id, total, platform_fee (10%), seller_payout, status | Marketplace transactions. |
| `reviews` | id, order_id, reviewer_id, reviewee_id, rating (1-5), comment | Post-order reviews. |
| `rental_reviews` | id, rental_id, reviewer_id, rating, comment | Equipment rental reviews (for ranking algorithm). |
| `subscription_plans` | id, name, price, interval, features | Subscription tiers (Starter/Pro/Studio). |
| `subscriptions` | id, user_id, plan_id, status, payfast_token | Active user subscriptions. |

### Migrations

All migrations are in `lib/migrations/` and must be run manually in the Supabase SQL Editor. They are numbered sequentially:

| # | File | Status | What It Does |
|---|------|--------|-------------|
| 001 | pgvector-gemini.sql | Pending | Enables pgvector extension, adds embedding columns |
| 001 | pgvector-openai.sql | Pending | Alternative: OpenAI embeddings (1536d instead of 768d) |
| 002 | unified-marketplace.sql | Pending | Adds owner_type, ranking_score to smart_rentals; creates rental_reviews |
| 003 | verification-columns.sql | Run | Initial verification columns on profiles |
| 004 | image-metadata.sql | Run | Image metadata columns |
| 005 | admin-roles.sql | Run | Admin role infrastructure |
| 006 | handle-new-user-trigger.sql | Run | Auto-creates profile row on user registration |
| 007 | crew-system.sql | Run | crew_requests table + creator columns on profiles |
| 008 | verification-redesign.sql | Run | Selfie+ID verification flow, fraud flags, id_hash |
| 009 | profile-name-address.sql | Run | Additional profile columns |
| 010 | notifications.sql | Run | Notifications table |
| 011 | crew-requests-payment.sql | Run | Payment columns on crew_requests |
| 012 | banking-details.sql | Run | banking_details table + crew_requests amount columns |
| 013 | expired-status.sql | **Pending** | Adds 'expired' status to crew_requests |
| 014 | booking-system.sql | **Pending** | Creates `bookings` table for service booking system |

---

## Money Flow

The platform handles money differently for each booking type:

### Service Bookings (Production/Crew) — `bookings` table

```
Client pays 100% upfront via Paystack checkout
        │
        ▼
Money sits in ThabangVision's Paystack merchant account (escrow)
        │
        ├── Creator accepts gig → works → marks complete
        │
        ▼
Admin triggers payout via Paystack Transfers API
        │
        ├── Creator gets 85% → sent to their bank account
        └── Platform keeps 15% → stays in Paystack balance
```

- All amounts stored in **ZAR cents** as integers (avoids floating point)
- VAT: 15% added to subtotal
- Paystack fees: ~2.9% + R1 per collection, ~R10 per transfer payout
- Commission: configurable in `STUDIO.booking.platformCommission` (default 15%)

### Equipment Rentals — `equipment_bookings` table

```
Client selects dates → PayFast checkout → equipment reserved
Deposit: 50% upfront (STUDIO.rental.depositPercent)
```

### Marketplace Orders — `orders` table

```
Buyer pays → 10% platform fee deducted → 90% to seller
```

---

## Authentication Flow

```
Registration → Supabase Auth creates user → DB trigger creates profile row
                                           → Redirect to /onboarding (display name, skills, phone)

Login → Email/password OR magic link (email OTP) OR Google OAuth
      → proxy.ts refreshes session cookie on every request
      → Layouts check auth.getUser() → redirect to /login if null

Admin → Same login flow → admin layout checks ADMIN_EMAILS in constants.ts
      → Non-admins redirected to /dashboard
```

**Key files:**
- `proxy.ts` — session refresh middleware (Next.js 16 convention: exports `proxy`, not `middleware`)
- `lib/auth/` — auth abstraction (requireAuth, requireAdmin, checkRateLimit, isSafeUrl)
- `providers/AuthProvider.tsx` — server→client auth bridge (prevents flash of unauthenticated content)
- `app/auth/callback/route.ts` — handles OAuth and magic link redirects

---

## Ubunye AI (Chat Assistant)

Ubunye is the platform's AI assistant, accessible at `/ubunye-ai-studio`.

**Architecture:**
- `lib/ubunye/system-prompt.ts` — builds context-aware prompt from live DB data (rentals, productions, rates) with 5-minute cache
- `lib/ubunye/tools.ts` — function calling tools: `search_equipment`, `get_equipment_details`, `search_creators`, `get_creator_detail`, `submit_creator_request`, `calculate_booking_quote`
- `POST /api/ubunye-chat` — streaming endpoint using `streamText()` from Vercel AI SDK
- Frontend uses `useChat()` from `@ai-sdk/react`

**Booking flow via Ubunye:**
1. Client describes project → Ubunye asks 8 structured questions (type, hours, deliverables, location, dates, creator preference)
2. `calculate_booking_quote` tool calculates pricing
3. Client is redirected to `/book?category=X&hours=Y&...` for Paystack payment

**Guest limits:** 5 free messages via sessionStorage counter, then login required.

**RAG (not yet active):** `lib/rag/` has embeddings, indexer, and retrieval ready. Activate by running migration 001 (pgvector) and setting `RAG_ENABLED=true`.

---

## API Routes

### Public
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/contact` | POST | Contact form (honeypot spam protection) |
| `/api/gemini` | POST | Non-streaming AI (guest-limited) |
| `/api/ubunye-chat` | POST | Streaming AI chat (guest-limited) |
| `/api/search` | GET | Global search (sanitized input) |

### Authenticated
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/bookings` | GET, POST | Equipment booking CRUD |
| `/api/bookings/[id]` | GET, PUT | Booking detail + status updates |
| `/api/rentals/[id]/availability` | GET | Date availability check |
| `/api/service-bookings` | GET, POST | Service booking list + create (Paystack checkout) |
| `/api/service-bookings/callback` | GET | Paystack redirect handler |
| `/api/service-bookings/[id]/status` | PATCH | Creator accept/decline, client complete/cancel |
| `/api/service-bookings/[id]/review` | POST | Client rates creator (1-5 stars) |
| `/api/marketplace` | GET, POST | Listing browse + create |
| `/api/marketplace/[id]` | GET, PUT, DELETE | Listing CRUD |
| `/api/marketplace/[id]/order` | POST | Place order |
| `/api/orders` | GET | User's orders |
| `/api/orders/[id]` | GET, PUT | Order detail + status |
| `/api/reviews` | GET, POST | Reviews |
| `/api/subscriptions/*` | Various | Plan listing, subscribe, cancel |
| `/api/cloudinary/sign` | POST | Signed upload params |
| `/api/banking` | GET, POST | Creator banking details |
| `/api/notifications` | GET | User notifications |
| `/api/verifications` | POST | Submit ID verification |

### Admin Only
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/service-bookings` | GET | All bookings |
| `/api/admin/service-bookings/[id]` | PATCH | Assign creator, cancel + refund, add notes |
| `/api/admin/service-bookings/[id]/payout` | POST | Trigger creator payout via Paystack Transfers |
| `/api/admin/verifications` | GET | All verification requests |
| `/api/admin/verifications/[id]` | GET, PUT | Review + approve/reject verification |
| `/api/admin/rentals` | GET, POST, PUT, DELETE | Equipment CRUD |
| `/api/admin/productions` | GET, POST, PUT, DELETE | Productions CRUD |
| `/api/admin/careers` | GET, POST, PUT, DELETE | Careers CRUD |
| `/api/admin/press` | GET, POST, PUT, DELETE | Press CRUD |
| `/api/admin/reindex` | POST | Rebuild RAG embeddings |
| `/api/admin/recalculate-rankings` | POST | Recalculate marketplace rankings |
| `/api/cloudinary/delete` | POST | Delete media asset |
| `/api/cloudinary/delete-folder` | POST | Delete all assets in folder |

### Webhooks
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/payfast` | POST | PayFast ITN (equipment bookings, subscriptions, service bookings, transfer events) |

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # For admin operations (createAdminClient)

# AI (pick one)
AI_PROVIDER=anthropic               # anthropic | gemini | openai
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=

# Storage
STORAGE_PROVIDER=cloudinary
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Payments — PayFast (equipment rentals, subscriptions)
PAYMENT_PROVIDER=payfast
NEXT_PUBLIC_PAYFAST_MERCHANT_ID=
NEXT_PUBLIC_PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
NEXT_PUBLIC_PAYFAST_SANDBOX=true

# Payments — Paystack (service bookings, creator payouts)
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=

# Email
EMAIL_PROVIDER=gmail
GMAIL_USER=
GMAIL_APP_PASSWORD=

# RAG (optional — requires pgvector migration)
RAG_ENABLED=false
EMBEDDING_PROVIDER=gemini

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Rendering Strategy

| Strategy | Routes |
|----------|--------|
| `force-dynamic` | dashboard/, admin/, ubunye-ai-studio/, pricing/, api/ |
| `revalidate = 60` | smart-rentals/, smart-production/, press/, careers/, contact, lab, home |
| Static | legal/, privacy/, login/, register/ |

No `generateStaticParams` anywhere.

---

## Design System

- **Dark theme only** — `#050505` background, `#D4A843` gold accent
- No light mode, no theme toggle
- Typography: `font-display` (headlines), `font-mono` (labels/data)
- Never use `bg-white`, `text-black`, `bg-gray-50`
- Mobile-first with 44px minimum touch targets
- Framer Motion for page transitions and hover effects

---

## Security

Full audit with 29 findings (all fixed): [`docs/security.md`](./docs/security.md)

Key protections:
- Admin auth via `requireAdmin()` + `ADMIN_EMAILS` allowlist
- Rate limiting on all sensitive endpoints (10 req/min AI, 5 req/min contact, 20 req/min uploads)
- CSRF protection via Origin header validation in proxy.ts
- PayFast: CIDR IP validation, timing-safe MD5 signatures, amount reconciliation
- Paystack: HMAC SHA-512 webhook validation
- Input sanitization: search queries, social links, file uploads
- Verification fraud detection: EXIF metadata, device consistency, GPS bounds, duplicate ID hashing

---

## What's Built (as of 2026-03-19)

| Phase | Scope | Status |
|-------|-------|--------|
| V1 — Foundation | 30+ pages, admin panel, equipment catalog, Ubunye basic chat | Complete |
| V2 — Architecture | Security hardening, provider abstractions (6 layers), dark mode lock, mobile rebuild | Complete (16 tasks) |
| V3 — Intelligence | Context-aware Ubunye, RAG infrastructure, smart productions redesign, unified gear marketplace | Complete (17 tasks) |
| V4 — Booking System | Service bookings with Paystack, creator payouts, Ubunye booking flow, verification redesign | Complete |
| Auth Improvements | Registration trigger, magic link, Google OAuth, onboarding, auth flicker fix | Complete |

**Test results:** 0 TS errors, 39/39 unit tests, 62 E2E tests pass (4 flaky on retry)

---

## What Needs Work

### Pending Migrations (Run in Supabase SQL Editor)
- `013-expired-status.sql` — adds 'expired' status to crew_requests
- `014-booking-system.sql` — creates `bookings` table for service booking system
- `001-pgvector-gemini.sql` — enables RAG (when ready)
- `002-unified-marketplace.sql` — marketplace ranking columns

### Not Yet Implemented
- **RAG** — infrastructure ready in `lib/rag/`, needs pgvector migration + `RAG_ENABLED=true`
- **Auto-cancel unpaid bookings** — 24hr timeout for pending service bookings
- **Client cancellation refund policy** — 48hr window with partial refund
- **No-show tracking** — increment `no_show_count`, disable after 3
- **Auto-complete** — query exists but not wired into lazy pattern (30 days)
- **Dispute handling** — status exists but no admin UI
- **Instant invoices** — PDF generation for client and creator
- **WhatsApp notifications** — `TASK-044` in tasks/todo (gateway abstraction designed)
- **Creator availability calendar** — date blocking for creators

### Potential Upgrades
- In-memory rate limiting → Redis-backed (for multi-instance deployments)
- Supabase Storage or S3 stub implementations → production-ready
- Paystack webhook URL is separate from PayFast webhook → could be unified
- Equipment booking system uses PayFast; service bookings use Paystack — consider standardizing

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [`CLAUDE.md`](./CLAUDE.md) | AI agent instructions: architecture rules, code style, "Do NOT" list |
| [`docs/architecture.md`](./docs/architecture.md) | Provider abstraction layers: AI, auth, payments, storage, email, search |
| [`docs/security.md`](./docs/security.md) | Security audit: 29 findings (all fixed), auth module documentation |
| [`docs/design-v1-audit.md`](./docs/design-v1-audit.md) | Original design audit (2026-03-09) — baseline scores |
| [`docs/design-v2-audit.md`](./docs/design-v2-audit.md) | Post-fix re-audit with 5-dimension scoring |
| [`docs/test-results.md`](./docs/test-results.md) | Test snapshot: 97 tests (25 API + 72 E2E) |
| [`tasks/`](./tasks/) | Task tracking: `done/` (25 completed), `todo/` (8 remaining) |
