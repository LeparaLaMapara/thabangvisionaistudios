# Phase 1 — System Discovery

## A. System Inventory

### A1. Routes

| Group | Pages | Dynamic | Rendering |
|-------|-------|---------|-----------|
| (marketing) | 15 | 2 (`/press/[slug]`, `/faq`) | Static or `revalidate=60` |
| (platform) | 38 | 18 (dashboard, rentals, studio, creators) | `force-dynamic` for dashboard; `revalidate=60` for catalog |
| (admin) | 17 | 3 (`disputes/[id]`, `rentals/[id]`, `verifications`) | All `force-dynamic` |
| (immersive) | 1 | 0 | `force-dynamic` |
| **Total pages** | **71** | | |

**API routes: 96 total**

| Category | Count | Auth pattern |
|----------|-------|-------------|
| `/api/admin/*` | 30 | `requireAdmin()` |
| `/api/agents/*` | 8 | Session required |
| `/api/cron/*` | 4 | `CRON_SECRET` bearer |
| `/api/webhooks/*` | 3 | Provider signature validation |
| User-facing | 51 | Mixed (session required for mutations, some public GETs) |

**Special routes:** `/feed.xml` (RSS), `/llms.txt` (AI manifest), `/auth/callback`, `/api/og` (dynamic OG images)

**Proxy:** `proxy.ts` — CSRF origin validation + Supabase session refresh on every request.

---

### A2. Supabase Tables (35 total)

**Active tables (>0 rows):**

| Table | Rows | Foreign Keys | Purpose |
|-------|------|-------------|---------|
| `ai_token_usage` | 94 | → profiles | AI cost tracking per call |
| `smart_rentals` | 28 | → profiles (owner) | Equipment rental listings |
| `portfolio_analysis` | 9 | → profiles | AI portfolio tagging |
| `equipment_bookings` | 7 | → profiles, smart_rentals | Equipment rental bookings |
| `booking_payments` | 7 | → equipment_bookings | Payment records for equipment |
| `production_categories` | 6 | — | Studio category taxonomy |
| `feature_flags` | 6 | — | Runtime feature toggles |
| `smart_productions` | 3 | → production_categories | Portfolio/project showcases |
| `careers` | 3 | — | Job listings |
| `bookings` | 2 | → profiles (creator) | Service bookings (photography etc.) |
| `press` | 2 | — | Press/blog articles |
| `profiles` | 1 | self-ref (suspended_by) | User profiles (hub table) |
| `onboarding_progress` | 1 | → profiles | Creator onboarding state |
| `listings` | 1 | → profiles | Marketplace listings |
| `banking_details` | 1 | → profiles | Creator bank info for payouts |

**Empty tables (0 rows):**

| Table | Has Code References | Verdict |
|-------|-------------------|---------|
| `chat_conversations` | YES (active — agent runtime, chat history) | Active, just no production conversations yet |
| `chat_messages` | YES (active — agent runtime) | Active |
| `chat_faqs` | YES (new — Sprint 4) | Active, just deployed |
| `notifications` | YES (active — cron jobs, webhooks) | Active |
| `cart_items` | YES (active — cart system) | Active |
| `reviews` | YES (active — review system) | Active |
| `disputes` | YES (active — dispute system) | Active |
| `dispute_comments` | YES | Active |
| `orders` | YES (marketplace orders) | Active |
| `invoices` | YES (admin equipment booking flow) | Active |
| `bug_reports` | YES (support flow) | Active |
| `crew_requests` | YES (creator request system) | Active |
| `moderation_log` | YES (admin user management) | Active |
| `platform_events` | YES (event logging) | Active |
| `content_embeddings` | YES (RAG system, gated by `RAG_ENABLED=false`) | Dormant — RAG disabled |
| `subscription_plans` | YES (subscription system) | Built but unused — 0 plans seeded |
| `subscriptions` | YES | Built but unused |
| `feature_flag_events` | YES (flag change audit log) | Active, just no changes logged |
| `portfolio_tag_corrections` | YES (tag correction flow) | Active |
| `ai_budget_alerts` | YES (cron budget checks) | Active, no alerts triggered yet |

**MISSING TABLE:** `ubunye_usage` — Referenced by 5 files (`lib/agents/runtime.ts`, `app/api/agents/rates/route.ts`, `app/api/agents/bio-writer/route.ts`, `app/api/gemini/route.ts`). Used for per-user daily message cap tracking. **No migration exists. No table in DB.** All agent rate-limiting queries silently fail.

