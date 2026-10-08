# Platform Audit: 6 October 2026

Scope: Supabase isolation and auth, database design, payments architecture, front-end wording (legal exposure), overall architecture, and readiness for a pickup/courier integration.

Method:
- Read the code across `app/`, `lib/`, `components/`, `types/` and both migration folders.
- Ran read-only queries against the live Supabase projects (`thabangvision-prod` and `thabangvision-dev`).
- Ran type check, unit tests, lint and build locally.

**Nothing was changed** in the code or the databases.

> Legal points are flagged for risk only. **This is not legal advice.** Have a South African attorney review the Terms, Refunds and Privacy pages, especially the VAT, NCA and POPIA items.

---

## 0. What the platform is for (my understanding)

ThabangVision is a three-sided marketplace for South African film and photo production:

- **Smart Rentals:** gear hire, both studio-owned and community-owned.
- **Smart Creators:** crew and creators booked for paid work.
- **Smart Productions:** finished work and portfolios.

**Ubunye AI** ties the three together. It answers questions, quotes through tools rather than guessing, and drives bookings.

**How it makes money today:**
- 15% commission on service bookings (the creator keeps 85%).
- Full margin on studio-owned gear.
- Direct production work.

**Later revenue:** subscriptions, featured listings, Ubunye tiers, and demand data. The longer-term idea is "rent it, own it, build it".

**The trust model** rests on ID-verified users and an in-person handover of gear. Any pickup or courier integration has to preserve that.

**Health today:**
- Type check passes.
- 408 unit tests pass.
- The production build succeeds.
- Lint fails: 18 errors and 61 warnings. CI does not run lint.

---

## 1. Supabase: prod is shared with other apps (CRITICAL)

This is the problem you were worried about, and it is real today.

### What I found in the live prod project (`zbdsqvpxpsygbuqnuekm`, "thabangvision-prod")

| Schema | Tables | Belongs to |
|---|---|---|
| `public` | 52 | ThabangVision, **plus** `apps`, `blog_comments`, `blog_subscribers`, `kb_documents`, `kb_chunks`, `kb_conversations`, `kb_messages`. Those last seven belong to **"Thabang Neural Observatory" (`tmashininisekgoto`)**, with 61 KB documents. |
| `tutor` | 60 | A tutoring app: 112 learners, about 23k questions |
| `multiversity`, `multiversity_assessment`, `multiversity_ops` | 38 | Sekhoto Multiversity (CVs, applications, bursaries, suppliers) |

The prod migration history confirms it. Migrations such as `multiversity_schemas_own_namespace`, `tutor_schema` and `expose_multiversity_schemas_to_postgrest` were applied to ThabangVision prod. The dev project (`bprargrqppufeuewryze`) has the same mix.

### Why this matters

1. **Everyone shares one login table.**
   - 11 `multiversity.*` tables have foreign keys into ThabangVision's `auth.users`.
   - Anyone who signs up on Multiversity becomes a ThabangVision user with the same password.
   - Both signup triggers fire for them: `handle_new_user` creates a ThabangVision profile, and `notify_signup` sends the ThabangVision welcome flow.
   - A token issued to one app is accepted by the others.
2. **The other apps hold ThabangVision's master key.**
   - The `tutor` and `multiversity` schemas are reachable only by `service_role`.
   - So those apps must be running with ThabangVision prod's **service-role key**.
   - That key bypasses every RLS rule. It can read banking details, ID document paths, selfies, bookings and every user's data.
   - A leak or bug in any of those apps is a ThabangVision data breach.
3. **POPIA exposure.** ThabangVision's privacy notice does not disclose that personal data shares infrastructure and credentials with unrelated apps. The responsible party (ThabangVision (Pty) Ltd) cannot show adequate safeguards under s19.
4. **Names can collide.** Generic names (`on_auth_user_created`, `handle_new_user`, the Vault secrets `signup_webhook_url`/`secret`) are shared space. One app's migration can silently replace another app's trigger.
5. **Blast radius and billing.** You can't see what each app costs, and a heavy query from one app slows ThabangVision. The roughly 56k-row `multiversity_ops.content_import` table and the large `tutor` tables already outweigh ThabangVision's own data.
6. **Security advisors are noisy.** 106 "RLS enabled, no policy" warnings, almost all from the other apps. Real ThabangVision warnings get buried.

