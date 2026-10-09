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
| D-19 | What triggers an owner payout hold or a dispute escalation; the money outcome of a resolved dispute | REQUIRES_FOUNDER_APPROVAL (default implemented) | Phase 1. Holds: any open dispute on the booking holds its payout (`evaluatePayout`), and auto-approval is off. Resolved gear disputes are settled by `disputeMoney`. Full refund: everything charged comes back and nothing is earned. Partial: the stated amount comes back, deposit first, then hire. Deposit forfeit: a person keeps the deposit and the hire is earned. Anything else: the deposit is refunded in full and the hire is earned. The owner is paid 80% of the hire kept |
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

## Phase 2 decisions (2026-10-09)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-27 | When may a community owner's listing go live without an admin review ("established owner")? | REQUIRES_FOUNDER_APPROVAL | Placeholder: at least 3 live reviewed listings and 5 completed hires by other people. First listings, high-value items and everyone else go to admin review | `LISTING_POLICY` in `lib/constants.ts`, `lib/core/listings/review.ts` |
| D-28 | Applying migration 072 takes community listings that went live before review offline (`pending_review`) until an admin reviews them and the owner adds a replacement value | REQUIRES_FOUNDER_APPROVAL (before 072 reaches production) | Implemented in the 072 backfill. Reviewed, submitted and studio listings stay live. The rows taken offline can be listed and restored (rollback notes in 072) | `lib/migrations/072-listing-review.sql`, `docs/marketplace/listings.md` |
| D-29 | Creative services: revisions included, decline and payout timing | REQUIRES_FOUNDER_APPROVAL (defaults implemented) | 1 revision by default. A creator's decline refunds the client in full and the client rebooks. Once work is delivered, the client cannot cancel (a dispute instead). Payout is due 72 hours after acceptance and is sent by the daily job, so up to about a day later. A validated bank account and a verified creator are required. Failed or reversed payouts, and refunds whose outcome the provider left unclear, go to a person | `STUDIO.booking.defaultRevisionsIncluded`, `payoutDelayHours`, `lib/core/services/*`, `docs/marketplace/services.md` |
| D-30 | Ubunye for signed-out visitors | REQUIRES_FOUNDER_APPROVAL | 5 messages per guest (browser count), and at most 60 a day per network address across everyone on it. Signed-out visitors cannot prepare bookings | `STUDIO.ai.guestNetworkDailyMessages`, agent `rateLimit.guest` |
| D-31 | Listing photos published before the photo-copy change keep their original upload, which can contain GPS location | REQUIRES_FOUNDER_APPROVAL | New submissions are re-uploaded from a metadata-stripped copy and the listing points at the copy. Originals are not deleted, because the server cannot prove who uploaded an asset. Closing it fully needs a provider-side setting (strict transformations) or a one-off clean-up by a person | `app/api/listings/_lib/images.ts`, `docs/marketplace/listings.md` |

## Phase 3 decisions (2026-10-09)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-32 | Phone verification is required before a first hire, but phone checks only work when the SMS gateway is configured (`SMS_PROVIDER=smsgate` and `SMSGATE_*`) | BLOCKER: REQUIRES_FOUNDER_APPROVAL (configure SMS, or change the rule) | The rule is unchanged. Without SMS, nobody reaches the tier needed to rent. The checklist and the profile phone step say so and give the contact details | `lib/core/rental/trust.ts`, `app/api/phone/send`, `components/profile/PhoneCheck.tsx` |
| D-33 | Creators set an `hourly_rate`, but service bookings are charged the category rate from `PRODUCTION_SERVICES` | REQUIRES_FOUNDER_APPROVAL | Unchanged: clients pay the category rate. What a creator shows as their rate is not what a client pays | `lib/supabase/queries/service-bookings.ts` `getHourlyRate`, `app/api/service-bookings/route.ts` |
| D-34 | Terms acceptance at sign-up: an explicit "I agree, continue" button (no checkbox) | REQUIRES_LEGAL_REVIEW | One tap records acceptance of the current Terms and Privacy versions; nothing is recorded without it. Checkout still requires its own acceptance | `components/consent/OnboardingAcceptance.tsx`, `app/auth/callback/route.ts` |
| D-35 | A creator becomes available for hire with a saved payout account; gear listings need a validated one | REQUIRES_FOUNDER_APPROVAL | Unchanged rules, now shown on the creator's checklist | `app/(platform)/dashboard/profile/page.tsx`, `lib/creators/bookable.ts` |
| D-36 | How long funnel metrics are kept | REQUIRES_FOUNDER_APPROVAL (default 180 days) | Funnel events (ids and codes only) are deleted after `STUDIO.analytics.funnelRetentionDays` by the daily job | `lib/constants.ts`, `app/api/cron/daily-maintenance/route.ts` |

Superseded by Phase 1 (no longer enforced at checkout):

- `STUDIO.rental.protection.trustTiers` (the R5k/R20k/R60k ladder by clean returns) is replaced by `RENTAL_POLICY.trustTierLimitsCents` (R2k/R10k/R25k/R80k).
- `STUDIO.rental.protection.collectionOnlyAboveValue` (an order-level R20k) is replaced by `RENTAL_POLICY.highValueCollectionThresholdCents` (any single item over R50k) plus `firstHireCollectionOnly`.