---

### A3. Foreign Key Relationships

**Hub table:** `profiles` — 20 FKs point to it (every user-related table).

**ON DELETE behavior (notable):**

| FK | Delete Rule | Risk |
|----|-------------|------|
| `equipment_bookings.user_id` → profiles | CASCADE | Deleting user deletes their bookings — loss of financial records |
| `orders.buyer_id` → profiles | CASCADE | Same — deleting buyer deletes order history |
| `orders.seller_id` → profiles | CASCADE | Same |
| `subscriptions.plan_id` → subscription_plans | CASCADE | Deleting a plan deletes all subscriptions on it |
| `bookings.creator_id` → profiles | NO ACTION | Correct — prevents deletion of creators with active bookings |
| `reviews.*` → profiles | NO ACTION | Correct — preserves review integrity |

---

### A4. Indexes

**Well-indexed:** Most query patterns have matching indexes. Partial indexes used well (e.g., `idx_rentals_published WHERE deleted_at IS NULL`).

**Duplicate indexes found:**
- `equipment_bookings`: `idx_bookings_rental_id` AND `idx_equipment_bookings_rental` (same column)
- `equipment_bookings`: `idx_bookings_user_id` AND `idx_equipment_bookings_user` (same column)
- `orders`: `idx_orders_buyer` AND `idx_orders_buyer_id` (same)
- `orders`: `idx_orders_seller` AND `idx_orders_seller_id` (same)
- `orders`: `idx_orders_listing` AND `idx_orders_listing_id` (same)
- `listings`: `idx_listings_user` AND `idx_listings_user_id` (same)
- `subscriptions`: `idx_subscriptions_user` AND `idx_subscriptions_user_id` (same)

7 duplicate indexes consuming storage and slowing writes for no benefit.

---

### A5. RLS Policies