### Recommended isolation plan

1. **Create a new, clean Supabase project for ThabangVision prod.** Put nothing else in it. A separate organisation is ideal, so billing and access are separate too.
2. **Choose how to separate:**
   - **Option A (recommended): move the other apps out.** Give `tutor`/`multiversity` and the Observatory their own projects. ThabangVision keeps its current project ref, URLs and Google OAuth setup. Then rotate the JWT signing keys and the anon and service-role keys on the ThabangVision project, so the other apps' copies stop working.
   - **Option B: move ThabangVision out.** Dump the `public` schema (ThabangVision tables only), the storage buckets, and the `auth.users` rows whose id is in `public.profiles`, then restore them into the new project. This means updating the Vercel env vars, the Google OAuth client and the Paystack webhook URLs.
   - Either way, users whose only account is on the other apps must **not** come across.
3. **Make dev contain only ThabangVision as well.** Do the same split for `thabangvision-dev`.
4. **Configure auth per project:**
   - Prod Site URL: `https://www.thabangvision.com`, with an exact-path redirect allow-list (`/auth/callback`, `/reset-password`).
   - Dev: a preview wildcard limited to your Vercel team slug, never `*.vercel.app/**`.
   - Separate Google OAuth clients and SMTP per project.
   - Turn on leaked-password protection, which the advisor says is currently off, and email confirmations.
5. **Vercel env scopes:** Production uses the prod keys only. Preview and Development use the dev keys only. GitHub Actions secrets use dev keys only; CI currently gets a real service-role key and pre-renders pages with it. *I could not confirm which Vercel projects hold which Supabase keys; the env listing was blocked. Please check `sekhotomultiversity`, `tmashininisekgoto` and the `tutor` app's projects.*
6. **Add a code guard.** At startup, if `VERCEL_ENV !== 'production'` and the Supabase URL contains the prod ref, throw. This stops a preview deployment from ever writing to prod.
7. **Rotate everything after the split:** keys, `CRON_SECRET`, the signup-webhook secret, the e2e test password (it is committed in `tests/e2e/full-journey.spec.ts:5-6`), and the Supabase MCP token (`.mcp.json` has full write access; make it `read_only=true` and point it at dev).

---

## 2. Database and auth findings (verified live on prod)

| # | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| D1 | High | **A user can edit their own banking row's `is_verified` and `paystack_recipient_code`.** The UPDATE policy has no `WITH CHECK`, and `authenticated` has UPDATE on every column. Payouts trust `paystack_recipient_code` (`lib/payments/payout.ts:106-125`), so a creator can bypass bank-account verification. | live `pg_policies` + column privileges | `REVOKE UPDATE` on those columns from `authenticated`; write them only server-side |
| D2 | High | **A user can rewrite their own verification evidence after approval:** `id_document_hash` (which defeats duplicate-ID detection), `verification_fraud_flags`, `selfie_with_id_path`, `id_*_path`. The profile `WITH CHECK` only locks role, is_verified, verification_status, suspension, no-shows and featured. | live column privileges | Column-level `REVOKE UPDATE` and an allow-list of safe columns |
| D3 | Med | **Reviews:** users can insert a review for anyone without having had a booking, and can later change the reviewee or rating (the UPDATE has no `WITH CHECK`). This is also behind the "Real reviews from real clients" claim (see §4). | live policies | Insert only through a server route that checks for a completed booking |
| D4 | Med | **Migrations no longer match prod.** There are two folders (`lib/migrations` up to 065 and `supabase/migrations` up to April). Numbers are duplicated (001, 022, 032, 033) and 034 is missing. Prod has `066_pay_by_eft` and `kb_rag_pgvector`, which are not in the repo. Some prod fixes, such as the `crew_requests` admin policy, exist only in prod. A fresh `supabase db push` would build a database that is **less secure** than prod. | `list_migrations` vs repo | Dump a baseline from prod into `supabase/migrations/` as the single source of truth, retire `lib/migrations`, and add a CI drift check |
| D5 | Med | The view `public_profiles` is `SECURITY DEFINER`, which the advisor rates as an error. `guard_phone_verified` has a mutable `search_path`. `is_admin()` and the admin RPCs can be executed by `anon` and `authenticated`; they check internally, but this widens the attack surface. | advisors | `security_invoker = on` for the view, pin `search_path`, revoke EXECUTE from `anon` |
| D6 | Med | `ADMIN_EMAILS` fallback (`lib/auth/supabase.ts:83`) trusts the email without checking `email_confirmed_at`. On a project with confirmations off, anyone who registers that email first becomes admin. | code | Require a confirmed email |
| D7 | Low | `pg_net` is installed in `public`. `banking_details.account_number` still exists (now nulled). Unsubscribe uses an unsigned email in a GET (`api/newsletter/unsubscribe`). | advisors / code | Move the extension, drop the column, sign unsubscribe links |

