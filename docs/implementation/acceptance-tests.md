# Acceptance tests

Each ID maps to the phase that must prove it. "Phase 0 evidence" points to where the test lives.

## Financial and security (spec §11)

| ID | Test | Phase | Phase 0 evidence |
|---|---|---|---|
| T01 | Correct rental total | 0 (core) / 1 (checkout) | `tests/unit/pricing-core.test.ts` |
| T02 | Correct 25% deposit | 0 / 1 | `pricing-core.test.ts` |
| T03 | Correct owner/platform split | 0 / 1 | `pricing-core.test.ts` |
| T04 | Correct rounding across multi-item carts | 0 / 1 | `pricing-core.test.ts`, cart split helper |
| T05 | Tampered browser amount rejected | 0 (subscriptions) / 1 (rentals) | `subscription-checkout.test.ts` |
| T06–T17 | Booking/webhook/refund/transfer idempotency and reconciliation | 1 | See "Phase 1 evidence" below |
| T18 | User cannot set their own verification status | 0 | `lib/migrations/067-lock-sensitive-columns.test.sql` (dev) |
| T19 | User cannot change their verified banking identity | 0 | `067-…test.sql` |
| T20–T23 | AI approval and confirmation tokens | 2 | — |
| T24–T26 | Disputed or overdue gear stays unavailable; collection rules | 1 | See "Phase 1 evidence" below |
| T27 | Owner cannot read another owner's sensitive records | 0 (RLS) / 2 | `067-…test.sql` (cross-user) |
| T28–T30 | Notification dedupe, provider outage, reconciliation | 1 | See "Phase 1 evidence" below |

## Phase 0 mandatory gates (founder correction §I)

| Gate | Evidence |
|---|---|
| Privileged-field INSERT rejected | `067-…test.sql` |
| Privileged-field UPDATE rejected | `067-…test.sql` |
| Ownership reassignment rejected | `067-…test.sql` |
| Legitimate profile updates succeed | `067-…test.sql` |
| Legitimate privileged verification succeeds | `067-…test.sql` |
| Sensitive storage overwrite rejected | `067-…test.sql` |
| Cross-user storage access rejected | `067-…test.sql` |
| Client subscription-price override rejected | `subscription-checkout.test.ts` |
| Payment amount mismatch does not activate a subscription | `subscription-checkout.test.ts` |
| A duplicate payment confirmation does not fulfil twice | `subscription-checkout.test.ts` |
| Required consent cannot be bypassed | `068-consent-records.test.sql`, `consent.test.ts`, checkout consent check |
| Existing accounts keep working | `067-…test.sql` (existing rows), full vitest suite |
| Production credentials are not used in tests | `tests/unit/no-prod-credentials.test.ts` |
| Migrations 067 and 068 work together | Applied together on dev, both test scripts run (`docs/security/phase-0-db-evidence.md`) |

## Phase 1 evidence (2026-10-08)

Evidence key:

- **Unit:** `tests/unit/rental-pipeline-core.test.ts`. Pure rules and use cases driven by **in-memory adapters, not live**.
- **Adapters:** `tests/unit/rental-pipeline-adapters.test.ts` (webhook route, inbox parsing, checkout ids, detectors), `tests/unit/transfer-approval.test.ts` and `tests/unit/checkout-tamper.test.ts`. Supabase and Paystack are mocked.
- **SQL:** `lib/migrations/070-gear-pipeline.test.sql` and `scripts/db/070-concurrency.sh`. Run on **local PostgreSQL 16 with a Supabase stub only**. On DEV: NOT RUN (`docs/security/phase-1-db-evidence.md`).

