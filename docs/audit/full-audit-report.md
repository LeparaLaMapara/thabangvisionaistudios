# ThabangVision Platform — Architecture Audit Report

---

## 1. EXECUTIVE SUMMARY

This platform is a **solid MVP with good architectural instincts** — cleanly layered provider abstractions, principled RLS policies, zero circular dependencies, and a single-source-of-truth constant system used across 117 files. It would survive early customer traction (hundreds of users) without structural changes. However, there are **three blocking issues** that could cause real harm at current scale: a missing database table that silently breaks all AI rate limiting, an RLS policy that lets any user tamper with FAQ data, and a payment webhook that can create duplicate records. Beyond those, the codebase is pre-scale — monolithic cron jobs, no retry logic on external calls, and several backend features with no admin UI. On the spectrum, this sits at **"credible MVP, 2-3 weeks from surviving Series A diligence."**

---

## 2. TOP 5 FINDINGS (Must Fix)

### P0-1: `ubunye_usage` table does not exist — all AI rate limiting is broken

**Problem:** CLAUDE.md documents per-agent daily message caps tracked in `ubunye_usage`. Five files actively query this table:
- `lib/agents/runtime.ts:222` — core agent pipeline
- `app/api/agents/rates/route.ts:41,57,59`
- `app/api/agents/bio-writer/route.ts:92,133,138`
- `app/api/gemini/route.ts:98,113,115`