**One item checked and found fine:** the old wide-open `profiles` policies (`USING (true)`) are **not** present in prod, and only 1 admin exists (via `profiles.role`). ID numbers are stored only as a hash, and documents sit in a private bucket with short-lived signed URLs.

---

## 3. Payments: making them provider-agnostic

### Where it stands
`lib/payments/` has a real interface and registry (Paystack, PayFast, Yoco). It is **only partly agnostic**:

- **Payouts are hard-wired to Paystack.**
  - `payout.ts` imports `initiateTransfer` directly.
  - `app/api/banking/route.ts` calls `api.paystack.com/transferrecipient` straight from a route, which breaks the abstraction rule.
  - It also uses `type: 'nuban'`, which is the **Nigerian** account type; South African accounts are `basa`. Check this against the Paystack docs.
- **Database columns are named after providers.**
  - `bookings.paystack_reference`; `equipment_bookings`/`booking_payments`/`orders.payfast_payment_id` (which now hold Paystack and Yoco ids); `subscriptions.payfast_token`; `banking_details.paystack_recipient_code`.
  - About 30 code paths read these columns.
- **The provider is guessed from the shape of the reference** (`routing.ts:13`: `ch_` means Yoco, anything else means Paystack). PayFast payments would be refunded and verified through Paystack.
- **The PayFast webhook is a stale fork** of the shared `fulfil.ts` logic.
- **The pay page and CSP are Paystack-only.** The page loads `js.paystack.co`, and `next.config.ts` allows only Paystack.

### Money bugs to fix now, before the refactor
1. **The subscription price comes from the browser (High).** `api/payfast/checkout/route.ts:48-66,137` takes `amount` from the request body and never reads `subscription_plans.price`. Anyone can buy Pro for R1, or send `amount: 0` to get it free. *(Verified.)*
2. **Service-booking payouts are probably always blocked (High).** The webhook overwrites `bookings.paystack_reference` with Paystack's numeric transaction **id** (`fulfil.ts:168`, `paystack.ts:259`). Payout then verifies that id as a **reference** (`payout.ts:76`), Paystack doesn't find it, and the payout guard refuses. *(Code path verified; confirm with one real booking.)*
3. **Webhooks are not idempotent and don't check status (High).** There is no event-dedupe table, and the updates have no "only if still pending" filter.
   - A replayed or late success webhook can set a cancelled or expired booking back to paid. For gear, that means double-booking.
   - A stray `charge.failed` can cancel a booking that is already paid.
4. **Status values the database rejects (Med).** Code writes `booking_payments.status='succeeded'`, but the CHECK allows only `complete`. It also writes `payment_status='failed'`, which isn't allowed either. Errors are ignored, so these writes vanish silently, and the invariant cron searches for `'complete'`.
5. **Cart rounding false alarm (Med).** Splitting the total across items and rounding each share can exceed the 0.01 tolerance, so a correctly paid cart gets flagged "AMOUNT MISMATCH".
6. **No amount check on service bookings (Med).** No webhook compares the amount paid with the booking total, and none checks currency.
7. **Take-back can refund twice (Med).** The refund runs before the guarded status update (`take-back/route.ts:98` vs `:113`), so two admins clicking at once can refund twice.

