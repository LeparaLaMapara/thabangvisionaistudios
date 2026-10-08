# Phased plan

Source: the founder's master engineering specification (2026-10-08). Each phase gets its own branch and a pull request into `develop`, then **stops for founder review**.

- Never merge to `main` without explicit approval.
- Production stays in maintenance mode until the founder reopens it.

| Phase | Branch | Goal | Status |
|---|---|---|---|
| 0 | `phase-0-honest-site` | Honest site and locked doors | In progress |
| 1 | `phase-1-gear-pipeline` | Gear rental, from browsing to financial close | Not started |
| 2 | `phase-2-marketplace-agent` | Marketplace, provider-independent payments, Ubunye agent | Not started |
| 3 | `phase-3-simplicity` | Apple-level simplicity on mobile | Not started |
| 4 | `phase-4-delivery-logistics` | Delivery and reverse logistics | Not started |

## Phase 0: Honest site and security
- Fix the Paystack API host (`api.paystack.co`) and the SA recipient type (`basa`). Move recipient creation behind `lib/payments`.
- Subscription price comes from the server only. Steps are split into initiation, confirmation and fulfilment, with a guarded, idempotent activation.
- Migration 067 locks sensitive columns: per-column grants, defence-in-depth triggers, `security_audit_log`, and removal of the storage UPDATE policy.
- Migration 068 adds versioned consent records. Consent is captured at OAuth onboarding, checkout and identity verification.
- Pricing core in integer cents (`lib/core/pricing`): VAT off (not registered), a dated tax rule, deposit = 25% of replacement value, 80/20 split.
- Honest copy and SEO: Gauteng only, travel by quote elsewhere, 308 redirects for unsupported city pages.
- Legal pages corrected, `/paia` drafted, legal-review checklist.
- Database isolation report. Status: **BLOCKED**.

## Phase 1: Gear rental pipeline
- An expiring reservation with database-level overlap protection (an exclusion constraint or a lock).
- An explicit state machine: `pending → confirmed → active → (overdue) → return_pending → completed | disputed`, plus `cancelled`. Payment, deposit, payout and dispute states are kept separately.
- A durable webhook inbox (`payment_events`, unique per provider event), processed asynchronously and idempotently. All 12 webhook scenarios in spec §7.6 are covered.
- A refund lifecycle with a unique obligation per booking and reconciliation before any retry.
- An append-only ledger: deposits are a liability, not revenue.
- `PayoutPort` (Paystack Transfers + Transfer Approval URL). Owner 80% is paid 48h after a clean completion.
- Server-calculated trust tiers (R2k / R10k / R25k / R80k), first hire collected in person, items over R50k always collected in person.
- `IdentityPort`: Paystack SA bank validation first; Didit or Smile ID evaluated in Phase 2. The Gemma face match is retired from decisions.
- Evidence captured at handover and return. An overdue escalation ladder run by people.
- `NotifyPort` with an outbox: email, in-app and SMS. Collection reminders at about 07:45 SAST.
- Admin queues (refunds, payouts, verification, disputes, reconciliation).
- Acceptance: a full Paystack **test-mode** journey that survives duplicate and out-of-order webhooks, plus Playwright tests on desktop and mobile.

## Phase 2: Marketplace and Ubunye agent
- Community listings: photo → AI draft (untrusted until confirmed) → owner confirms → verification → admin review of the owner's first listing.
- Creative services with their own fulfilment and dispute rules. Payout 72h after acceptance.
- Capability-aware `PaymentPort`/`PayoutPort`. Additive provider-neutral columns, dual-written, then backfilled.
- Instant payouts (PayShap/RTC) only behind a feature flag and only with verified evidence.
- Ubunye becomes an agent built on the same core use cases. Each consequential command is prepared first, then committed. Commits require approval, enforced in code with a signed, expiring single-use token. Text from users and listings is treated as untrusted (prompt-injection defence). The conversation state survives a bare "yes". At least 30 evaluations, run on two AI providers.
- MCP and A2A are evaluated, but only behind OAuth scopes.

## Phase 3: Simplicity
- Passwordless sign-in.
- Rent in four actions: item → dates → reserve → pay.
- List gear in three steps. Offer a service in three steps.
- Mobile-first: 44px touch targets, accessibility, performance budgets, and privacy-respecting funnel metrics.

## Phase 4: Delivery and reverse logistics
- A provider-independent `DeliveryPort` with capability flags. Research providers (Uber Direct, WumDrop, Droppa, Bob Go, Pargo, manual) against verified terms.
- The rules from Phases 0–1 still apply: first hire and items over R50k are collected in person, trust tiers hold, Gauteng only.
- Automatic courier delivery stays disabled until an insurance and custody policy is approved.
- A chain-of-custody record for every item. Delivery is prepared, then committed. Webhooks are idempotent. Returns are tracked as their own leg.
- Milestones 4A–4D: foundations and the manual adapter → one provider → returns and operations → multiple providers.
- Tests D01–D30.
