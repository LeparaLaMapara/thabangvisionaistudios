# Architecture — Provider Abstraction Layers

All external services go through abstraction layers in `lib/`. Each layer has a shared interface, one or more provider implementations, and an env var to switch providers at runtime. No page or API route imports a provider SDK directly.

```
┌──────────────────────────────────────────────────────────────┐
│  Pages / API Routes                                          │
│  import from @/lib/ai, @/lib/payments, @/lib/storage, etc.  │
└──────────────┬───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Abstraction Layer (lib/)                                     │
│  ┌────────┐ ┌──────────┐ ┌─────────┐ ┌───────┐ ┌────────┐  │
│  │  AI    │ │ Payments │ │ Storage │ │ Email │ │ Search │  │
│  └───┬────┘ └────┬─────┘ └────┬────┘ └───┬───┘ └───┬────┘  │
│      │           │            │           │         │        │
│  env var     env var      env var     env var    env var     │
│  selects     selects      selects     selects    selects     │
│  provider    provider     provider    provider   provider    │
└──────────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  Provider SDKs                                                │
│  @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google          │
│  Paystack (REST API, active), PayFast (URL-based, dormant)                    │
│  Cloudinary, Supabase Storage (stub), S3 (stub)             │
│  Gmail/Nodemailer, Resend                                     │
│  Supabase full-text search, Algolia (stub)                   │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

| Layer | File | Env Var | Active Provider | Alternatives |
|-------|------|---------|-----------------|--------------|
| AI | `lib/ai/index.ts` | `AI_PROVIDER=anthropic` | Anthropic Claude | OpenAI, Gemini |
| Agents | `lib/agents/index.ts` | `AGENT_*_ENABLED=true` | 5 Ubunye agents | See `docs/processes/ubunye-agents.md` |
| Auth | `lib/auth/index.ts` | `AUTH_PROVIDER=supabase` | Supabase | (extensible) |
| Payments | `lib/payments/index.ts` | `PAYMENT_PROVIDER=paystack` | **Paystack** | PayFast (dormant) |
| Storage | `lib/storage/index.ts` | `STORAGE_PROVIDER=cloudinary` | Cloudinary | Supabase Storage (stub), S3 (stub) |
| Email | `lib/email/index.ts` | `EMAIL_PROVIDER=gmail` | Gmail/Nodemailer | Resend |
| Search | `lib/search/index.ts` | `SEARCH_PROVIDER=supabase` | Supabase | Algolia (stub) |
| RAG | `lib/rag/index.ts` | `RAG_ENABLED=false` | Gemini embeddings | OpenAI embeddings |

---

## 1. AI Layer (`lib/ai/`)

Uses the **Vercel AI SDK** with a thin `getModel()` wrapper.

```
lib/ai/
  index.ts    getModel() → returns LanguageModel based on AI_PROVIDER
```

**How it works:**
- `getModel()` returns `anthropic('claude-sonnet-4-20250514')`, `openai('gpt-4o')`, or `google('gemini-2.0-flash')`
- API routes call `streamText({ model: getModel(), ... })` or `generateText({ model: getModel(), ... })`
- Frontend uses `useChat()` from `@ai-sdk/react` with `DefaultChatTransport`
- UIMessage format (frontend) is auto-converted to ModelMessage format via `convertToModelMessages()` in the chat route

**Key routes:**
- `POST /api/ubunye-chat` — streaming chat (`streamText`)
- `POST /api/gemini` — non-streaming fallback (`generateText`)

**Packages:** `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/react`

---

## 2. Auth Layer (`lib/auth/`)

```
lib/auth/
  types.ts      AuthProvider interface, AuthUser, AuthResult types
  supabase.ts   Supabase adapter (@supabase/ssr cookie-based)
  index.ts      Provider registry + convenience re-exports
```

**Interface:**
```typescript
interface AuthProvider {
  getUser(): Promise<AuthUser | null>;       // Server components/layouts
  requireAuth(): Promise<AuthResult>;        // API routes (authenticated)
  requireAdmin(): Promise<AuthResult>;       // API routes (admin only)
  isAdmin(email: string): boolean;           // Email-based admin check
  signOut(): Promise<void>;                  // Client-side sign out
}
```

**Usage pattern in API routes:**
```typescript
const result = await requireAdmin();
if (result.error) return result.error;  // 401 or 403
// result.user is guaranteed
```

**Also exports:**
- `checkRateLimit(key, max, windowMs)` — in-memory sliding window rate limiter
- `isSafeUrl(url)` — blocks `javascript:`, `data:` protocols

**Session refresh:** `proxy.ts` (Next.js 16 convention) runs on every request, calls `supabase.auth.getUser()` to refresh tokens.

**Admin access:** `ADMIN_EMAILS` array in `lib/constants.ts`. Case-insensitive comparison.

---

## 3. Payments Layer (`lib/payments/`)

```
lib/payments/
  types.ts      PaymentProvider interface, CheckoutParams, WebhookResult
  payfast.ts    PayFast adapter (URL-based checkout, form-encoded ITN webhooks)
  paystack.ts   Paystack adapter (REST API checkout, HMAC SHA-512 webhooks)
  index.ts      Provider registry + env-based selection
