# Ports and adapters (hexagonal)

The business rules live in `lib/core/`. That code must not import Supabase, Next.js, Paystack, any AI SDK, or any HTTP client for a provider. It receives validated input and talks to the outside world only through interfaces, called ports.

Everything provider-specific lives in an adapter. Existing provider code (`lib/payments`, `lib/email`, `lib/storage`, `lib/ai`, …) already plays this role and is moved over gradually. Nothing is moved just for the sake of moving it.

```
lib/core/            domain rules + use cases (pure, unit-tested)
  pricing/           money.ts (cents, allocation), tax.ts (dated VAT), rental.ts   ← Phase 0
  rental/            state, trust, ledger, payments, refunds, payouts, overdue, notifications, reconcile, use-cases   ← Phase 1
  ports/             PaymentPort, PayoutPort, IdentityPort, NotifyPort, repositories, Clock   ← Phase 1
lib/payments/        payment/payout adapters (Paystack, PayFast, Yoco) behind one registry
app/api/**           driving adapters (HTTP) — authenticate, validate, call core, persist
lib/agents/**        driving adapter for Ubunye — must call the same core use cases (Phase 2)
```

## Rules
1. **Money is integer cents in the core.** Rand values are converted only at the database and UI boundary, until the Phase 1 migration to cents.
2. **Policies come from configuration.** They are defined in `lib/constants.ts`: `RENTAL_POLICY`, `STUDIO.legal.tax` and `STUDIO.serviceArea`.
3. **The browser is never a source of money or authority.** Prices, plans and trust tiers are worked out on the server.
4. **Consequential commands run in two steps (prepare, then commit)** with idempotency keys, from Phase 1 onward.

## Phase 1 ports (in review on `phase-1-gear-pipeline`)

Defined in `lib/core/ports/index.ts`. Used by the use cases in `lib/core/rental/use-cases.ts`. Routes and workers get the active provider's adapters from `lib/payments/ports.ts` (chosen by `PAYMENT_PROVIDER`). Only Paystack implements them. Any other provider gets adapters that refuse every call, so nothing is sent somewhere unexpected.

| Port | Purpose | Adapter(s) |
|---|---|---|
| `Clock` | Current time (tests fix it) | `systemClock` |
| `PaymentPort` | `refund`, `listRefunds` (reconcile before retry), `verifyCharge` | `paystackPayments` (`lib/payments/paystack-ports.ts`). `verifyCharge` is used by `recoverMissedPayments` |
| `PayoutPort` | `transfer` under a stable reference, `verifyTransfer` by that reference | `paystackPayouts` |
| `IdentityPort` | `validateBankAccount`: SA bank account belongs to the named person. This is **not** identity verification | `paystackIdentity` (`POST /bank/validate`), called from `POST /api/banking` |
| `NotifyPort` | Deliver one outbox message (in-app, email, SMS); safe to repeat | `supabaseNotify` (`lib/rental/notify.ts`, using `lib/email` and `lib/sms`) |
| `RentalPaymentRepository` | Intents, order lines, atomic confirm, unallocated money, failed attempts | `SupabaseRentalPayments` (`lib/rental/repos.ts`, 070 RPCs) |
| `RefundRepository` | Refund obligations, compare-and-set transitions with journal and notices | `SupabaseRefunds` |
| `PayoutRepository` | Owner payouts, compare-and-set transitions with journal and notices | `SupabasePayouts` |

The webhook inbox (`lib/rental/inbox.ts`) and the workers (`lib/rental/workers.ts`, `lib/rental/pipeline.ts`) are driving adapters. Tests use in-memory adapters for every port (`tests/unit/rental-pipeline-core.test.ts`). Every Supabase adapter detects a database without migration 070 (`isMissingPipeline`) and falls back to the pre-Phase-1 path.

Money: the Phase 1 tables store integer cents (`*_cents`). Older columns (`total_price`, `deposit_amount`) stay in rands and are converted at the boundary.

## Reserved for later phases
- **Phase 2:** capability flags per provider; Ubunye tools generated from core use cases; MCP behind OAuth scopes.
- **Phase 4:** `DeliveryPort` (capability flags, quote → prepare → commit dispatch), `AddressPort`, `DeliveryInsurancePort`, and chain-of-custody events.
  - Logistics is **independent of payment providers**: delivery fees are their own line item, outside the owner's 80% share.
  - Insured-transport rules gate automatic courier delivery.
