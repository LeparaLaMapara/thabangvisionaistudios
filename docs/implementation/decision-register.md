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