### Target design (agnostic)
```ts
type Money = { amountCents: number; currency: 'ZAR' };

interface ProviderCapabilities {
  checkout: boolean; inlinePopup: boolean; subscriptions: boolean;
  refunds: boolean; partialRefunds: boolean; verifyByReference: boolean;
}

interface PaymentProvider {
  id: 'paystack' | 'yoco' | 'payfast' | string;
  caps: ProviderCapabilities;
  allowedHosts: readonly string[];          // feeds CSP + redirect allow-list
  isConfigured(): boolean;
  createCheckout(p: { internalRef: string; money: Money; purpose: PaymentPurpose;
                      email?: string; returnUrl: string; cancelUrl: string })
    : Promise<{ redirectUrl: string; providerRef?: string; clientToken?: string }>;
  parseWebhook(req: { body: string; headers: Record<string, string>; ip: string })
    : Promise<PaymentEvent[] | null>;       // normalised: payment.succeeded / failed / refund.*
  verify?(providerRef: string): Promise<{ status: 'succeeded' | 'failed' | 'pending'; money: Money }>;
  refund?(providerRef: string, money?: Money, idempotencyKey?: string): Promise<RefundResult>;
}

interface PayoutProvider {                   // separate: payouts can stay on Paystack
  id: string;
  createRecipient(b: BankAccount): Promise<{ recipientRef: string }>;
  transfer(p: { recipientRef: string; money: Money; idempotencyKey: string }): Promise<{ providerRef: string }>;
}
```

- **Two settings:** `PAYMENT_PROVIDER` for checkout and `PAYOUT_PROVIDER` for transfers. You could take payments on Yoco and still pay creators through Paystack.
- **One webhook route,** `app/api/webhooks/payments/[provider]/route.ts`, which runs in this order:
  1. `parseWebhook`.
  2. Insert into `payment_events (provider, event_id) UNIQUE`; if the row already exists, return 200.
  3. Run `fulfil(event)`, which updates only `WHERE status IN (expected states)`, compares the amount in cents exactly, and checks currency.
  4. Keep the old routes as thin aliases until the provider dashboards are re-pointed.
- **Database changes (additive, safe):**
  - New tables: a `payments` table (purpose, subject, `payment_provider`, `provider_reference`, `internal_reference UNIQUE`, `amount_cents`, currency, status), plus `payment_events`, `refunds`, `payout_recipients` and `payouts`.
  - Add `payment_provider` and `provider_reference` to `bookings`, `equipment_bookings` and `subscriptions`, and backfill them.
  - Always route by the stored `payment_provider`, never by the reference prefix.
  - Write both old and new columns during the switch, then drop the old ones.
- **Front end:** the pay page reads `caps` (inline popup or redirect), and the CSP is built from every enabled provider's `allowedHosts`.
- **Order of work:**
  1. Fix the money bugs above.
  2. Add the new tables and columns.
  3. Wrap each provider in the new interface.
  4. Build the unified webhook and event store, and delete the PayFast fork.
  5. Switch the checkouts.
  6. Switch the readers (refunds, disputes, crons).
  7. Add contract tests per provider.
  8. Drop the legacy columns.

---

## 4. Front-end and AI wording that creates legal exposure

Your `/legal`, `/privacy` and `/refunds` pages are already careful. Most of the risk comes from **marketing copy, transactional UI and Ubunye's prompts contradicting those pages**. Each item below was traced to a file; the top ones were re-checked.

