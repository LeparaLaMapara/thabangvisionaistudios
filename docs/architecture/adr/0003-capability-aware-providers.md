# ADR 0003: Capability-aware payment and payout providers

**Status:** accepted (Phase 2, 2026-10-09)

## Context
Phase 1 put refunds, charge verification and payouts behind `PaymentPort` and `PayoutPort`, with Paystack as the only adapter. Phase 2 (spec §8.4) asks that a provider be chosen by what it can do, in the right currency and country, and that switching providers never changes business policy.

## Decision
- Every adapter declares what it **implements and has verified here**, not everything the provider sells (`lib/core/payments/capabilities.ts`):
  - `PaymentCapabilities`: cardPayments, partialRefunds, cardPreauthorisation, recurringPayments, chargeVerification, refundLookup, currencies, countries.
  - `PayoutCapabilities`: bankTransfers, instantTransfers, transferVerification, currencies, countries.
- `selectPaymentAdapter` and `selectPayoutAdapter` return the first adapter that can do everything asked. If none can, the action is refused; it is never done some other way.
- `payoutRail` returns `instant` only when three things hold: the instant-payout feature flag is on, the adapter has a verified instant rail, and the amount is within a known limit. Otherwise it returns `standard`.
- The Paystack adapter claims no pre-authorisation, no recurring billing and no instant transfers, because none is implemented or verified here.
- Provider-neutral columns are added in migration 071. Steps 1–4 of the additive plan are done: add, backfill, dual-write and reconcile. Moving readers over and dropping the provider-named columns (steps 5–6) need evidence and founder approval.

## Consequences
- A second provider means a new adapter plus one entry in `lib/payments/ports.ts`. Policy code does not change.
- Instant payouts stay unavailable until a provider agreement confirms support, fees, eligibility, settlement, limits, finality and reversal behaviour (spec §8.5). Nothing may claim "paid in minutes".
- The service payout path (`lib/payments/payout.ts`) is moved onto `payoutPort` in the services workstream.
