# Decision register

Statuses: CONFIRMED · NEEDS_VERIFICATION · BLOCKED · REQUIRES_LEGAL_REVIEW · REQUIRES_FOUNDER_APPROVAL · NOT_SUPPORTED

## Confirmed decisions (2026-10-08)

| # | Decision | Status | Where encoded |
|---|---|---|---|
| C-1 | Service area: Gauteng; travel outside Gauteng quoted separately | CONFIRMED | `STUDIO.serviceArea` |
| C-2 | Not VAT-registered | CONFIRMED | `STUDIO.legal.vatRegistered=false`, `STUDIO.legal.tax` |
| C-3 | Deposit = 25% of replacement value, charged with the hire and refunded after inspection | CONFIRMED | `RENTAL_POLICY.depositRateBps` |
| C-4 | Community gear: owner 80% / platform 20% of the hire; deposit excluded | CONFIRMED | `RENTAL_POLICY` |
| C-5 | First hire always collected in person; any item over R50k always collected in person | CONFIRMED | `RENTAL_POLICY` |
| C-6 | Owner payout 48h after a clean completion | CONFIRMED | `RENTAL_POLICY.ownerPayoutDelayHours` |
| C-7 | Production stays in maintenance mode; no merge to `main` without approval | CONFIRMED | — |

## Open questions (spec §13)

| # | Question | Status | Blocks |
|---|---|---|---|
| D-1 | Is the Pretoria studio operational, and can customers hire it? | REQUIRES_FOUNDER_APPROVAL | Locations copy (shows "by appointment" only) |
| D-2 | Verified collection address: "Smith" or "Smit" Street, Braamfontein | NEEDS_VERIFICATION | Address text (left unchanged) |
| D-3 | Which registered company details must appear publicly | REQUIRES_LEGAL_REVIEW | ECTA s43 page |
| D-4 | Approved address for legal notices (domicilium) | REQUIRES_FOUNDER_APPROVAL | Terms |
| D-5 | Which equipment categories are actually stocked | NEEDS_VERIFICATION | Category pages |
| D-6 | Is there an in-house production team? | REQUIRES_FOUNDER_APPROVAL | About/team copy (removed until confirmed) |
| D-7 | Which AI providers are active in production | NEEDS_VERIFICATION | Privacy/Terms AI disclosure (currently generic) |
| D-8 | Is Yoco integrated or only approved as a merchant? | NEEDS_VERIFICATION | Payment-provider disclosure |
| D-9 | Is an SMS provider active? | NEEDS_VERIFICATION | Notifications (Phase 1) |
| D-10 | Which service packages and deliverables are genuine | REQUIRES_FOUNDER_APPROVAL | Package pages, "from" prices |
| D-11 | Which social media profiles are active | NEEDS_VERIFICATION | Footer links |
| D-12 | Which business mailboxes have been tested | NEEDS_VERIFICATION | Contact addresses |
| D-13 | Final cancellation and late-fee policy | REQUIRES_FOUNDER_APPROVAL | Phase 1 |
| D-14 | Retention policy for identity data and chat history | REQUIRES_LEGAL_REVIEW | Privacy page |
| D-15 | Insurance position for company-owned and community gear | REQUIRES_FOUNDER_APPROVAL | Phase 1/4; no insurance claims are made |
| D-16 | Legal merchant of record for marketplace transactions | REQUIRES_LEGAL_REVIEW | Phase 2 |
| D-17 | Verification evidence required for high-value listings | REQUIRES_FOUNDER_APPROVAL | Phase 2 |
| D-18 | Refund and payout fees: does the platform or the owner bear them? | REQUIRES_FOUNDER_APPROVAL | Phase 1 payouts |
| D-19 | What triggers an owner payout hold or a dispute escalation | REQUIRES_FOUNDER_APPROVAL | Phase 1 |
| D-20 | Procedure for separating the production database; where the Observatory goes | BLOCKED | `docs/operations/database-isolation.md` |

## Phase 1 decisions (2026-10-08)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-21 | Same-day turnaround: may gear returned on a day be hired out again that day? | REQUIRES_FOUNDER_APPROVAL | Dates are inclusive. Gear is due back by the end of its end date (SAST), and that day is not resold | `rental_units_blocked` (070), `lib/core/rental/overdue.ts` `returnDueAt` |
| D-22 | What counts as "qualifying history" for the Proven and Trusted tiers | REQUIRES_FOUNDER_APPROVAL | Days are counted from the renter's **first clean return**: completed, on time, no damage, no dispute. Nothing may currently count against them (open dispute, escalated overdue gear, fraud flag, suspension). Proven = 1 clean return + 14 days. Trusted = 5 clean returns + R50,000 returned clean + 90 days | `lib/core/rental/trust.ts`, `RENTAL_POLICY.trustThresholds` |
| D-23 | Is a validated bank account required for the renter Verified tier, and which `/bank/validate` document types are accepted? | NEEDS_VERIFICATION (document types); REQUIRES_FOUNDER_APPROVAL (the requirement) | Verified (R10,000) needs an approved ID+selfie review **and** `banking_details.is_verified`. `POST /api/banking` validates only personal accounts with a 13-digit SA ID number (`document_type = identityNumber`), when the holder name matches the verified profile. Passport and business-registration types are in the port but not offered. There is no manual-review path yet | `lib/core/rental/trust.ts`, `app/api/banking/route.ts`, `lib/payments/paystack-ports.ts` |
| D-24 | Should owner payouts that pass every automatic check be approved automatically? (see D-19) | REQUIRES_FOUNDER_APPROVAL | OFF. Staff approve each payout in `/admin/rental-ops`, and approval re-runs every check | `RENTAL_POLICY.payoutAutoApprove = false` |
| D-25 | Late fee | REQUIRES_FOUNDER_APPROVAL (pending D-13) | Unchanged from before Phase 1: R150 per item per started day after the return day, at most 14 days, never more than the deposit | `RENTAL_POLICIES.lateFeePerDayZar`, `RENTAL_POLICIES.maxLateDays`, `lib/rental/late-fee.ts` |
| D-26 | Pay the deposit online and the hire at the counter ("deposit only") | CONFIRMED off by spec §3.3 / REQUIRES_FOUNDER_APPROVAL to re-enable | Switched off in Phase 1. The counter payment was never recorded, so an owner payout could be scheduled for money never collected. Older deposit-only orders get no automatic hire journal or payout; staff are alerted. Re-enable only with a recorded, reconciled counter payment | `STUDIO.fulfilment.collection.allowBalanceOnCollection = false` |

Superseded by Phase 1 (no longer enforced at checkout):

- `STUDIO.rental.protection.trustTiers` (the R5k/R20k/R60k ladder by clean returns) is replaced by `RENTAL_POLICY.trustTierLimitsCents` (R2k/R10k/R25k/R80k).
- `STUDIO.rental.protection.collectionOnlyAboveValue` (an order-level R20k) is replaced by `RENTAL_POLICY.highValueCollectionThresholdCents` (any single item over R50k) plus `firstHireCollectionOnly`.
