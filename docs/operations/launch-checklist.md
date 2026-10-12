# Launch checklist: today → live

One ordered list, founder-facing. Do the steps in order; each says **who**,
**how**, **how to verify** and **rollback**. Production stays in maintenance
mode (C-7) until the last step, so nothing before it is visible to customers.

Who: **F** = founder (dashboard access, money, approvals). **E** = engineer
(anyone with the repo and `psql`). Dashboards: Vercel → the ThabangVision
project; Supabase → the DEV project or the PRODUCTION project (never mix them
up: check the project ref in the URL before every SQL step).

Why this order: migrations 067 and 077 need the matching app build deployed
**first** in that environment (docs/database/README.md), so each environment
gets "app, then migrations". Production gets the new app by the
develop → main merge (step 8) while still in maintenance mode, and its
migrations right after (step 9).

---

## 1. Vercel environment variables (F)

Vercel → Project → Settings → Environment Variables. Every variable has
**Production / Preview / Development** tick boxes: set each one for the right
environment. `develop` deploys to **Preview** (dev Supabase), `main` to
**Production**.

| Variable | Preview (develop) | Production (main) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | DEV project | PRODUCTION project |
| `NEXT_PUBLIC_APP_URL` | the stable develop URL (`https://<project>-git-develop-<team>.vercel.app`), no trailing slash | the public `https://www.…` domain |
| `PAYMENT_PROVIDER` | `paystack` | `paystack` |
| `PAYSTACK_SECRET_KEY` / `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | `sk_test_…` / `pk_test_…` | test keys until step 10, then `sk_live_…` / `pk_live_…` (production **refuses** test keys: payments show as closed) |
| `PAYMENTS_OFF` | unset | unset (with test keys, production shows payments closed anyway until step 10) |
| `MAINTENANCE_MODE`, `MAINTENANCE_BYPASS_TOKEN` | unset | `true` and a long random token until step 12 |
| `CRON_SECRET`, `AGENT_APPROVAL_SECRET`, `PHONE_CODE_SECRET`, `CONSENT_IP_HASH_SECRET`, `SIGNUP_WEBHOOK_SECRET` | own random values | **different** random values (`openssl rand -hex 32`) |
| `EMAIL_PROVIDER=gmail`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` | set (needed for the email check in step 6) | set |
| `STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | set | set |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY` | set | set |
| `SMS_PROVIDER=smsgate`, `SMSGATE_USERNAME`, `SMSGATE_PASSWORD` | step 5 | step 5 |
| `SEARCH_PROVIDER=supabase`, `RAG_ENABLED=false` | set | set |

Vercel → Settings → Build and Deployment (older UI: General) → Node.js Version: **20.x or later** (nodemailer
10 needs Node ≥ 20, D-79).

**Known issue:** the preview still reports payments closed. Payments are open
when the provider's `isConfigured()` is true (`lib/payments/status.ts`): for
Paystack, `PAYSTACK_SECRET_KEY` is set, `PAYMENTS_OFF` is not `true`, and the
key is not a test key on Production. Most likely `PAYSTACK_SECRET_KEY` (or
`PAYMENT_PROVIDER`) is ticked for Production only: tick **Preview** too, or
remove a `PAYMENTS_OFF=true` that is ticked for Preview.

- **Verify:** Deployments → the latest develop deployment → **Redeploy**
  (env changes only apply to new deployments). On the preview, the home page
  and `/legal` no longer say online payment is not open yet.
- **Rollback:** edit the variable back and redeploy.

## 2. Deploy the app to the preview (F merges, E prepares)

Merge the open PR(s) into `develop` on GitHub. CI now runs on PRs into
`develop` (build, unit tests, security checks, database rebuild + SQL tests):
merge only when green.

- **Verify:** Vercel → Deployments shows a Ready deployment for `develop`.
  If no deployment appears at all, check `vercel.json` crons are still daily
  (CLAUDE.md "Cron Jobs").
- **Rollback:** Vercel → Deployments → previous develop deployment →
  **Promote** / redeploy it, or revert the merge on GitHub.

## 3. Migrations 067 → 080 on DEV (E, F watches)