| ID | Test | Evidence | Live status |
|---|---|---|---|
| T06 | Repeated checkout or transition does not act twice | Unit "T06: repeating a transition…"; Adapters "T06: the same customer + key always maps to the same order id"; SQL "repeated checkout request is refused (T06)", "transitions are guarded, idempotent and recorded (T06)" | Not run on DEV |
| T07 | Two customers race for the last unit; one wins | SQL "multi-item cart is all-or-nothing"; `070-concurrency.sh` "exactly one booking for the last unit (T07)" | Local PostgreSQL only |
| T08 | A browser redirect never confirms a booking | Unit "T08: a customer (browser) can never confirm a booking", "T08: without a verified event nothing is confirmed" | — |
| T09 | Duplicate paid webhook confirms once | Unit "T09: a duplicate paid webhook confirms once…"; Adapters "T09: a redelivered event is acknowledged without processing it again"; SQL "duplicate webhook confirms once, books once, notifies once" | Not run on DEV |
| T10 | Bad signature rejected | Adapters "T10: an invalid signature is rejected and nothing is stored"; transfer-approval "refuses a bad signature" | — |
| T11 | Payment after hold expiry: re-reserve or refund, never double-book | Unit "T11: late payment with stock still free…", "T11: … refunded, never double-booked"; SQL "late payment never double-books (T11)" | Not run on DEV |
| T12 | `charge.failed` after payment cannot cancel | Unit "#4/T12 …", "T12: a failed event after payment cannot cancel the paid booking" | — |
| T13 | Refund timeout reconciled; never sent twice; one obligation | Unit "T13: a refund that timed out is reconciled…", "T13: the same obligation cannot be created twice"; SQL "one refund obligation per late payment", "only one worker can claim a refund" | Not run on DEV. Rental ops Retry gap (risk register R-20) |
| T14 | Refunds never exceed the charge | Unit "T14: a refund never exceeds…"; SQL "refunds cannot exceed the charge (T13, T14)" | Not run on DEV |
| T15 | Failed refund alerts staff and tells the customer | Unit "T15: a rejected or failed refund raises a staff alert…"; Adapters "T15: failed refunds alert…" | — |
| T16 | Transfer retries cannot pay an owner twice | Unit "T16/#12: transfer retries and late responses cannot pay an owner twice…"; transfer-approval "refuses a changed amount or recipient (T16)"; SQL "one payout per booking (T16)" | No transfer sent, test or live |
| T17 | Transfer reversal re-opens the owner balance | Unit "… T17 reversal is booked back" | — |
| T24 | Disputed gear stays unavailable | Unit "T24/T25: …"; SQL "disputed and overdue gear stay unavailable (T24, T25)" | Not run on DEV |
| T25 | Overdue gear stays unavailable | Same as T24 | Not run on DEV |
| T26 | First hire and items over R50,000 collected in person | Unit "T26: first hire and any item over R50,000 must be collected in person" | — |
| T27 | No cross-user access to payment records | SQL "a stranger sees no payment intents (T27)", "clients cannot execute money RPCs", "clients cannot write refund obligations" | Not run on DEV |
| T28 | Notifications de-duplicated | Unit "T09 … notifies once (T28)", "builds one dedupe key per channel and occurrence"; SQL "… notifies once (T09, T28)" | Not run on DEV |
| T29 | Provider outage leaves everything recoverable | Unit "#6/T29: a database failure leaves a retryable state…", "T29: a provider outage leaves every obligation recoverable"; Adapters "answers 500 (so Paystack retries) when the event cannot be stored" | — |
| T30 | Closed orders reconcile to zero | Unit "T30: the spec worked example closes to zero on every liability"; detector `rental-ledger-unreconciled` (`lib/rental/reconcile-server.ts`) | Not run on real data |

**NOT RUN (Phase 1 acceptance still open):**

- Full Paystack **test-mode** journey, including duplicate and out-of-order webhooks against the real provider. There are no test keys in this environment.
- **Playwright payment E2E**, desktop (`chromium`) and mobile (`mobile`). No Phase 1 payment spec exists in `tests/e2e/` yet.
- 070 test scripts on the DEV Supabase project.

## Delivery (spec Phase 4)
Tests D01–D30 are owned by Phase 4. Phase 0 adds no delivery code.
