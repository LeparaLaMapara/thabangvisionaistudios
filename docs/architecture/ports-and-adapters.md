# Ports and adapters (hexagonal)

The business rules live in `lib/core/`. That code must not import Supabase, Next.js, Paystack, any AI SDK, or any HTTP client for a provider. It receives validated input and talks to the outside world only through interfaces, called ports.

Everything provider-specific lives in an adapter. Existing provider code (`lib/payments`, `lib/email`, `lib/storage`, `lib/ai`, …) already plays this role and is moved over gradually. Nothing is moved just for the sake of moving it.

```
lib/core/            domain rules + use cases (pure, unit-tested)
  pricing/           money.ts (cents, allocation), tax.ts (dated VAT), rental.ts   ← Phase 0
  ports/             PaymentPort, PayoutPort, IdentityPort, NotifyPort, repositories, Clock   ← Phase 1+
lib/payments/        payment/payout adapters (Paystack, PayFast, Yoco) behind one registry
app/api/**           driving adapters (HTTP) — authenticate, validate, call core, persist
lib/agents/**        driving adapter for Ubunye — must call the same core use cases (Phase 2)
```

## Rules
1. **Money is integer cents in the core.** Rand values are converted only at the database and UI boundary, until the Phase 1 migration to cents.
2. **Policies come from configuration.** They are defined in `lib/constants.ts`: `RENTAL_POLICY`, `STUDIO.legal.tax` and `STUDIO.serviceArea`.
3. **The browser is never a source of money or authority.** Prices, plans and trust tiers are worked out on the server.
4. **Consequential commands run in two steps (prepare, then commit)** with idempotency keys, from Phase 1 onward.

## Reserved for later phases
- **Phase 1:** `PaymentPort` / `PayoutPort` / `IdentityPort` / `NotifyPort`, a ledger repository, and a webhook inbox.
- **Phase 2:** capability flags per provider; Ubunye tools generated from core use cases; MCP behind OAuth scopes.
- **Phase 4:** `DeliveryPort` (capability flags, quote → prepare → commit dispatch), `AddressPort`, `DeliveryInsurancePort`, and chain-of-custody events.
  - Logistics is **independent of payment providers**: delivery fees are their own line item, outside the owner's 80% share.
  - Insured-transport rules gate automatic courier delivery.
