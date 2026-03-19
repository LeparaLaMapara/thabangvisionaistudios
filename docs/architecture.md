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
│  PayFast (URL-based), Paystack (REST API)                    │
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
| Auth | `lib/auth/index.ts` | `AUTH_PROVIDER=supabase` | Supabase | (extensible) |
| Payments | `lib/payments/index.ts` | `PAYMENT_PROVIDER=payfast` | PayFast | Paystack |
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

## Adding a New Provider (Any Layer)

1. Create `lib/{layer}/newprovider.ts` implementing the interface
2. Register in `lib/{layer}/index.ts` providers map
3. Set the env var to the new provider name
4. Restart the dev server

No application code changes needed.