### High: fix first
| # | Where | Current | Why it's risky | Suggested |
|---|---|---|---|---|
| W1 | `lib/bookings/timeline.ts:36` | "ThabangVision holds the payment until the work is approved." | Escrow language. Contradicts Terms s6 ("not held in escrow or in trust") and can imply a regulated holding of client funds. | "Paid. Your booking is confirmed with ThabangVision." |
| W2 | `dashboard/bookings/ServiceBookingsList.tsx:78,218` | "Approve & Release Payment" | Same escrow framing, shown to clients. | "Approve delivery". Body text: "Approving confirms the work is complete." |
| W3 | `lib/ubunye/system-prompt.ts:47` (via `constants.ts:762`) | AI told: "Instalment plans for orders over R15,000." | No instalment product exists. Offering deferred payment can make you a credit provider under the **NCA**, and it's a CPA s41 misrepresentation. | Remove it from the prompt. |
| W4 | `constants.ts:764-768`, injected as "COMPETITIVE EDGE" | "All video on Sony FX/Canon Cinema", "official 2026 SARS rate R4.95/km", "12-month hosting", "Full commercial usage licence on final payment" | The AI states these as facts. Gear comes from creators. Hosting and IP contradict Terms s16 and s23, and creators may own copyright. | Delete the block, or use: "Pricing is itemised before you pay. Usage rights are set out in your production agreement." |
| W5 | `lib/agents/agents/booking.ts:57-58` | "Your booking is confirmed! [Pay now →]" | Says "confirmed" before payment, contradicting Terms s6. | "Your booking is reserved. It's confirmed once payment is received." |
| W6 | `components/verification/ConsentStep.tsx:72,99,105` | Names Cloudinary; leaves out the face comparison; says withdraw by "deleting your account" | Under **POPIA** the face match is biometric (special personal information, s26) and goes to Google outside SA (s72). The screen leaves this out, and there is no self-service delete. | Disclose the automated face comparison by Google outside SA. Withdraw by emailing the privacy address. |
| W7 | Verification via `gemma` on the free tier | ID documents sent to a free Google tier | On unpaid tiers Google may keep or review content, which is a POPIA operator problem for ID documents. | Move to a paid tier with a data-processing agreement. |
| W8 | `constants.ts:52-55`, `legal/page.tsx:77`, `dashboard/bookings/[id]/page.tsx:70` | `vatRegistered: true`, `vatNumber: ''`, "VAT number appears on every tax invoice"; the invoice list is hardcoded `[]` | No tax invoice is ever issued. If you're not a VAT vendor, charging VAT is an offence; if you are, the VAT Act s20 invoice is missing. *(Verified.)* | Confirm registration, fill in the number, and generate invoices. |
| W9 | `refunds/page.tsx:109` | "tell us within 7 days… section 56… we do not limit it" | The CPA gives 6 months for defective goods, so a 7-day limit contradicts itself. | "Tell us as soon as you notice. Your rights under CPA ss54–56 (six months for defects) are not limited." |
| W10 | `dashboard/cart/page.tsx:626-631` | Equipment checkout never shows or accepts the Terms | The heavy terms (full replacement cost, no insurance, liability cap) need prominent notice under CPA s49, and ECTA s43(2) requires a chance to review before paying. | Add a checkbox above Pay: "I agree to the Terms (incl. ss13–15: full risk, no insurance) and Refunds policy." |
| W11 | `register/page.tsx:62-65` | Google sign-up skips the terms checkbox | Google users never accept the Terms. | "By continuing you agree to our Terms and acknowledge our Privacy Policy." |
| W12 | `app/llms.txt/route.ts:56` | "We serve all major cities… Cape Town, Durban… Port Elizabeth" | False: rentals reach only 100 km from Braamfontein. Also uses the stale name for Gqeberha. *(Verified.)* | "Gear hire: Johannesburg, collection or delivery within 100 km. Crew travel by quote." |
| W13 | `lib/agents/agents/outreach.ts:39,57,64` | Automated outreach: "verified, vetted… SA-wide coverage" | POPIA s69: unsolicited electronic marketing needs consent and an opt-out. The claims are overstated and the URL is hardcoded. | Consented lists only, an opt-out line, "ID-verified creators in Gauteng". |

### Medium
- **Unprovable superlatives (CPA s41):** "Book South Africa's **Best** Creators And Gear" (`HomeClient.tsx:86`). Change to "Book South African creators and gear."
- **"No hidden fees":** the AI quotes a fuel surcharge and 1.5× overtime that appear in no T&C. Either add them to the Terms or remove them from the prompt.
- **"Verified" / "vetted" / "with experience":** verification is only an ID check. Say "ID-verified" everywhere, and drop "vetted" and "experience".
- **"Deposit Protection: Secured"** reads like insurance; Terms s15 says there is none. Change to "Refundable deposit, returned after inspection."
- **"Real reviews from real clients":** reviews can currently be written without a booking (D3). Fix D3 or soften the claim.
- **No "AI can make mistakes" notice on the Ubunye chat.** Several pages say "instant quotes" / "full price". Add under the input: "Ubunye is an AI assistant. Prices are estimates until shown at checkout."
- **Hardcoded or conflicting numbers:**
  - The crew-request deposit is "20%" in one route while constants say 50%, and /refunds doesn't cover it.
  - "Within 24 hours" in some places vs "2 business days" in the Terms.