The full procedure, with the per-migration notes, is
[docs/database/README.md "Applying migrations to dev or production by hand"](../database/README.md#applying-migrations-to-dev-or-production-by-hand).
Summary:

```bash
export DB='postgresql://…'   # Supabase DEV → Project Settings → Database → Connection string (URI)
pg_dump "$DB" -Fc -f dev-before-067.dump                       # snapshot first; keep the file
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -f "lib/migrations/$1"; }   # stop at the first failure

run 067-lock-sensitive-columns.sql   && run 067-lock-sensitive-columns.test.sql
run 068-consent-records.sql          && run 068-consent-records.test.sql
run 069-subscription-expected-price.sql
run 070-gear-pipeline.sql            && run 070-gear-pipeline.test.sql
DATABASE_URL="$DB" scripts/db/070-concurrency.sh                # DEV only (refuses production)
run 071-provider-neutral-payments.sql && run 071-provider-neutral-payments.test.sql
run 072-listing-review.sql           # its test runs after 077 (its empty-claims check needs 077's is_admin())
run 073-service-fulfilment.sql       && run 073-service-fulfilment.test.sql
run 074-agent-actions.sql            && run 074-agent-actions.test.sql
run 075-public-profiles-mask-unverified-portfolio.sql && run 075-public-profiles-mask-unverified-portfolio.test.sql
run 076-delivery.sql                 && run 076-delivery.test.sql
psql "$DB" -X -f scripts/db/precheck-077.sql > precheck-077.out    # read-only; read every STOP note first
run 077-database-integrity.sql       && run 077-database-integrity.test.sql   # keep the NOTICE output
run 072-listing-review.test.sql      # deferred from above
run 078-ubunye-usage-reserve.sql     && run 078-ubunye-usage-reserve.test.sql
run 079-security-phase-6.sql         && run 079-security-phase-6.test.sql   # on a hosted project check B2 passes
run 080-owner-pickup.sql             && run 080-owner-pickup.test.sql       # Phase 8: collection from the owner's address
run rls-coverage.test.sql
```

Run the lines one at a time and stop at the first error (do not "fix
forward" by hand). The same order is proven on every PR by the CI
`database` job, and locally by `scripts/db/rebuild-local.sh` +
`scripts/db/run-sql-tests.sh`.

- **Verify:** every `*.test.sql` ends without `ERROR` and prints its `PASS`
  notices; keep all output (and `precheck-077.out`) in
  [phase-0](../security/phase-0-db-evidence.md) /
  [phase-1](../security/phase-1-db-evidence.md) evidence. Then click through
  the preview: sign in, browse, admin pages.
- **Rollback:** each migration is one transaction, so a failure leaves that
  file unapplied. To undo applied ones: Supabase DEV → Database → Backups
  (restore) or `pg_restore --clean -d "$DB" dev-before-067.dump`.

## 4. Supabase Auth settings, DEV then PRODUCTION (F)

Supabase → Authentication:

- **Emails → Templates → "Magic Link" and "Confirm signup":** include the
  6-digit code, e.g. `Your code: {{ .Token }}`, next to the existing link
  (R-33).
- **Sign In / Providers → Email → Minimum password length: 8** (R-33).
- **URL Configuration:** Site URL = that environment's `NEXT_PUBLIC_APP_URL`;
  Redirect URLs include it with `/**`.
- **JWT expiry (R-81, suggestion):** Project Settings → JWT Keys (older
  dashboards: Settings → API → JWT Settings) → access-token expiry
  **1800 s** (default 3600). Shortens how long a demoted or suspended user's
  existing token still works at the database. Optional.
- **Verify:** sign up with a new address on the preview: the email shows a
  code and the code signs you in; a 7-character password is refused.
- **Rollback:** restore the previous template text / values.

## 5. SMS gateway (F) — D-32, blocks first hires

Phone verification is required before a first hire and only works with an SMS
gateway. Either configure it or change the rule (decision D-32).

1. Install **SMS Gateway for Android** (github.com/capcom6/android-sms-gateway)
   on a phone with an SA SIM and an SMS bundle; in the app, enable the cloud
   server and note the username and password.
2. Vercel (Preview and Production): `SMS_PROVIDER=smsgate`,
   `SMSGATE_USERNAME`, `SMSGATE_PASSWORD` (`SMSGATE_URL` only if you self-host
   the relay). Redeploy.

- **Verify:** on the preview, Profile → phone check → the code arrives by SMS
  and is accepted.
- **Rollback:** unset `SMS_PROVIDER` (defaults to `log`: nothing is sent and
  phone checks count as not configured).

## 6. Paystack test mode on the preview (F, E assists)

Paystack dashboard in **Test Mode** → Settings → API Keys & Webhooks:
test webhook URL = `<preview NEXT_PUBLIC_APP_URL>/api/webhooks/paystack`.
If the preview has Vercel Deployment Protection on, Paystack's webhook is
blocked: use Vercel's "Protection Bypass for Automation" or switch protection
off for the test. **Do not set a Transfer Approval URL** (R-15).

Run on the preview with Paystack's test cards
(https://paystack.com/docs/payments/test-payments), and check each item of
[payment-lifecycle.md "Needs test-mode verification"](../payments/payment-lifecycle.md#needs-test-mode-verification):

1. Rent a gear item → pay with a test card → booking shows paid; in DEV SQL:
   `select * from rental_payment_intents order by created_at desc limit 1;`
   and the matching `payment_events` row.
2. Paystack → Transactions → the payment → **Resend webhook** twice →
   still one payment, nothing doubled (R-9).
3. Renter cancels within the refund window → refund created → refund
   webhook arrives → `refund_obligations` row settles.
4. Book a creator (service booking) → pay → creator delivers → client
   approves → after the payout delay, admin approves the payout in
   `/admin/rental-ops` → test transfer and its webhook (needs a test
   transfer recipient).
5. Banking: add a payout account → note which `/bank/validate` document
   types Paystack accepts (D-23).
6. One real email arrives (contact form or a booking email): confirms
   nodemailer 10 on Vercel (D-79).

- **Verify:** every step as described; record findings in R-15 and the
  payment docs.
- **Rollback:** none needed (test mode). Remove the test webhook URL after.

## 7. Founder decisions still open (F)

From [decision-register.md](../implementation/decision-register.md), every
row still `REQUIRES_FOUNDER_APPROVAL`. Most have a safe default already in
the code; **bold** ones block launch or a migration.

| ID | Decision |
|---|---|
| D-1 | Is the Pretoria studio operational and hireable? |
| **D-4** | Approved address for legal notices (domicilium) |
| D-6 | Is there an in-house production team? |
| D-10 | Which service packages and deliverables are genuine |
| **D-13** | Final cancellation and late-fee policy |
| D-15 | Insurance position for company and community gear |
| D-17 | Verification evidence for high-value listings |
| D-18 | Who bears refund and payout fees |
| D-19 | Payout holds, dispute escalation, money outcome of a dispute (default in code) |
| D-21 | Same-day turnaround of returned gear |
| D-22 | "Qualifying history" for the Proven and Trusted tiers |
| D-23 | Validated bank account for the Verified tier (plus document types, step 6) |
| D-24 | Auto-approve owner payouts that pass every check (off) |
| **D-25** | Late fee amount (pending D-13) |
| D-26 | Re-enable "deposit online, hire at the counter" (off) |
| D-27 | When an owner's listing may skip admin review |
| **D-28** | 072 takes unreviewed community listings offline: approve **before step 9** |
| D-29 | Creative services: revisions, decline, payout timing (defaults in code) |
| D-30 | Ubunye limits for signed-out visitors |
| D-31 | Older listing photos may still carry GPS data |
| **D-32** | SMS gateway or change the phone-check rule (step 5) |
| D-33 | Creator `hourly_rate` vs the category rate actually charged |
| D-35 | Payout account needed to be hireable / to list gear |
| D-36 | Funnel metric retention (180 days) |
| D-37 | Max item value for third-party couriers (0: off) |
| D-38 | Platform fee on courier legs (0) |
| D-39 | Who pays a courier cancellation fee |
| D-40 | Goods-in-transit cover for our own vehicle |
| D-41 | Courier goods-in-transit policy (blocks courier delivery only) |
| D-42 | Rental period start/end with delivery |
| D-43 | Who confirms receipt of a delivery |
| D-44 | Courier return of collect-in-person gear (not offered) |
| D-45 | When a delivery fee is earned (accounting) |
| D-46 | Retention of delivery addresses and driver details (+ POPIA review) |
| D-47 | How couriers are paid |
| D-48 | Deemed acceptance of a delivery (48 h) |
| D-49 | When lateness ends on a return pickup |
| D-50 | Dispatch of delivery paid by hand |
| D-51 | Who attributes a delay to the provider |
| D-52 | Paid delivery fee whose leg can never run (accounting) |
| D-53 | Staff cancel after delivery reached the renter (accounting) |
| D-54 | Closing a delivery review as delivered after a reported problem |
| D-55 | Who ends the renter's possession on a return |
| D-56 | Delivery fee refunded before it was earned (accounting) |
| D-57 | Staff cancel while a return pickup is scheduled |
| D-58 | Delivery legs on orders cancelled under the legacy money rules |
| D-61 | Who appears in the public directory |
| D-62 | What an ID approval switches on |
| D-65 | Non-creators the old approval made hireable (query in docs/database/README.md) |
| **D-66** | Database isolation plan A or B (R-1; BLOCKED on access) |
| D-69 | Which hourly rate a client pays for a creator |
| D-70 | Response time for problem reports |
| D-71 | Unpaid shoot bookings ("Waiting for payment") |
| D-72 | Telling an owner when their gear is booked |
| D-75 | Email to a client who cancels a shoot |
| D-76 | Return cut-off for collected gear |
| **D-78** | `ADMIN_EMAILS` break-glass, and 2FA for admins |

- **Verify:** each decision row updated in the register (status + date).

## 8. Merge develop → main (F)

Only after steps 1–7. Production is still in maintenance mode.
GitHub → New PR `develop` → `main` → CI green → merge.

- **Verify:** Vercel → Production deployment Ready; `https://www.…` shows
  the maintenance page; `https://www.…/?preview=<MAINTENANCE_BYPASS_TOKEN>`
  shows the real site for you.
- **Rollback:** Vercel → Deployments → the previous production deployment →
  **Promote to Production** (instant), then revert the merge.

## 9. Migrations 067 → 080 on PRODUCTION (E runs, F approves)

Exactly step 3 with `DB` set to the PRODUCTION connection string (check the
project ref), **without** `070-concurrency.sh` (DEV only), after D-28 is
approved and the production app from step 8 is live (067 and 077 need it;
080 must be applied with the Phase 8 build, which reads `origin_owner_id`:
apply 080 in the same window as the deploy, and before any owner opts in).
Off-peak. Name the dump `prod-before-067.dump`.
On production, `083-prerelease-fixes.sql` runs FIRST, before 067; the exact
order, env vars and smoke test are in
[docs/release/2026-10-apply-order.md](../release/2026-10-apply-order.md).
Production is shared with other apps (R-1): read `precheck-077.out` with
care and keep 077's NOTICE output.

- **Snapshot:** Supabase PRODUCTION → Database → Backups: confirm a backup
  from today exists (or create one), **and**
  `pg_dump "$DB" -Fc -f prod-before-067.dump`.
- **Verify:** all tests pass as on DEV; with the bypass cookie: sign in,
  admin pages, a gear page, Ubunye.
- **Rollback:** stop at the failing file (it is not applied). For a wider
  problem: keep maintenance on, restore from the backup / dump, and promote
  the previous app deployment.

## 10. Live keys (F)

Paystack dashboard in **Live Mode** → API Keys & Webhooks: live webhook URL
= `https://www.…/api/webhooks/paystack`. Vercel **Production only**:
`PAYSTACK_SECRET_KEY=sk_live_…`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_live_…`,
remove `PAYMENTS_OFF`. Redeploy production. Leave Preview on test keys.

- **Verify:** with the bypass cookie, the payment-closed notices are gone.
- **Rollback:** set `PAYMENTS_OFF=true` and redeploy (payments close at
  once; test keys do not work on production by design).

## 11. One small live payment and refund (F)

With the bypass cookie: rent the cheapest item for one day with your own
card → paid → cancel → refund. Check Paystack Live → Transactions shows the
charge and the refund, and the booking and `refund_obligations` row in
production agree. If anything differs, go back to step 10's rollback.

## 12. Switch off maintenance mode (F)

Vercel Production: set `MAINTENANCE_MODE=false` (or delete it) → Redeploy.

- **Verify:** the site loads for a fresh browser without the token;
  `/robots.txt` and the sitemap load; one sign-up end to end.
- **Rollback:** `MAINTENANCE_MODE=true` → Redeploy (webhooks and crons keep
  working while it is on).
