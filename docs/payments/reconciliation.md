# Reconciliation (gear hire)

**Status:** the code is on `phase-1-gear-pipeline`. Every check below returns nothing while migration 070 is missing, which is the case on every database today (Dev DB applied: NOT RUN). The detectors are unit-tested against in-memory rows (`tests/unit/rental-pipeline-adapters.test.ts`, `tests/unit/rental-pipeline-core.test.ts`). They have not run against real data.

## 1. What runs, and when

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/rental-pipeline` | daily 05:45 (07:45 SAST) | Retries the inbox, expires holds, moves refunds, reviews and sends payouts, runs the overdue ladder and reminders, delivers the outbox (`lib/rental/pipeline.ts`) |
| `/api/cron/invariants` | daily 03:00 | Runs the detectors below (`lib/rental/reconcile-server.ts` → `lib/core/rental/reconcile.ts`). Findings are de-duplicated in `ops_findings`. Any newly opened finding is emailed once to `STUDIO.email` |
| Rental ops → "Run pipeline" | on demand | The same pass as the daily job |

Both jobs are daily because the current Vercel plan rejects sub-daily crons (see CLAUDE.md). Webhooks, checkout and admin actions do their work immediately. The jobs retry and sweep up. Worst-case latency for a retry is about 24 hours (risk register R-16).

## 2. Findings and what to do

| Check id | Severity | Meaning | First action |
|---|---|---|---|
| `rental-paid-not-confirmed` | critical | Intent `paid` for over 15 minutes, but no line confirmed or later | Check `payment_events` for the reference. Requeue it in Rental ops. If the stock is gone, the money is owed back |
| `rental-unallocated-money` | critical | Intent `mismatch`/`refund_due` for over an hour | Compare the amount with the Paystack dashboard. If the money belongs to the customer, use Rental ops → "refund unallocated" with a note |
| `rental-confirmed-unpaid` | critical | Line confirmed, `payment_method = 'online'`, no payment reference | Find the payment in Paystack. If there is none, cancel with a reason |
| `rental-refund-failed` | critical | Obligation `failed`/`needs_attention` | Read `last_error`. Fix the cause, then "Retry refund" (it reconciles first) |
| `rental-refund-stuck` | warn | In flight with the provider for over 72h | Look the refund up in Paystack. Do not resubmit by hand |
| `rental-payout-failed` | critical | Payout failed, reversed, blocked, rejected, abandoned, `otp`, `needs_attention` | Check the owner's recipient and the Paystack transfer settings |
| `rental-payout-stuck` | warn | Payout in flight for over 48h | Verify the transfer by its `tvpo_…` reference |
| `payment-inbox-dead` | critical | Webhook events that failed 8 times | Read `last_error`, fix, requeue |
| `payment-inbox-backlog` | warn | Events unprocessed for over 60 minutes | Usually waiting for the daily retry. Requeue if it is urgent |
| `rental-inventory-conflict` | critical | More units booked on one day than exist. Should be impossible after 070 | Treat as a bug: stop new bookings for that item and contact the affected renters |
| `rental-ledger-unreconciled` | warn | A financially closed order leaves a liability in the ledger | See section 3 |

## 3. Ledger close-out (T30)

An order is checked once all of these hold: its intent is `paid`, every line is `completed` or `cancelled`, no refund is still open and no payout is still open. Its journals must then leave every liability at zero (`reconcileClosedGroup`):

- `customer_deposits` = 0. The deposit was refunded or kept with evidence.
- `refunds_payable` = 0. Every refund owed was processed.
- `unearned_hire` = 0. The hire was recognised or refunded.
- `owner_payable` = 0. The owner was paid.
- `unallocated_receipts` = 0. Stray money went back.

The check also compares the ledger's `cash_at_provider` with the provider's net figure when that figure is supplied. **Not done:** no job fetches the provider's settlement figures yet. Comparing cash with Paystack settlements is a manual monthly task until it is built.

Known sources of `rental-ledger-unreconciled` today:

- Disputes resolved through `/admin/disputes` (no `hire_earned`/`deposit_settled` journal; see [payout-lifecycle.md](payout-lifecycle.md#6-known-gaps-not-done)).
- Provider fees. No `provider_fee` journal is posted yet.

## 4. Outside the ledger

Manual payments (EFT, cash, card link recorded as `manual:…`) and their refunds have no journals. Reconcile them against the bank statement by hand (risk register R-18).

## 5. Manual monthly check (until automated)

1. Paystack dashboard: total successful charges, refunds and transfers for the month.
2. `ledger_lines` grouped by account for the same period. `cash_at_provider` movements should equal charges − refunds − transfers − fees.
3. List every open `refund_obligations` and `owner_payouts` row older than 7 days, with the reason it is still open.
4. Record the result and any differences. Differences need a person and a reversing journal, never an edit (the ledger is append-only).