- **Liability:** Terms s23 excludes liability "however caused". The CPA does not allow excluding gross negligence, so add that carve-out.
- **"Not yet open" text always shows:** the "online payment is not yet open, pay by EFT" line on /legal and /refunds shows even when online payment works. Show it only when payments are offline.
- **Careers** promises LA, London and Dubai sets, but those partnerships are only "planned".
- **Resources/tools page:**
  - Prices for gear you don't stock.
  - Fake "live" weather (24°C Sunny).
  - Unverified permit advice.
  - A `href="#"` link.
- **Booking emails** lack VAT, deposit, cooling-off and company registration details (ECTA s43; Companies Act s32), and use the "ZAR 1234.00" format.

### Missing disclosures and pages
- ECTA s43(1) details: directors, an address for legal service (domicilium), a dispute-resolution body (e.g. the Consumer Goods and Services Ombud), and a description of payment security.
- A **PAIA manual** (/paia), and confirmation that the Information Officer is registered with the Information Regulator.
- A **POPIA disclosure** that data shares infrastructure with other apps. Fixing §1 removes the need for this.
- A defined retention period for Ubunye chats (currently "while they remain useful").
- The rental agreement customers sign at handover. Terms s7 refers to it, but no customer-facing text exists.
- A creator/supplier agreement covering IP in deliverables.
- **Company name consistency:** constants say "THABANGVISION STUDIO (Pty) Ltd" trading as "ThabangVision"; elsewhere it's "ThabangVision Labs". Confirm against CIPC and use one name.

---

## 5. Architecture and integration

**Strengths:**
- Provider abstractions for payments, SMS, email and storage.
- Server-side pricing.
- Durable, Postgres-backed rate limiting.
- An invariant/ops findings system.
- Good pure-module tests.
- Cron routes use a fail-closed secret.

**Improvements, with reasons:**
1. **One transition table per booking type, used by every write and backed by a database trigger.**
   - Today the admin PATCH can jump an equipment booking to any status, and skips refunds when cancelling.
   - The service-booking status update doesn't filter on the current status, so two requests can both pass.
   - Logistics will add more statuses that must stay consistent in about 7 places.
2. **Tests on the money routes:** webhooks, `fulfil.ts`, cart checkout, take-back and payouts. Every race above sits in untested code.
3. **Error tracking (Sentry or similar) and a small structured logger.** There are 405 raw `console.*` calls, and invariants run only once a day, so a payment failure can go unseen for 24 hours.
4. **zod validation at route boundaries,** starting with checkout and webhooks. The hand-rolled checks are long and inconsistent across 103 routes.
5. **Close the AI-abstraction gaps:**
   - Five routes import `@ai-sdk/anthropic` or `@google/generative-ai` directly.
   - `admin/import-ratecard` isn't cost-tracked.
   - The CI grep doesn't catch either; extend it to `@ai-sdk/*` and `@google/generative-ai`.
6. **Add `npm run lint` to CI.** There are 18 lint errors, including setState-in-effect bugs and a JSX comment that renders as visible text.
7. **Split `cron/daily-maintenance`** (708 lines, 11 jobs) into separate modules, so one failure doesn't mask the rest.
8. **Fix doc drift:** CLAUDE.md and README describe migrations 001–031 or 057, an in-memory rate limiter, and PayFast for equipment. Yoco, SMS, delivery and ops aren't documented. People and agents are making decisions from stale docs.
9. **Housekeeping:** remove stray root files (`ubunye-chat-premium.html`, the `C:Users…lint-output.txt` file) and the legacy `lib/payfast.ts`. Rename `payfast_payment_id` as part of §3.

---

## 6. Pickup / courier integration ("pick up" points)

**How it works today:**
- Gear goes out by **collection** or **own-van delivery**.
- Delivery is priced by `lib/delivery/quote.ts`: straight-line distance from Braamfontein ×1.3, R11/km, minimum R150.
- Handover is in person, with an ID check, photos and a signature.
- Returns go through admin take-back and inspection.
- Data that already exists:
  - `fulfilment_method`, `delivery_address`, `lat`/`lng` and `delivery_fee` on the booking;
  - an address on profiles.
- Data that's missing:
  - Gear has no origin location; everything is assumed to leave from Braamfontein, even community gear.
  - There are no parcel dimensions or weights.