```

**Interface:**
```typescript
interface PaymentProvider {
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<CheckoutResult>;
  validateWebhook(request): Promise<WebhookResult>;
  isConfigured(): boolean;
}
```

**Flow differences:**
- **PayFast:** Builds signed URL → browser redirect → form-encoded ITN webhook (IP + MD5 + server validation)
- **Paystack:** Server API call → returns checkout URL → JSON webhook (HMAC SHA-512)

**Paystack for service bookings (new):**
- `verifyPayment(reference)` — confirms payment status after redirect
- `refundPayment(reference, amount?)` — full or partial refunds
- `initiateTransfer(params)` — creator payouts to bank accounts

**Metadata mapping:** `customStr1` = payment type, `customStr2` = user ID, `customStr3` = resource ID

**Credentials:** See `docs/security.md` for setup instructions.

---

## 4. Storage Layer (`lib/storage/`)

```
lib/storage/
  types.ts              StorageProvider interface
  cloudinary.ts         Cloudinary (fully implemented)
  supabase-storage.ts   Stub
  s3.ts                 Stub
  index.ts              Provider registry

lib/cloudinary/
  upload.ts             Client-side upload helpers (XHR with progress)
```

**Two-layer architecture:**
1. **Server-side** (`lib/storage/`) — signing, server uploads, deletions
2. **Client-side** (`lib/cloudinary/upload.ts`) — direct-to-provider uploads with progress

**Upload flow:**
```
Browser → POST /api/cloudinary/sign (get signature)
        → POST directly to Cloudinary (signed, no server proxy)
        → Save URL + public_id to Supabase
```

**Folder conventions:**
| Content | Path |
|---------|------|
| Productions | `thabangvision_usecase/media/smartproductions/{category}` |
| Rentals | `thabangvision_usecase/media/smartrentals/{category}` |
| Press | `thabangvision_usecase/media/press` |
| Avatars | `thabangvision_usecase/media/avatars` |
| Marketplace | `thabangvision_usecase/media/marketplace/{user_id}` |

---

## 5. Email Layer (`lib/email/`)

```
lib/email/
  types.ts    EmailProvider interface
  gmail.ts    Gmail/Nodemailer adapter
  index.ts    Provider registry
```

**Graceful degradation:** If `GMAIL_USER` / `GMAIL_APP_PASSWORD` are not set, emails are logged to console instead of sent. No crashes.

---

## 6. Search Layer (`lib/search/`)

```
lib/search/
  types.ts      SearchProvider interface
  supabase.ts   Supabase full-text/ilike search
  index.ts      Provider registry
```

**Input sanitization:** All search queries strip PostgREST special characters (`%`, `_`, `\`) before `ilike` queries.

---

## 7. Agent Layer (`lib/agents/`)

Five specialized Ubunye agents sharing a common runtime. Full design doc: **`docs/processes/ubunye-agents.md`**

```
lib/agents/
  types.ts        UbunyeAgent interface, AgentTool, AgentContext
  registry.ts     All 5 agents registered
  runtime.ts      Shared: auth → rate limit → prompt → execute → cost
  router.ts       Assistant → specialist hand-off
  agents/         One file per agent (assistant, booking, onboarding, portfolios, rates)
  tools/          Shared tool implementations (search, booking, vision, portfolio, pricing)
```

| Agent | Model | Cost | Endpoint |
|-------|-------|------|----------|
| Assistant | Claude + Gemini routing | Medium | `/api/agents/assistant` |
| Booking | Claude Sonnet | Medium | `/api/agents/booking` |
| Onboarding | Gemma 4 (free) | Free | `/api/agents/onboarding` |
| Portfolios | Gemma 4 (free) | Free | `/api/agents/portfolios` |
| Rates | Claude Sonnet | Medium | `/api/agents/rates` |

**Key principle:** Onboarding and Portfolios use Gemma 4 via Google AI Studio (free tier, 15 RPM). The highest-volume agents cost nothing. Claude is reserved for reasoning tasks (booking, rates).

---

---

# System Architecture

The provider layers above are one slice. This is the rest: how a request moves,
how the domain hangs together, and where the rules live.

## Request path

```
Browser
  │
  ▼
proxy.ts ......................... session refresh (NOT middleware.ts — Next 16)
  │
  ▼
Route group
  (marketing) ....... public pages, Header + Footer
  (platform) ........ rentals, studio, dashboard, creators
  (admin) ........... admin topbar only, no public nav
  (immersive) ....... Ubunye AI studio, no chrome
  │
  ▼
