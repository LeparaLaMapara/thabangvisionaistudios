# Risk register

Severity levels: P0 = critical security or financial exposure · P1 = core function broken · P2 = misrepresentation or a serious usability problem.

| # | Risk | Sev | Phase 0 action | Residual risk |
|---|---|---|---|---|
| R-1 | Other apps share prod `auth.users` and hold the prod service-role key | P0 | Isolation planned (`database-isolation.md`) | **Open: BLOCKED** until the new organisation is accessible |
| R-2 | Users can write privileged profile and banking columns (verification evidence, recipient code, `is_verified`) | P0 | Migration 067: per-column grants, triggers, audit log | Closed in code; **prod migration pending** founder approval |
| R-3 | Client-supplied subscription price | P0 | Server-side plan resolution, guarded activation | Closed in code; live Paystack not tested |
| R-4 | Wrong Paystack host (`api.paystack.com`) and Nigerian recipient type (`nuban`) | P0/P1 | Fixed; regression test | Live Paystack call not tested from the sandbox |
| R-5 | Verification storage overwrite | P0 | UPDATE policy dropped; unique paths; uploads via service role | Prod migration pending |
| R-6 | VAT charged or shown while not registered | P2/legal | Tax core returns 0; copy removed | None once deployed |
| R-7 | Pages for cities not served; nationwide claims | P2 | 308 redirects; sitemap and structured data | Search engines re-crawl over time |
| R-8 | Legal pages not reviewed by an attorney | P2/legal | Drafts plus the legal-review checklist | **Open: REQUIRES_LEGAL_REVIEW** |
| R-9 | Webhook replay and out-of-order events; double refunds; take-back race | P0 | Not in Phase 0 scope | Phase 1: inbox, refund obligations, guarded transitions. Closed in code; **open until 070 is applied** (R-14) and a test-mode run is done (R-15) |
| R-10 | Gear can be double-booked (`return_pending`/`disputed` don't hold stock) | P1 | Not in Phase 0 scope | Phase 1: `reserve_rental_order` under a row lock; unreturned gear blocks open-endedly. Closed in code; **open until 070 is applied** (checkout falls back to the racy insert without it) |
| R-11 | Creator and gear-owner payouts blocked or missing | P1 | Recipient type fixed | Phase 1: `PayoutPort`, owner payouts, manual approval. Open until 070 is applied and a test-mode transfer is done. Owners without an SA ID and personal account cannot be validated (D-23) |
| R-12 | Ubunye can create bookings without a code-enforced approval | P0 | Booking agent now says "reserved" | **Open:** Phase 2 approval tokens |
| R-13 | The e2e test password is committed in the repo | P1 | Noted | Rotate during key rotation (`database-isolation.md` §4.7) |

## Phase 1 risks (2026-10-08)

| # | Risk | Sev | Phase 1 action | Residual risk |
|---|---|---|---|---|
| R-14 | Migration 070 is not applied anywhere. Without it, every Phase 1 path silently falls back to the pre-Phase-1 behaviour: racy checkout, no inbox, no obligations, no ledger | P0 | Fallbacks keep the site working. 070 verified on local PostgreSQL 16 only | **Open:** apply on DEV, run `070-gear-pipeline.test.sql` and `scripts/db/070-concurrency.sh`, then production after approval (`docs/security/phase-1-db-evidence.md`) |
| R-15 | Paystack payload shapes are unverified: refund webhook fields, refund and transfer responses, Transfer Approval request and response codes, `/bank/validate` document types | P1 | Defensive parsing. Unknown outcomes are reconciled before any retry | **Open:** NEEDS TEST-MODE VERIFICATION. Do not enable the Transfer Approval URL live before it |
| R-16 | Only daily crons are allowed: retries, hold expiry sweep, refund/payout progress, overdue stages and reminders run once a day | P2 | Webhook, checkout and admin actions act immediately. Expired holds stop blocking stock at once. "Run pipeline now" in Rental ops | **Open:** up to about 24h latency on retries and escalations. A plan upgrade unlocks sub-daily runs (CLAUDE.md) |
| R-17 | The Playwright payment E2E (desktop and mobile) and the full Paystack test-mode journey have not run | P1 | Unit tests with in-memory adapters; SQL tests on local PostgreSQL | **Open:** both NOT RUN |
| R-18 | Manual EFT/cash payments and their refunds are outside the ledger (no intent, no journal) | P1 | Recorded as `manual:<method>:<ref>`. Detectors ignore them by design | **Open:** reconcile by hand against the bank statement |
| R-19 | A missed webhook is not recovered automatically: `PaymentPort.verifyCharge` exists but no job calls it | P1 | `recoverMissedPayments` (daily pipeline, and Rental ops "Run pipeline") asks Paystack about recent unpaid intents and confirms through the same use case | **Mitigated:** recovery is daily unless staff run it; not verified against live Paystack |
| R-20 | Rental ops **Retry** on a refund with a provider refund id (for example, a provider `needs-attention`) submits a second request instead of reconciling. The UI hint says it always reconciles | P1 | Retry now lists the provider's refunds for the charge first and refuses to resend one the provider already holds (`ALREADY_AT_PROVIDER`) | **Fixed in code;** not verified against live Paystack |
| R-21 | Resolving a gear dispute closes the booking without `hire_earned`/`deposit_settled` journals or an owner payout | P1 | `settleDisputedReturn` settles a disputed return in one transaction (journal, line-scoped refund, owner payout). A refund on any other gear dispute is refused (`REFUND_NEEDS_A_PERSON`) | **Fixed in code** with the D-19 default rules; the founder still confirms D-19 |
| R-22 | A card payment that arrives after staff marked the order paid by hand is treated as a duplicate: no journal, no alert | P1 | `decideCharge` now holds it (`hold_mismatch` → `mismatch` intent, unallocated receipt, staff alert); staff refund it from Rental ops | **Fixed in code** |
| R-23 | Two lines of one order cancelled by the customer at the same instant: each sees the other still open, so neither refunds the delivery fee, which stays in `unearned_hire` | P3 | The closed-order reconciliation (invariants sweep) reports the order as `rental-ledger-unreconciled`; staff refund the fee by hand | **Open (accepted):** needs both cancellations within the same moment |
| R-24 | Codex review hit its usage limit before reviewing the final commits of PR #59 | P2 | Two independent adversarial reviews (money; state, access and SQL) were run on the full diff instead; every confirmed finding was fixed | **Open:** run a Codex review again when the limit resets |