No migration creates this table. No table exists in the database. All Supabase queries against it silently return `null` (Supabase doesn't throw on missing tables via the PostgREST API; it returns empty results). **Every user gets unlimited AI messages regardless of plan.**

**Impact at scale:** At 10x users, AI costs are completely uncontrolled. A single user could burn your entire R500/month AI budget in a day. At 100x users, this is a billing emergency.

**Proposed fix (30 min):**
```sql
-- Migration 039: ubunye_usage — per-user daily AI message tracking
CREATE TABLE IF NOT EXISTS ubunye_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_ubunye_usage_user_date ON ubunye_usage(user_id, date);

ALTER TABLE ubunye_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ubunye_usage"
  ON ubunye_usage FOR ALL
  USING (auth.role() = 'service_role'::text);
```

**I could be wrong about this if:** Supabase PostgREST actually returns errors for nonexistent tables and the code's error handling catches them somewhere upstream. But I verified — PostgREST returns 404 for missing tables, which the Supabase JS client surfaces as `{ data: null, error: { code: '42P01' } }`. The code checks `if (!usage)` and treats it as "no usage yet today" — so the insert path runs, but that INSERT also fails silently. Net effect: no tracking.

---

### P0-2: `chat_faqs` RLS allows any user to INSERT/UPDATE/DELETE

**Problem:** Migration 038 creates this policy:
```sql
CREATE POLICY "Service role full access on chat_faqs"
  ON chat_faqs FOR ALL
  USING (true) WITH CHECK (true);
```

The name says "Service role" but the qualifier is `USING (true)` — no role check. Compare with the correct pattern used on `ai_token_usage`:
```sql
USING (auth.role() = 'service_role'::text)
```

Any authenticated user (or even anonymous via the public read policy combined with this ALL policy) can INSERT fake FAQ entries, UPDATE existing answers, or DELETE published FAQs.

**Impact at scale:** At any scale, a malicious user could inject misleading or harmful FAQ content onto the public `/faq` page. The FAQ page has `revalidate = 60`, so poisoned content appears within a minute.

**Proposed fix (5 min):**
```sql
DROP POLICY "Service role full access on chat_faqs" ON chat_faqs;

CREATE POLICY "Service role full access on chat_faqs"
  ON chat_faqs FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
```

**I could be wrong about this if:** Supabase's PostgREST layer applies additional role filtering that isn't visible in the policy definition. But the policy is explicitly `PERMISSIVE` with `roles: {public}` — it applies to all roles.

---

### P0-3: Paystack webhook can create duplicate payment records

**Problem:** In `app/api/webhooks/paystack/route.ts`, the `handlePaymentComplete` function for equipment bookings (line 199) does:
```typescript
await supabase.from('booking_payments').insert({
  booking_id: paymentId,
  payfast_payment_id: providerPaymentId,
  amount: amountGross,
  currency: 'ZAR',
  status: 'complete',
});
```

There is no idempotency check — no `ON CONFLICT`, no pre-check for existing payment with the same `providerPaymentId`. If Paystack retries the webhook (which it does on timeouts), this creates a duplicate `booking_payments` row.

The transfer (payout) handlers DO have idempotency checks (lines 19-28). The equipment booking handler does not.

**Impact at scale:** Duplicate payment records corrupt financial reporting, confuse the admin dashboard, and could theoretically trigger double-payout logic if downstream code sums `booking_payments`.

**Proposed fix (15 min):** Add an idempotency check before the insert:
```typescript
// Check for existing payment
const { data: existingPayment } = await supabase
  .from('booking_payments')
  .select('id')
  .eq('booking_id', paymentId)
  .eq('payfast_payment_id', providerPaymentId)
  .maybeSingle();

if (existingPayment) {
  console.log(`[paystack-webhook] Payment already recorded: booking=${paymentId}`);
  return;
}
```

Or better — add a UNIQUE constraint on `(booking_id, payfast_payment_id)` at the DB level.

**I could be wrong about this if:** Paystack guarantees exactly-once webhook delivery. They don't — their docs explicitly say to implement idempotency.

---

### P0-4: `ON DELETE CASCADE` destroys financial records when users are deleted

**Problem:** These foreign keys use `CASCADE`:
- `equipment_bookings.user_id` → profiles (CASCADE)
- `orders.buyer_id` → profiles (CASCADE)  
- `orders.seller_id` → profiles (CASCADE)
- `subscriptions.user_id` → profiles (CASCADE)

If a user is deleted from `auth.users` (which cascades to `profiles`), all their equipment bookings, orders, and subscriptions are permanently destroyed. This is financial record destruction.

Compare with the correct pattern on `bookings.creator_id` → profiles (`NO ACTION`) — prevents deletion.

**Impact at scale:** At any scale, accidentally deleting a user (or a Supabase admin action) could destroy booking and payment history needed for accounting, tax, and disputes.

**Proposed fix (15 min):**
```sql
-- Change CASCADE to RESTRICT on financial tables
ALTER TABLE equipment_bookings DROP CONSTRAINT equipment_bookings_user_id_fkey;
ALTER TABLE equipment_bookings ADD CONSTRAINT equipment_bookings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE orders DROP CONSTRAINT orders_buyer_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE orders DROP CONSTRAINT orders_seller_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE RESTRICT;
```

**I could be wrong about this if:** Users are never deleted — only soft-suspended. But there's no system constraint preventing hard deletion.

---

### P0-5: Cart checkout is not atomic — partial state on payment init failure

**Problem:** In `app/api/cart/checkout/route.ts`, the flow is:
1. Insert `equipment_bookings` rows (line 201) ✓
2. Create Paystack checkout (line 225) — **can fail**
3. Insert `booking_payments` records (line 254)
4. Clear cart (line 257)

If step 2 fails (Paystack down, network timeout), the code continues — `paymentUrl` is `null`, but bookings are created, payments are recorded as pending, and the cart is cleared. The user loses their cart with no way to pay.

**Impact at scale:** At 10x users, Paystack will occasionally timeout. Each timeout creates orphaned bookings that block the rental's availability calendar and a cleared cart the user can't recover.

**Proposed fix (30 min):** Make the payment URL a gate:
```typescript
if (!paymentUrl) {
  // Roll back: delete the bookings we just created
  await adminClient.from('booking_payments').delete().eq('booking_id', 'in', bookings.map(b => b.id));
  await adminClient.from('equipment_bookings').delete().eq('checkout_group_id', checkoutGroupId);
  return NextResponse.json({ error: 'Payment service unavailable. Please try again.' }, { status: 503 });
}
```

**I could be wrong about this if:** The frontend handles null `payment_url` gracefully and doesn't clear the cart. But the backend clears the cart unconditionally (line 257).

---

## 3. CLEANUP MANIFEST

### Dead Dependencies

| Item | Confidence | Removal Action | Risk |
|------|-----------|---------------|------|
| `three` + `@types/three` in package.json | **HIGH** | `npm uninstall three @types/three` | Zero — no imports exist in source code |
| `openai` SDK (6.27.0) | **MEDIUM** | Safe to remove IF `RAG_ENABLED` stays `false` | Used only in `lib/rag/embeddings/openai.ts`. If RAG is enabled with OpenAI provider, would break |
| `next-themes` (0.4.6) | **MEDIUM** | Check if imported anywhere | CLAUDE.md says "dark theme ONLY — no theme toggle." If next-themes is unused, remove it |

### Dead/Dormant Tables

| Table | Rows | Confidence | Verdict |
|-------|------|-----------|---------|
| `content_embeddings` | 0 | **MEDIUM** | Dormant — gated by `RAG_ENABLED=false`. Keep but acknowledge it's unused infrastructure |
| `subscription_plans` | 0 | **MEDIUM** | Built but no plans seeded. Subscription system is complete code with zero data |
| `subscriptions` | 0 | **MEDIUM** | Same — keep, but don't test/maintain until plans exist |

### Duplicate Indexes (7 confirmed)

| Table | Duplicate Index | Original Index | Action |
|-------|----------------|---------------|--------|
| `equipment_bookings` | `idx_equipment_bookings_rental` | `idx_bookings_rental_id` | DROP duplicate |
| `equipment_bookings` | `idx_equipment_bookings_user` | `idx_bookings_user_id` | DROP duplicate |
| `orders` | `idx_orders_buyer_id` | `idx_orders_buyer` | DROP duplicate |
| `orders` | `idx_orders_seller_id` | `idx_orders_seller` | DROP duplicate |
| `orders` | `idx_orders_listing_id` | `idx_orders_listing` | DROP duplicate |
| `listings` | `idx_listings_user_id` | `idx_listings_user` | DROP duplicate |
| `subscriptions` | `idx_subscriptions_user_id` | `idx_subscriptions_user` | DROP duplicate |

**Risk:** None — each duplicate indexes the exact same column(s) as the original.

### Duplicate Code

| Item | Files | Action |
|------|-------|--------|
| `formatZAR()` — two different implementations | `lib/pdf/quote.ts:33` (private, with space + fraction digits) vs `lib/productions/pricing.ts:37` (exported, no space, no fractions) | Consolidate into single export in `lib/productions/pricing.ts`. Update `lib/pdf/quote.ts` to import it |
| `lib/payfast.ts` (87 lines) vs `lib/payments/payfast.ts` (374 lines) | Root `lib/payfast.ts` appears to be an older version | Verify `lib/payfast.ts` is not imported, then delete. The canonical version is `lib/payments/payfast.ts` |

### Misnamed Cron

| Item | Issue | Fix |
|------|-------|-----|
| `/api/cron/hourly-checks` | Named "hourly" but schedule is `0 6 * * *` (once daily at 6am UTC) | Either rename to `daily-alerts` or change schedule to `0 */1 * * *` for actual hourly |

---

## 4. UI GAPS

### Backend features with NO admin UI

| Feature | Backend | Admin UI | User UI | Status |
|---------|---------|----------|---------|--------|
| **FAQ management** | `chat_faqs` table + indexer cron + public page | **MISSING** — no admin page to review/approve/edit/publish draft FAQs | `/faq` page exists | Drafts accumulate with no way to publish them |
| **Content repurposer** | `/api/admin/content-repurpose` route | **MISSING** — no UI to trigger repurposing or view results | N/A (admin tool) | API exists but is unreachable without curl |
| **Outreach agent** | `/api/admin/outreach-draft` route | **MISSING** — no UI to input prospects, view drafts, edit, send | N/A (admin tool) | API exists but is unreachable without curl |
| **Abandoned cart recovery** | Cron step 12 sends notifications | **MISSING** — no visibility into which carts are stale or which users were nudged | Users see notification | Admin can't monitor or tune |
| **AI budget alerts** | `ai_budget_alerts` table + cron | **PARTIAL** — email alerts sent, but no dashboard view | N/A | Admin gets emails but can't see historical spend trends |

### Backend features with PARTIAL UI

| Feature | Gap |
|---------|-----|
| **Refunds** | `refundPayment()` exists in `lib/payments/paystack.ts`. Admin dispute resolution page can resolve with amount. But no dedicated refund flow — no refund history view, no partial refund UI |
| **Reviews** | Backend complete (reviews table, RLS, API). Public display only on creator profile pages. No admin moderation UI for reviews. No review solicitation after booking completion |
| **Subscription plans** | Full subscription system built (plans, billing, Paystack). Zero plans seeded in DB. Pricing page shows hardcoded tiers, not from `subscription_plans` table |

### User-facing UI with no backend

| Item | Status |
|------|--------|
| All user-facing flows appear to have working backends | No "fake" UI found |

---

## 5. ARCHITECTURAL OBSERVATIONS

### 5.1 Modularity: Strong with exceptions

**Good:** Provider abstraction is genuinely clean — 5 provider registries (AI, payments, storage, email, search) all follow the same pattern. Switching providers requires only an env var change.

**Good:** Domain queries are properly separated into `lib/supabase/queries/*` (17 modules). No raw Supabase queries in components.

**Problem: Admin pages are monoliths.** `admin/projects/page.tsx` is 1,776 lines. `admin/rentals/page.tsx` is 1,367 lines. These combine form logic, file upload handling, gallery management, and rendering in one component. At 10x features, this becomes unmaintainable.

**Minimum fix:** Extract reusable components (gallery upload, form fields) into `components/admin/`. Don't refactor existing pages — just use the extracted components for new admin pages.

### 5.2 Scale: Pre-scale, with known walls

**N+1 queries in daily maintenance cron:**
- Step 9 (dispute escalation): queries each overdue booking individually, then checks each for existing disputes
- Step 10 (auto-suspension): queries all disputes, then queries each booking individually to find the user
- Step 11 (30-day overdue): queries each profile individually

At current scale (7 equipment bookings, 0 disputes) this is fine. At 1,000 bookings with 50 disputes, the cron could timeout (60s limit).

**Cart checkout availability check (line 142):** Queries `equipment_bookings` once per cart item in a loop. At 10 cart items, that's 10 sequential queries. Could be batched into one query.

**Sitemap generates 266+ location pages:** Currently computed on every request. At 100 rental categories × 20 cities, this becomes 2,000+ URLs computed per sitemap request. Should be fine with `revalidate` but worth monitoring.

**No pagination on admin list pages:** Admin routes like `/api/admin/users`, `/api/admin/equipment-bookings` appear to return all rows. At 10,000 users, these pages will be slow or timeout.

### 5.3 Caching: Intentional but thin

- Feature flags: 60s in-memory cache via `unstable_cache` ✓
- AI system prompt platform data: 5-minute in-memory cache ✓
- ISR pages: `revalidate = 60` on catalog pages ✓
- **No CDN caching headers** on API routes that serve public data
- **No stale-while-revalidate** patterns

### 5.4 Reliability: No retry logic anywhere

**No external service has retry logic:**
- Paystack API calls: no retry on 5xx or timeout
- Email sending: no retry on SMTP failure
- AI completions: no retry on rate limit or timeout
- Cloudinary operations: no retry

The daily maintenance cron does retry failed payouts (step 3), but that's a scheduled retry (6h+ apart), not an immediate retry with backoff.

**Transaction safety:** The cart checkout flow (P0-5 above) is the most concerning. Other flows are less risky because they create a single DB record before calling external services.

### 5.5 Observability: Console-only

- **No structured logging** — all logging is `console.log`/`console.error` with string interpolation
- **No request IDs or correlation** — can't trace a request across multiple log lines
- **Vercel function logs** are the only log aggregation
- **No error tracking service** (no Sentry, no LogRocket)
- **Email alerts** for critical events (stuck payouts, failed payouts) — this is good but limited to what the cron checks

**What you CAN answer today:** "Did the cron run?" (check Vercel function logs) and "What was the result?" (JSON response logged). **What you CANNOT answer:** "What happened to user X's booking at time Y?" — there's no way to filter logs by user ID.

---

## 6. WHAT'S ACTUALLY GOOD

**Don't refactor these — they're well-built:**

1. **Provider abstraction layer** — Five clean registries, env-var switching, consistent patterns. This is production-grade.

2. **RLS policy design** — 72 policies across 35 tables. The `profiles` update policy (prevents self-escalation on role, verification, suspension fields) is genuinely sophisticated. Migration 031 hardened all admin policies correctly.

3. **Payment webhook handler** — Amount reconciliation, idempotency on transfers, type-dispatched handling, proper 200 OK response to prevent Paystack retries. The duplicate payment issue (P0-3) is a gap, but the overall structure is sound.

4. **Booking system domain model** — Clean separation between service bookings (time-based, creator payouts) and equipment bookings (date-based, deposit flow). Both have proper status machines.

5. **AI agent framework** — Registry → Router → Runtime → Tools pipeline is well-abstracted. Agent definitions are isolated in `lib/agents/agents/*`. Rate limiting per plan per agent is well-designed (just needs the missing table).

6. **POPIA compliance** — Automatic deletion of verification photos after retention period. Consent tracking with IP + version + timestamp. This is ahead of most MVPs.

7. **Single source of truth** — `lib/constants.ts` for all business config, imported by 117 files. No hardcoded emails, phone numbers, or business terms found in components (pricing display values in a few spots are the exception, noted in cleanup manifest).

8. **Security headers** — CSP, HSTS, X-Frame-Options all configured in `next.config.ts`. CSRF validation in proxy.ts with Vercel preview exemption.

---

## 7. RECOMMENDED NEXT ACTIONS

### Sprint A: Fix the three blockers (1 day)

1. **Create `ubunye_usage` table** — write and apply migration 039. 30 min.
2. **Fix `chat_faqs` RLS** — apply the corrected policy. 5 min.
3. **Add payment webhook idempotency** — either DB constraint or pre-check. 15 min.
4. **Fix cart checkout atomicity** — roll back bookings if payment init fails. 30 min.
5. **Change CASCADE to RESTRICT** on financial FKs. 15 min.

### Sprint B: Admin UI for Sprint 4 features (2-3 days)

6. **Build `/admin/faqs` page** — list draft + published FAQs, approve/reject/edit/publish toggle, category filter. This is the most urgent UI gap since the FAQ indexer is already running weekly.
7. **Build `/admin/content-repurpose` page** — article selector, trigger repurposing, display results with copy buttons.
8. **Build `/admin/outreach` page** — prospect form, generate drafts, edit, copy/send.

### What NOT to do

- **Don't refactor admin page components** right now. They're monolithic but working. Extract shared components only when building new admin pages.
- **Don't add a structured logging library.** Console logging with Vercel is sufficient at current scale. Add Sentry/Datadog when you have paying customers.
- **Don't add retry logic to all external services.** Add it only to the payment flow (Paystack checkout init) and email sending. Everything else can wait.
- **Don't optimize the cron N+1 queries.** At current data volumes (7 bookings, 0 disputes), they complete in <1 second. Optimize when any table exceeds 1,000 rows.
- **Don't remove the subscription system** even though it has 0 data. It's fully built and will be needed.
- **Don't add pagination to admin pages** yet. At 1 user and 28 rentals, pagination adds complexity for no benefit.

### Cleanup (do alongside other work)

- Drop 7 duplicate indexes (zero risk)
- Remove `three` + `@types/three` from package.json
- Consolidate `formatZAR()` implementations
- Rename `hourly-checks` cron to `daily-alerts` or fix its schedule
- Verify and delete `lib/payfast.ts` if it's superseded by `lib/payments/payfast.ts`