**Proposed design:** `lib/logistics/`, using the same pattern as payments. Set `LOGISTICS_PROVIDER=manual|pudo|pargo|courierguy`, with `manual` as the default; it wraps today's own-van quote.

```ts
interface LogisticsProvider {
  name: string; isConfigured(): boolean;
  getQuote(r: { origin: Endpoint; destination: Endpoint; parcels: Parcel[];
                declaredValue: number; leg: 'outbound' | 'return' }): Promise<LogisticsQuote[]>;
  listPickupPoints(near: { lat: number; lng: number } | { postalCode: string },
                   o?: { radiusKm?: number; kind?: 'locker' | 'counter' }): Promise<PickupPoint[]>;
  createShipment(r: CreateShipment): Promise<{ providerShipmentId: string; waybill: string;
                                               trackingUrl: string; labelUrl?: string }>;
  cancelShipment(id: string): Promise<{ ok: boolean; error?: string }>;
  trackShipment(id: string): Promise<ShipmentEvent[]>;
  validateWebhook(req: WebhookRequest): Promise<{ valid: boolean; providerShipmentId: string; events: ShipmentEvent[] }>;
}
// Endpoint = { kind: 'address', ...; lat; lng } | { kind: 'pickup_point', pointId }
```

**Database:**
- `shipments`: booking or checkout group, `leg` (outbound or return), provider, `provider_shipment_id` UNIQUE, origin and destination, pickup point, status, quoted, charged and actual fees, waybill, tracking and label.
- `shipment_events`: unique `provider_event_id`, so duplicate webhooks are ignored.
- Widen `fulfilment_method` to add `courier` and `pickup_point`.
- Add an origin location to `smart_rentals`.

**How it joins checkout:**
- Store the courier quote with an expiry at cart time, and re-check it on the server at checkout. The server stays the only thing that sets the price.
- Charge both legs upfront (a prepaid return label).
- Courier orders must be paid in full, because there is no counter for a balance.
- Release the deposit only when the return is delivered **and** inspected.

**Trust rules:**
- Lockers mean no in-person ID check, so keep "first hire = in person" and add an `allowCourier` trust-tier rule.
- Use the courier's proof of delivery (OTP or locker code) in place of the signature.

**Status flow:**
- New flow: `confirmed → dispatched → active` (set by the delivered/collected webhook), then `active → return_in_transit → return_pending → completed/disputed`.
- Every new status must also be added to the CHECK constraint, the types, the drift detector, the notification types, **and the availability filters**. If an availability filter misses one, the same gear can be double-booked.

**Order:**
1. Build the abstraction plus the `manual` provider and the shipments tables. This gives an audit trail with no API risk.
2. Integrate one partner. PUDO lockers or Pargo pickup points suit returns best.

*Please confirm which partner you mean by "pick up". The interface above fits PUDO (The Courier Guy), Pargo and Bob Go.*

---

## 7. Recommended order of work

| Priority | Item | Reason |
|---|---|---|
| **P0 (this week)** | §1 Separate ThabangVision prod (and dev) from Multiversity, tutor and the Observatory; rotate keys | Other apps currently hold your master key and share your login table. This is your single biggest risk (data breach, POPIA). |
| **P0** | §3 bug 1: server-side subscription price | Anyone can buy a plan for R1 |
| **P0** | §2 D1/D2: lock the banking and verification columns | Bypasses bank verification and fraud detection |
| **P0** | §4 W1–W5, W12: escrow, instalment, "confirmed", AI "edge" claims, city coverage | Direct statements that contradict your own Terms and can create regulatory exposure |
| **P1** | §3 bugs 2–7: payout reference, webhook idempotency, status vocabulary, rounding, take-back race | Money correctness |
| **P1** | §4 W6–W11: POPIA consent, VAT and invoices, CPA s56, Terms acceptance at checkout and Google sign-up | Legal compliance |
| **P1** | §2 D4: one migrations source, baseline from prod | Without it, a rebuilt or new environment is less secure than prod |
| **P2** | §3 provider-agnostic payments refactor | Lets you switch providers by config |
| **P2** | §5 transition tables, money-route tests, Sentry, zod, lint in CI | Stops regressions |
| **P3** | §6 logistics abstraction, then one pickup partner | New capability, built on the stable base above |
| **P3** | §4 medium items, missing pages, docs drift | Polish and completeness |