Server Component ................. fetches via lib/supabase/queries/*
  │                               anon client, RLS applies
  ▼
Client Component ................. presentation only
```

API routes sit beside this and use one of three Supabase clients. Which one is
a security decision, not a convenience:

| Client | Used by | RLS |
|---|---|---|
| `createClient()` server | Server Components, most routes | enforced |
| `createClient()` browser | Client Components | enforced |
| `createAdminClient()` | webhooks, cron, service-only tables | **bypassed** |

`createAdminClient` bypasses RLS entirely. Every use should be justified in a
comment at the call site.

## The domain

Two businesses on one platform, joined by the person.

```
                        ┌──────────────┐
                        │   profiles   │
                        │  (a person)  │
                        └──────┬───────┘
             owner_id ┌────────┼────────┐ creator_id
                      ▼        ▼        ▼
            ┌──────────────┐  │  ┌──────────────────┐
            │ smart_rentals│  │  │ smart_productions│
            │  (the gear)  │  │  │   (the work)     │
            └──────┬───────┘  │  └──────────────────┘
                   │          │
                   │          └── specializations, hourly_rate,
                   │              available_for_hire (the person
                   │              themselves, bookable)
                   ▼
          ┌──────────────────┐        ┌──────────┐
          │equipment_bookings│        │ bookings │
          │  (gear hired)    │        │ (shoots) │
          └──────────────────┘        └──────────┘
```

Four things are bookable from that one shape: the work, the gear, the person,
and — once crew list their own kit — the person *with* their gear. See
`docs/direction.md` for why that matters.

`public_profiles` is the only public projection of `profiles`. The base table
has **no anon SELECT policy**, so anything public must read the view.

## Where the rules live

Business rules are pure modules with unit tests, not logic buried in routes.
Routes gather and persist; the modules decide. This is why the test suite runs
in seconds with no database.

| Module | Decides |
|---|---|
| `lib/rental/availability.ts` | how many units are free, when a hold expires |
| `lib/rental/cancellation.ts` | refund owed, by notice given |
| `lib/cart/pricing.ts` | totals, bulk discount, VAT (disclosed, not added) |
| `lib/delivery/quote.ts` | distance-based delivery fee |
| `lib/bookings/validate.ts` | what a shoot booking must have before payment |
| `lib/home/showcase.ts` | how work and gear interleave on the home page |
| `lib/growth/checkpoints.ts` | when a capability has become worth building |
| `lib/ubunye/sanitise.ts` | neutralising user text before it reaches a prompt |

## The self-watching layer

```
vercel.json crons
  ├── 00:00  daily-maintenance ..... overdue, auto-approve, suspensions
  ├── 03:00  invariants ............ correctness checks + growth checkpoints
  ├── 06:00  hourly-checks
  ├── 12:00  ai-budget-checks
  └── Mon 06:00  weekly-reports
```

`lib/ops/` holds the invariant checks. The unit is a **property that must
hold**, not a job title — each is one deterministic detector, split into
`gather` (touches the database) and `detect` (pure, tested). A model is never
asked whether something is broken.

Findings de-duplicate by fingerprint in `ops_findings`, and email fires on
**transition only**: a new problem, never a re-sighting. A quiet inbox means
quiet.

`lib/growth/checkpoints.ts` rides the same cron. Each future capability
declares the numbers at which it stops being premature, so the roadmap is
something the system notices rather than something a person must remember to
re-read.

## Data the platform keeps about itself

| Table | Holds | Read by |
|---|---|---|
| `unmet_demand` | searches that found nothing, checkouts refused on dates | inventory decisions, `unmet_demand_summary` |
| `ops_findings` | open/resolved invariant findings, de-duplicated | the cron, admin |
| `ops_check_runs` | every sweep, its duration and errors | detecting a cron that runs but does nothing |
| `platform_events` | first-party analytics | product decisions |
| `rate_limit_hits` | fixed-window counters, atomic | `checkRateLimit` |

`unmet_demand` is service-role only. It is inventory research, aggregated —
never a per-person record.

## Conventions that are load-bearing

- **`supabase-js` does not throw.** It returns `{ data, error }`. Writing
  `const { data } = await supabase...` discards the error at the destructuring
  site and the surrounding `catch` never runs. This has been the single largest
  source of silent failures in this codebase. Always destructure `error` too.
- **Constants live in `lib/constants.ts`.** Prices, policies, lead times and
  legal identity are read from there, never typed into a page. A number in JSX
  is a bug waiting to drift.
- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed it; the old filename is
  silently ignored.
- **Migrations are applied by hand** to both projects, and must be applied to
  both. `lib/migrations/` is the numbered series.


## Adding a New Provider (Any Layer)

1. Create `lib/{layer}/newprovider.ts` implementing the interface
2. Register in `lib/{layer}/index.ts` providers map
3. Set the env var to the new provider name
4. Restart the dev server

No application code changes needed.
