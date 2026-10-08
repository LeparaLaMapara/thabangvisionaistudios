# Refund lifecycle (gear hire)

**Status:** the code is on `phase-1-gear-pipeline`. Migration 070 is not applied on dev or production. The rules are proven only by unit tests with in-memory adapters and by the 070 test script on local PostgreSQL. The live Paystack refund payloads still need test-mode verification ([payment-lifecycle.md](payment-lifecycle.md#needs-test-mode-verification)).

Code: `lib/core/rental/refunds.ts` (rules), `lib/core/rental/use-cases.ts` (`submitRefund`, `processRefundEvent`), `lib/rental/repos.ts` (`SupabaseRefunds`), table `refund_obligations` and RPC `refund_transition` (070).

## 1. One obligation per business reason

Every refund starts as one row in `refund_obligations`, keyed by `obligation_key = refund:<reason>:<subject>`. The key is unique, so a retry, a double click or a replayed webhook can never create a second obligation for the same money (T13).

| Reason | Created by | Subject |
|---|---|---|
| `deposit_settlement` | Take-back (`POST /api/admin/rentals/[id]/take-back`) for a deposit paid by card | booking id |
| `cancellation` | Customer cancellation (`PUT /api/bookings/[id]`) | booking id |
| `manual` | Staff cancellation of a paid booking (`PATCH /api/admin/equipment-bookings/[id]`). Dispute resolution `full_refund` / `partial_refund` (`PATCH /api/admin/disputes/[id]`) | `staff-cancel:<id>` / `dispute:<id>` |
| `late_payment` | Webhook: paid after the hold ran out and stock was gone, or paid for an order a person cancelled | provider transaction id |
| `overpayment` | Rental ops → **Refund in full** (unallocated money) after a person checked a `mismatch` intent | provider transaction id |

**Cap (T14).** The trigger `refund_obligations_cap` takes an advisory lock per charge. It refuses any obligation that would make the non-failed refunds on that charge exceed `charged_cents`. The app also caps each new refund at the remainder (`chargeOfBooking`, `refundableRemainder`).

**Deposit deductions** (`planDepositRefund`) apply only after inspection. A damage amount needs photographs or a written note. A late fee follows the published rule (`lib/rental/late-fee.ts`; see decision D-25). Deductions can never exceed the deposit. Anything above the deposit is invoiced separately, never taken. Unreturned gear is never settled by an automatic deduction.

## 2. States

```
eligible ─► claimed ─► pending ─► processing ─► processed
   ▲           │          │            │
   │           ├──────────┴────────────┴─► failed ─┐
   │           └─► needs_attention ────────────────┤
   └──────────── (staff: Rental ops "retry") ◄─────┘
```

`requested` is used when the provider accepted a request without an id. `disputed` is reserved for an inspection disagreement. Provider statuses only move forward. A repeat is a duplicate. `processed` is final. A `failed` refund can still move to `processed` if the provider later reports it.

## 3. Submitting (`submitRefund`)

1. **Claim.** A compare-and-set from `eligible` to `claimed`, so only one worker calls Paystack.
2. **Call** `POST /refund` with the charge reference and the amount in cents.
   - OK → `pending`/`processing`/`processed` as reported, and the customer gets a "refund initiated" notice.
   - Rejected (4xx) → `failed`, a staff alert, and a "refund problem" notice to the customer (T15).
   - Timeout, network error or 5xx → **outcome unknown**. The row stays `claimed`.
3. **Reconcile before any retry (T13).** A `claimed` row older than 10 minutes, or a `requested` row with no provider id, is looked up first with `GET /refund?transaction=…`. Found → adopt the provider's state. Not found → release to `eligible` so it can be sent. It is never re-sent blind.
4. After 3 attempts an `eligible` row goes to `needs_attention` and alerts staff.

Callers: the take-back and dispute routes submit immediately. The daily job (`runRefunds`) and Rental ops **Retry** handle the rest. Retry reopens a `failed`/`needs_attention` row to `eligible`, and an `eligible` row is **submitted, not reconciled**. So if `provider_refund_id` is already set (the refund exists at Paystack, for example a provider `needs-attention`), Retry would send a second request. Resolve those in the Paystack dashboard instead ([incidents.md](../operations/incidents.md#refund-failures)). The Rental ops hint, which says Retry always reconciles first, overstates this.

## 4. Provider updates (`processRefundEvent`)

`refund.*` webhooks go through the inbox like charges. The obligation is found by provider refund id, or else by charge reference and amount. `applyProviderRefundStatus` decides whether to move it. Out-of-order and repeated events are no-ops.

## 5. Ledger and wording

- A refund owed is a liability (`refunds_payable`, or `unallocated_receipts` for money never applied to a booking). It leaves `cash_at_provider` **only when the provider reports `processed`** (`refund_processed` journal).
- Customer wording: "Refund initiated … not complete yet", "Refund processed", "Refund problem". Nothing says "refunded" before the provider confirms it (`lib/rental/notify.ts`, tested in `tests/unit/rental-pipeline-adapters.test.ts`).

## 6. Manual refunds

Deposits taken by EFT or cash are paid back by hand. The take-back records `deposit_refund_method = 'eft' | 'cash'` and `deposit_released_at`. No obligation or journal is created. Staff cancellations and dispute refunds on manual payments raise a staff alert, or add a note, so a person pays them back. These refunds are outside the ledger (risk register R-18).

## 7. Open decisions

- D-18: who bears refund fees. Not decided; no fee is deducted from a customer refund.
- D-13 / D-25: final cancellation and late-fee policy.
