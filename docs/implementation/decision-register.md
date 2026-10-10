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

## Phase 4 decisions (2026-10-09, delivery core)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-37 | Highest single-item replacement value an automated (third-party) courier may carry | REQUIRES_FOUNDER_APPROVAL | **0: automated courier delivery is off for every item.** Own-vehicle delivery is unaffected and follows the existing rules (first hire and items over R50,000 collected in person, trust limits) | `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents`, `lib/core/delivery/policy.ts` |
| D-38 | Platform fee added to a courier's price per leg | REQUIRES_FOUNDER_APPROVAL | 0. Customer fee = provider cost + this fee, stored apart. Own fleet: the own-vehicle formula is the customer price (no fee). Never part of the owner's 80% share | `DELIVERY_POLICY.platformFeeCents`, `lib/core/delivery/quote.ts` |
| D-39 | Who pays a courier's cancellation fee | REQUIRES_FOUNDER_APPROVAL | Renter cancels after a courier is booked: the provider's fee is passed on at cost, capped at the delivery fee paid. We or the provider cancel, or dispatch fails: full refund of the delivery fee, we absorb any fee | `DELIVERY_POLICY.passOnProviderCancellationFee`, `cancelDelivery` |
| D-40 | Goods-in-transit cover for our own vehicle | REQUIRES_FOUNDER_APPROVAL | None verified. Own-vehicle delivery continues as before; each own-fleet shipment records `coverage_verified = false` | `DELIVERY_POLICY.ownFleet.verifiedTransitCover`, `lib/delivery/manual.ts` |
| D-41 | A verified goods-in-transit policy for couriers (rented and community-owned camera gear, theft and damage in transit, loading, both legs, subcontracted drivers) | BLOCKER for courier delivery: REQUIRES_FOUNDER_APPROVAL + written insurer confirmation | No policy: every courier is "not covered" and excluded, whatever its price | `DELIVERY_POLICY.insurance`, `policyInsurance()` in `lib/delivery/ports.ts` |
| D-42 | When the rental period (and the renter's custody) starts and ends with delivery | REQUIRES_FOUNDER_APPROVAL | Unchanged: the period is the booked dates (date-based), as for collection. Custody events are recorded but do not move the period. The hire becomes active through the existing handover flow | `docs/logistics/delivery-architecture.md` |
| D-43 | Who confirms receipt of a delivery | REQUIRES_FOUNDER_APPROVAL | Only the booking's renter, signed in, accepts each item. Staff can record an exception for them, never an acceptance. PIN and signature capture are not built | `lib/core/delivery/custody.ts` |
| D-44 | Return by courier of gear that had to be collected in person (first hire, items over R50,000) | REQUIRES_FOUNDER_APPROVAL | Not offered: the return leg applies the same rules | `checkDeliveryEligibility` |
| D-45 | When a Phase 4 delivery fee is earned | REQUIRES_FOUNDER_APPROVAL (accounting) | Per leg: outbound when the renter accepts every item; return when every item is received back. With an exception, a person decides. Pre-Phase-4 own-vehicle fees are unchanged (earned when the hire completes, key `delivery:{group}`) | `deliveryEarned`, `confirmHandover` |
| D-46 | How long delivery addresses and driver contact details are kept | REQUIRES_FOUNDER_APPROVAL + legal review (POPIA) | 180 days after the leg closes (constant only; the purge job is not built, R-41) | `DELIVERY_POLICY.addressRetentionDays` |
| D-47 | How couriers are paid (provider balance, bank, monthly invoice) | REQUIRES_FOUNDER_APPROVAL | Courier costs are booked as `courier_costs` against `delivery_payable`; paying the provider is not booked yet | `courierCost` in `lib/core/rental/ledger.ts` |

### Phase 4 review fixes (2026-10-09)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-48 | Deemed acceptance: what happens when the renter neither accepts a delivered item nor reports a problem | REQUIRES_FOUNDER_APPROVAL (default 48 hours) | The renter is reminded once (`delivery_delivered`, 24 h before the deadline, on an earlier daily run than the deadline); after `deemedAcceptanceHours` from the recorded delivery the system records `deemed_accepted` per item. It counts as acceptance for earning the outbound fee, settlement and address retention. Never over a reported exception or an open incident; never for a return leg (receipt and inspection still needed, D17). Refines D-43/D-45 | `DELIVERY_POLICY.deemedAcceptanceHours`, `deemedAcceptanceReminderLeadHours`, `deemDeliveryAccepted`, daily step `delivery_acceptance` |
| D-49 | When a renter's lateness ends if a return pickup collects the gear | REQUIRES_FOUNDER_APPROVAL | The moment the return pickup took the gear (`collected_by_courier` / `handed_to_return_courier` on a live return leg) is the return time for the late fee, and the overdue ladder stops chasing once collected; collected before the return time, the hire is never marked overdue. The deposit still waits for receipt and inspection (D17). Narrows D-42 for the end of the period only (the period itself stays date-based) | `checkRentalSettlement().returnCollectedAt`, `runOverdueLadder`, take-back `handedBackAt` |
| D-50 | Dispatching delivery paid by hand (EFT, cash, card link): orders paid at checkout by EFT, and return pickups requested during the hire (F-2, F-3) | REQUIRES_FOUNDER_APPROVAL | Never automatic. Staff record the payment's manual reference and the amount received; the core checks the order is confirmed (provider-verified or Mark paid), the quotes are the renter's and on this order, and the amount equals the quotes, marks them paid, then prepares and dispatches as staff. A hand-paid fee is refunded by hand (staff alert), never through the provider | `markDeliveryQuotesPaidByStaff`, `dispatchAfterManualPayment`, admin `dispatch_manual_paid` |
| D-51 | Who attributes a delay, no-show or failed collection to the provider (the late-fee waiver, D19) | REQUIRES_FOUNDER_APPROVAL | Only staff, or the provider's own event (it reports the parcel lost). A renter, owner or Ubunye report always starts unattributed: while open it holds settlement for a person; resolved without attribution, the normal late fee applies. Only an attributed provider-caused delay waives the automatic fee | `reportIncident`, `newIncident`, `lateFeeAutoChargeAllowed` |
| D-52 | A paid delivery fee whose leg can never run (no longer eligible after payment, the booking changed, the provider is gone) | REQUIRES_FOUNDER_APPROVAL (accounting) | Refunded in full at once (obligation capped at what is left of the charge) and the quote is marked `refunded`; it is never dispatched later. Replaces F-6 (a manual refund) | `refundUnusedDeliveryQuote`, `lib/delivery/after-payment.ts` |

### Phase 4 review fixes, round 2 (2026-10-09)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-53 | Staff cancel a booking whose delivery already reached the renter (or is lost, damaged or under review) | REQUIRES_FOUNDER_APPROVAL (accounting) | Allowed; only a leg in motion (gear with a courier or our driver) blocks staff. Legs that reached the renter or are under review are left as they are and logged; their fee is KEPT (D-39/D-52: the delivery happened) unless staff tick "refund the delivery fee", which refunds it once (an earned fee is reversed out of income). The renter's own online cancellation keeps the stricter rule | `deliveryCancellationPlan().inMotion`, `refundDeliveryFee`, `PATCH /api/admin/equipment-bookings/[id]` (`refundDeliveryFee`) |
| D-54 | Closing a delivery review as "delivered" after the renter reported a problem | REQUIRES_FOUNDER_APPROVAL | A staff decision that the renter has the gear (`confirmReceived`), with the reason: records `staff_confirmed_received` per item, counts as acceptance (outbound fee earned once, settlement, address retention). If the renter does not have it, staff close the leg as lost, damaged or failed instead. Refines D-43 (staff still never record the renter's own acceptance) | `closeDeliveryReview`, custody kind `staff_confirmed_received` |
| D-55 | Who ends the renter's possession on a return for late fees and the overdue ladder | REQUIRES_FOUNDER_APPROVAL | Only the courier's own confirmation (`collected_by_courier`) or our staff's record (`collected_by_courier` / `handed_to_return_courier` by staff). A renter recording their own handover is kept as evidence and never stops the clock. Refines D-49 | `endsRenterPossession`, `checkRentalSettlement().returnCollectedAt`, `returnCollectedAt()` |

### Phase 4 review fixes, round 3 (2026-10-09)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-56 | A delivery fee refunded BEFORE it was earned, on a leg that stays open (delivered, lost, damaged or under review) | REQUIRES_FOUNDER_APPROVAL (accounting) | Never earned afterwards. The refund posts the earn journal and reverses it (`deliveryEarned` + `deliveryEarnedRefund`, the same net effect as `deliveryCancelled`) so any later earn dedupes; the renter's acceptance, an owner's receipt and closing a review as delivered still record the custody but earn nothing on a refunded fee; deemed acceptance skips such a leg, and a leg whose booking lines are all cancelled, entirely (a person decides; a kept fee on a cancelled booking is then earned only by the renter's acceptance or a staff review decision) | `withFeeRefund`, `feeRefunded`, `deemDeliveryAccepted`, `delivery_list_awaiting_acceptance` |
| D-57 | Staff cancel a booking while the renter still has the gear (outbound delivered, damaged or under review) and a return pickup is scheduled | REQUIRES_FOUNDER_APPROVAL | The return pickup is KEPT (not cancelled, not refunded): it is how the gear comes back. Staff get `delivery_gear_with_renter_after_cancel` because the cancelled booking is off the overdue ladder. The daily sweep never cancels such a pickup. Refines D-53 | `deliveryCancellationPlan().returnKeptShipmentIds/gearWithRenter`, `settleOrderDeliveryOnCancel`, `delivery_cancelled_orders_to_settle` |
| D-58 | Delivery legs or paid quotes found on an order cancelled under the LEGACY money rules (the hire refund already carried the delivery fee) | REQUIRES_FOUNDER_APPROVAL (accounting) | Left to staff for good: a paid quote no leg was made from is marked `consumed` (never dispatched, never refunded again), the order is held out of the daily sweep (`staff_hold = 'legacy_cancel'`) and staff are alerted. A person settles the legs; deleting the order's `delivery_cancelled_order_notes` row releases the hold | `settleOrderDeliveryOnCancel` (legacy branch), `delivery_note_cancelled_order` |
| D-59 | Order of the daily cancelled-order sweep | DEFAULT | Orders never tried first, then the least recently tried, then the oldest; each order is noted before it is tried, so legs a provider keeps refusing to cancel never starve the batch | `sweepCancelledOrderDelivery`, `delivery_cancelled_orders_to_settle` |

### Step 2: database (2026-10-10)

| # | Question | Status | What the code does now | Where encoded |
|---|---|---|---|---|
| D-60 | One word for a captured gear payment in `booking_payments.status` | DEFAULT (technical) | `succeeded`, the word every writer (fulfil.ts, mark-paid, PayFast webhook, `confirm_rental_payment`) and reader (charges, invariants cron, booking page) already used. The base CHECK allowed only `complete`, which nothing wrote. Existing `complete` rows are rewritten; a late `complete` from an old build is mapped by trigger; CHECK = pending, succeeded, failed, refunded | 077 A, `booking_payments_canonical_status` |
| D-61 | Who appears in the public directory (`public_profiles`) | REQUIRES_FOUNDER_APPROVAL | Only people who chose to be public: creators (finished creator onboarding, or have specializations, a creator bio, a portfolio project, a published production an admin made for them, or were featured) and owners of live community gear or marketplace listings (their listing pages name them). Not renters, even verified ones. Suspended accounts never; portfolios hidden until verified. Being a creator is self-declared (profile fields a person edits) | 077 C, `profile_is_creator()`, `public_profiles` |
| D-62 | What an ID approval switches on | REQUIRES_FOUNDER_APPROVAL | Approval verifies anyone. Only a creator (D-61) also becomes available for hire and gets a crew slug; an existing slug is kept. As before 077, approval does not wait for a payout account or a complete portfolio, although the profile page asks for both before a creator can switch availability on themselves: the founder may want approval to require them too | 077 C, `admin_approve_verification` |
| D-63 | Canonical migration order | DEFAULT (technical) | Base schema, then `lib/migrations` in name order (skip `001-pgvector-openai`, skip `*.test.sql`), with the four April files from `supabase/migrations/` immediately before 029. The other `supabase/migrations` files are old copies and are not applied | `scripts/db/rebuild-local.sh`, `docs/database/README.md` |
| D-64 | Who may write a table directly | DEFAULT (technical) | `anon` never; `authenticated` only where a policy for that command exists. A new table must revoke Supabase's default anon grants, or `rls-coverage.test.sql` fails | 077 E5, `lib/migrations/rls-coverage.test.sql` |
| D-65 | People the old approval made available for hire who are not creators | REQUIRES_FOUNDER_APPROVAL | Left as they are (077 only reports the count). They are no longer in the directory but can still be booked by id. The query to switch them off is in `docs/database/README.md` "After 077" | — |
| D-66 | Database isolation: move the other apps out (plan A) or move ThabangVision into a new project built from the repo (plan B) | REQUIRES_FOUNDER_APPROVAL (BLOCKED on access) | Nothing executed. Both plans written | `docs/operations/database-isolation.md` §4, §7 |

Superseded by Phase 1 (no longer enforced at checkout):

- `STUDIO.rental.protection.trustTiers` (the R5k/R20k/R60k ladder by clean returns) is replaced by `RENTAL_POLICY.trustTierLimitsCents` (R2k/R10k/R25k/R80k).
- `STUDIO.rental.protection.collectionOnlyAboveValue` (an order-level R20k) is replaced by `RENTAL_POLICY.highValueCollectionThresholdCents` (any single item over R50k) plus `firstHireCollectionOnly`.
