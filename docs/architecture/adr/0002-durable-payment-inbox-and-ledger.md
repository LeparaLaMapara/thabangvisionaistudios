# ADR 0002: A durable payment inbox, transactional state changes, and an append-only ledger

- **Status:** Accepted for Phase 1. The code is in review on `phase-1-gear-pipeline`. Migration 070 is verified only on local PostgreSQL 16 with a Supabase stub. Dev DB applied: NOT RUN. Paystack payload shapes are NEEDS TEST-MODE VERIFICATION.
- **Date:** 2026-10-08

## Context

Before Phase 1, the Paystack webhook confirmed a checkout group without checking its current status:

- A payment could revive bookings that had already been released.
- A late `charge.failed` could cancel a confirmed booking.
- A failure halfway through processing was lost once Paystack had its 200.
- There were no refund records and no gear payouts.
- Nothing distinguished a customer's deposit from revenue.

## Decision

1. **Store, then acknowledge.** The webhook verifies the signature, then writes the event to `payment_events` (unique `dedupe_key`). It answers 200 only after the row is stored, and 500 if it cannot store it, so Paystack redelivers. Processing failures stay on the row and are retried with back-off. After 8 attempts the row goes `dead` and appears in Rental ops.
   - Paystack sends no event id, so the dedupe key is `provider:event:objectId:status`. A redelivery collides. A real status change of the same object (refund pending → processed) does not.
2. **Decisions are pure; state changes are single transactions.**
   - The decision code is pure (`lib/core/rental/payments.ts`, `refunds.ts`, `payouts.ts`).
   - Each state change is one `SECURITY DEFINER` function: `confirm_rental_payment`, `record_unallocated_payment`, `transition_rental_booking`, `refund_transition` and `payout_transition`. The change, its ledger journal, its refund or payout rows and its notifications commit together or not at all.
   - Moves are compare-and-set on the expected current state, so a replay or a race is a no-op.
3. **Obligations, not calls.** A refund or payout is first a row with a unique key (`refund:<reason>:<subject>`; one payout per booking with reference `tvpo_<booking>`). Workers claim rows by compare-and-set. An unknown provider outcome (timeout or 5xx) is reconciled with the provider before any retry. It is never resent blind.
4. **Append-only, double-entry ledger** (`ledger_journals`, `ledger_lines`).
   - Each journal has a unique `idempotency_key`. Debits must equal credits, enforced by `ledger_post`. Update and delete are refused by trigger, so corrections are reversing journals.
   - Received money is a liability (`unearned_hire`, `customer_deposits`) until earned or settled. A refund leaves cash only when the provider reports it processed. Owner shares are `owner_payable`, never revenue.
5. **Notification outbox.** Notices are written to `notification_outbox` in the same transaction as the change, with a unique `dedupe_key`. A rolled-back change notifies nobody, and a replay sends nothing twice (T28).

## Alternatives considered

- **Process inline and rely on Paystack retries.** Rejected. A partial failure after a 200 is lost, and retries arrive in any order.
- **A queue service** (for example, a hosted queue). Rejected for now. It adds a provider and still needs idempotent consumers. Postgres rows with `FOR UPDATE SKIP LOCKED` are enough at current volume.
- **Single-entry "transactions" table.** Rejected. It cannot show that deposits and owner shares are liabilities, or prove that a closed order nets to zero.

## Consequences

- Retries and sweeps run in the daily `/api/cron/rental-pipeline` job, because the Vercel plan allows only daily crons. The webhook, checkout and admin actions do their work immediately, so the daily job is a backstop. A retry can still wait up to a day (R-16).
- Manual payments (EFT, cash) have no intent and no journal. They are outside the ledger (R-18).
- The inbox keeps a minimal payload (ids, amounts, statuses, our metadata), with no card, bank or customer details.
- Without 070, the webhook processes directly, as before. None of these guarantees hold until 070 is applied.

## Evidence

- `tests/unit/rental-pipeline-core.test.ts` runs the use cases with **in-memory adapters, not live**. It covers duplicate webhooks (T09), failure after payment (T12), late payment (T11), refund timeout reconciliation (T13), the refund cap (T14), refund failure alerts (T15), transfer retries and reversal (T16, T17), and provider outage (T29). It also includes the T30 ledger close-out example.
- `tests/unit/rental-pipeline-adapters.test.ts` covers the webhook route: bad signature 401 (T10), 500 when the event cannot be stored, a redelivery not processed twice, and payload minimisation.
- `lib/migrations/070-gear-pipeline.test.sql` (local PostgreSQL only) covers: duplicate webhook confirms once and notifies once; unbalanced journal refused; ledger append-only; one refund obligation per late payment; refunds capped at the charge; one worker claims a refund; one payout per booking; clients cannot execute the money RPCs.
- **Not run:** a live Paystack test-mode journey, and the Playwright payment E2E.