**Sound policies (defense-in-depth working):**
- `profiles` — Owner-safe update prevents self-escalation (can't change `role`, `is_verified`, `verification_status`, `is_suspended`, `no_show_count`, `crew_featured`)
- `moderation_log` — `USING (false)` blocks all direct access; only service role can write
- All admin tables use `is_admin()` (JWT-level check) after migration 031

**SECURITY ISSUE — `chat_faqs` RLS:**
```sql
CREATE POLICY "Service role full access on chat_faqs"
  ON chat_faqs FOR ALL
  USING (true) WITH CHECK (true);
```
This grants **any user** (including anonymous) full INSERT/UPDATE/DELETE on `chat_faqs`. The policy name says "Service role" but the qualifier is `USING (true)` — it doesn't check `auth.role() = 'service_role'`. Any authenticated user can create fake FAQ entries or delete existing ones. Should be `USING (auth.role() = 'service_role'::text)`.

**Other `USING(true)` policies (acceptable):**
- `platform_events` INSERT — write-only event log, acceptable
- `feature_flags` SELECT — public read of flags, correct
- `crew_requests` INSERT — anyone can submit a request, by design

---

### A6. Cron Jobs

| Job | Schedule | Effective Time (SAST) | Steps |
|-----|----------|----------------------|-------|
| `daily-maintenance` | `0 0 * * *` | 02:00 | Auto-approve deliveries, payouts, expire stale requests, detect overdue rentals, auto-suspend, publish productions, POPIA cleanup, cart abandonment recovery |
| `hourly-checks` | `0 6 * * *` | 08:00 **once/day** | Health check, alert unassigned orders, overdue deliveries |
| `weekly-reports` | `0 6 * * 1` | Mon 08:00 | Financial summary, user growth, booking funnel, FAQ indexing, email report |
| `ai-budget-checks` | `0 12 * * *` | 14:00 | Monitor AI token spend vs budget, alert at thresholds |

**NOTE:** `hourly-checks` is named "hourly" but runs once daily at 06:00 UTC. The schedule `0 6 * * *` is not hourly — it's daily at 6am. Either the name or the schedule is wrong.

---

### A7. External Services

| Service | Provider | Status | Env Vars |
|---------|----------|--------|----------|
| Database/Auth | Supabase | Active | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| AI (primary) | Anthropic Claude | Active | `ANTHROPIC_API_KEY`, `AI_PROVIDER` |
| AI (routing) | Google Gemini | Active | `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY` |
| AI (fallback) | OpenAI | Configured, unused | `OPENAI_API_KEY` |
| Payments | Paystack | Active | `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` |
| Payments (alt) | PayFast | Code exists, inactive | `PAYFAST_MERCHANT_ID/KEY/PASSPHRASE` |
| Storage | Cloudinary | Active | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` |
| Email | Gmail/Nodemailer | Active | `GMAIL_USER`, `GMAIL_APP_PASSWORD` |
| WhatsApp | Twilio | Code exists, inactive | `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_NUMBER` |
| Hosting | Vercel | Active | Analytics + Speed Insights + Cron |
| Embeddings | Gemini (free) | Gated by `RAG_ENABLED=false` | `GEMINI_API_KEY` |

---

### A8. Dependencies (package.json)

**Framework:** Next.js 16.1.6, React 19.2.3
**AI:** `ai` 6.0.116, `@ai-sdk/anthropic` 3.0.58, `@ai-sdk/google` 3.0.43, `@ai-sdk/openai` 3.0.41, `@google/generative-ai` 0.24.1
**Database:** `@supabase/ssr` 0.8.0
**UI:** `framer-motion` 12.34.2, `lucide-react` 0.574.0, `three` 0.128.0, `react-markdown` 10.1.0
**Payments:** No SDK — uses Paystack REST API via `fetch()`
**PDF:** `jspdf` 4.2.1 (generation), `unpdf` 1.4.0 (parsing)
**Media:** `exifr` 7.1.3 (EXIF extraction), `react-dropzone` 15.0.0, `react-easy-crop` 5.5.6
**Util:** `nanoid` 5.1.7
**Testing:** `vitest` 4.0.18, `@playwright/test` 1.58.2

**Potentially unused dependency:** `openai` 6.27.0 — direct OpenAI SDK. The AI abstraction uses `@ai-sdk/openai` instead. Check if `openai` is imported anywhere outside of `@ai-sdk`.

---

## B. Data Flows

### B1. Signup → Login

```
User visits /register
  → Client form submits to Supabase Auth (supabase.auth.signUp)
  → Supabase creates auth.users row + triggers profile creation
  → Email confirmation sent by Supabase
  → User clicks link → /auth/callback → exchanges code for session
  → AuthProvider.tsx hydrates session on client
  → proxy.ts refreshes session token on every request
  → Idle timeout: 30 min inactivity → auto-logout (AuthProvider)
```

### B2. Browse → Book a Service

```
/studio → /studio/category/[slug] → /studio/category/[slug]/[id] (creator profile)
  → "Book Creator" button → /book?creator={id}&category={cat}
  → Opens Ubunye chat with pre-selected creator (booking agent)
  → 3-step booking flow:
    1. Collect: location, date, duration
    2. Tool call: calculate_booking_quote → returns ZAR breakdown
    3. Confirm → creates booking row → returns Paystack payment link
  → User pays via Paystack checkout
  → Paystack webhook → /api/webhooks/paystack → confirms booking
  → Creator notified via notifications table
  → Creator accepts → delivers → client reviews
  → Admin triggers payout via /api/admin/service-bookings/[id]/payout
```

**State lives in:** `bookings` table (40 columns, amounts in ZAR cents)

### B3. Browse → Rent Equipment

```
/rentals → /rentals/[category] → /rentals/[category]/[slug]
  → "Add to Cart" → /api/cart (POST)
  → /dashboard/cart → reviews items
  → "Checkout" → /api/cart/checkout → creates equipment_bookings + booking_payments
  → Redirects to Paystack checkout
  → Paystack webhook confirms → equipment_bookings.status → 'confirmed'
  → Rental period starts/ends
  → Admin reviews return condition → /admin/rentals/[id]/review-return
  → Deposit released or disputed
```

**State lives in:** `cart_items` → `equipment_bookings` + `booking_payments`

### B4. Payment Flow

```
PAYSTACK FLOW:
  Client checkout → /api/cart/checkout or /api/service-bookings/pay
    → Initialize Paystack transaction (server-to-server)
    → Returns access_code + authorization_url
    → Client redirected to Paystack checkout page
    → Payment complete → two signals:
      1. Client redirect → /api/service-bookings/callback (GET, verify)
      2. Webhook → /api/webhooks/paystack (POST, source of truth)
    → Webhook handler:
      - Validates HMAC signature
      - Checks payment type (custom_str1): cart_checkout | equipment_booking | service_booking | subscription
      - Amount reconciliation (Math.abs diff > 0.01 → flag for manual review)
      - Updates booking status
      - Creates booking_payments record
      - Sends notifications

PAYOUT FLOW (service bookings only):
  Admin triggers → /api/admin/service-bookings/[id]/payout
    → Paystack Transfers API → sends to creator's bank
    → Transfer webhook → updates payout_status
    → Creator notified
```

**Idempotency:** Transfer webhooks check existing `payout_status` before updating.
**Amount reconciliation:** Both equipment and cart checkouts verify `expected vs received` amount.
**Gap:** No idempotency check on `handlePaymentComplete` for the initial payment — if Paystack sends the webhook twice, it could create duplicate `booking_payments` records for equipment bookings (line 199 in paystack webhook does a raw INSERT without checking for existing payment).

### B5. AI Chat (Ubunye)

```
User opens /ubunye-ai-studio
  → Client sends messages via /api/agents/[agentId] (POST)
  → Agent runtime (lib/agents/runtime.ts):
    1. Auth check (session required)
    2. Agent routing (booking > portfolios > rates > assistant)
    3. Rate limit check via ubunye_usage table [BROKEN — table missing]
    4. Subscription plan check for daily limits
    5. Stream response via Vercel AI SDK
    6. Log token usage via trackedCompletion/logTokenUsage
    7. Log messages to chat_messages
```

### B6. Creator Onboarding

```
/onboarding → 5-step flow:
  1. Profile basics (name, bio, location)
  2. Skills & specializations
  3. Portfolio upload (Cloudinary) + AI vision analysis (Gemini)
  4. Equipment listing (optional, creates smart_rentals)
  5. Bio review (AI-generated bio via bio-writer agent)
  → /api/onboarding/complete → marks onboarding_progress
```

---

## C. Dependency Graph

### C1. Most-Imported Modules (God Modules)

| Module | Import Count | Role |
|--------|-------------|------|
| `@/lib/constants` | 117 files | Business config (STUDIO, PRODUCTION_SERVICES) |
| `@/lib/supabase/server` or `@/lib/supabase/client` | 178 files | Database access |
| `@/lib/auth` | 78 files | Auth checks (requireAdmin, requireAuth, checkRateLimit) |
| `@/lib/seo/metadata` | ~30 files | Page metadata builder |
| `@/lib/seo/structured-data` | ~15 files | JSON-LD generators |
| `@/lib/ai/tracked` | ~10 files | AI cost tracking |

**`lib/constants.ts`** is the true god module — 117 files depend on it. This is by design (single source of truth) and is fine.

### C2. Circular Dependencies

No circular dependencies detected. The architecture is cleanly layered:
```
pages/components → lib/supabase/queries/* → lib/supabase/server
pages/components → lib/auth → lib/supabase/server
API routes → lib/agents/* → lib/ai/* → lib/constants
API routes → lib/payments/* → lib/constants
```

### C3. Deepest Import Chains

```
app/api/agents/booking/route.ts
  → lib/agents/runtime.ts
    → lib/agents/tools/booking.ts
      → lib/payments/paystack.ts
        → lib/constants.ts
```
5 levels deep. Acceptable.

### C4. Provider Abstraction Layer

Clean pattern consistently applied:
```
lib/ai/index.ts         → exports getModel() based on AI_PROVIDER
lib/payments/index.ts   → exports payments based on PAYMENT_PROVIDER
lib/storage/index.ts    → exports storage based on STORAGE_PROVIDER
lib/email/index.ts      → exports email based on EMAIL_PROVIDER
lib/search/index.ts     → exports search based on SEARCH_PROVIDER
```

No direct SDK imports found in app/ or components/ directories. Abstraction discipline is strong.

---

## Summary of Phase 1 Findings

### Critical Issues Found
1. **`ubunye_usage` table missing** — agent rate limiting is broken (5 files query a nonexistent table)
2. **`chat_faqs` RLS is wide open** — `USING(true)` allows any user to INSERT/UPDATE/DELETE FAQs
3. **Duplicate payment risk** — Paystack webhook `handlePaymentComplete` lacks idempotency for equipment booking payments

### Notable Observations
- 35 Supabase tables, 20 with 0 rows (most are active features awaiting first real usage)
- 7 duplicate indexes wasting storage
- `hourly-checks` cron runs daily despite its name
- `openai` SDK may be an unused dependency
- `ON DELETE CASCADE` on `equipment_bookings.user_id` and `orders.buyer_id/seller_id` could destroy financial records if a user is deleted
- Profile update RLS is impressively thorough (prevents self-escalation on 6 fields)
- No `ubunye_usage` migration exists anywhere in the codebase
