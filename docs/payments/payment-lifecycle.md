# Payment lifecycle (gear hire)

Scope: gear orders placed through the cart (`POST /api/cart/checkout`, rows in `equipment_bookings`). Service bookings and subscriptions keep their own paths and are not covered here.

**Status (2026-10-08).** The code is on `phase-1-gear-pipeline`, in review. Migration 070 has been verified only on a throwaway local PostgreSQL 16 with a Supabase stub. Dev DB applied: **NOT RUN**. Production: not applied. No live Paystack test-mode run was possible from this environment. See "Needs test-mode verification" below.

Related: [refund-lifecycle.md](refund-lifecycle.md), [payout-lifecycle.md](payout-lifecycle.md), [reconciliation.md](reconciliation.md), [ADR 0001](../architecture/adr/0001-database-locked-reservations.md), [ADR 0002](../architecture/adr/0002-durable-payment-inbox-and-ledger.md).

## 1. Checkout and reservation

`POST /api/cart/checkout` does this, in order:

1. Requires a signed-in, non-suspended account with `profiles.verification_status = 'verified'`.
2. Records the required consents (migration 068).
3. Prices the cart on the server. Client-supplied price fields are rejected (T05, `tests/unit/checkout-tamper.test.ts`).
4. Checks the lead time and date range.
5. Runs the trust check (`lib/rental/eligibility-server.ts` → `lib/core/rental/trust.ts`). The tier limit applies to the replacement value of everything the renter holds or has booked, plus the new order. The first hire and any item over `RENTAL_POLICY.highValueCollectionThresholdCents` must be collected. Gear overdue past formal escalation, or a suspension, refuses the order (403). Other risks set `requires_manual_approval`, so a manager must approve before handover.
6. Derives the order id from the `Idempotency-Key` header (`checkoutGroupIdFor`). The same customer and key always map to the same `checkout_group_id`, and the database refuses a second copy (T06).
7. Calls `reserve_rental_order` (070). This locks the listings, re-checks stock with `rental_units_blocked`, and inserts every line plus one `rental_payment_intents` row in **one transaction**. All lines or none (T07). See ADR 0001.
8. Creates the Paystack payment page. If that fails, `releaseUnpaidReservation` removes the unpaid lines and the intent.

Hold length: `STUDIO.rental.pendingHoldMinutes` while online payment is configured, and 48 hours while payments are offline (EFT/cash). An expired hold stops blocking stock as soon as it lapses (`rental_units_blocked` compares `hold_expires_at` with `now()`). The daily job then marks those lines `cancelled` with `cancel_reason = 'hold_expired'` (`expire_rental_holds`).

## 2. The redirect proves nothing

Paystack sends the customer back to `/dashboard/bookings?checkout=<order>&payment=success`. On a booking page, `?payment=success` shows only "Confirming your payment". It never says the payment was received. Only a verified provider event moves money state (T08).

## 3. Webhook → inbox → decision

`POST /api/webhooks/paystack`:

1. Verifies the HMAC signature over the raw body. Anything else gets 401 (T10).
2. Parses the event and keeps a minimal copy: ids, amounts, statuses and our own metadata. No card, bank or customer details are kept.
3. Stores it in `payment_events`. `dedupe_key` is unique, built as `provider:event:objectId:status`. If the store fails, the route answers 500 so Paystack redelivers. A redelivery of a stored event is answered 200 and not processed again (T09).
4. Processes the event, records the outcome on the row, then sends any queued notifications.

Processing failures leave the row `failed`, with a back-off of 1, 2, 4 … minutes capped at 60. The daily job retries it (`claim_payment_events`). After 8 attempts the row becomes `dead` and appears in Rental ops.

`processChargeEvent` (`lib/core/rental/use-cases.ts`) uses `decideCharge` (`lib/core/rental/payments.ts`):

| Situation | Decision | Result |
|---|---|---|
| Exact amount, ZAR, right customer, hold live | `confirm` | Lines → `confirmed`, intent → `paid` |
| Paid after the hold expired, or lines cancelled by expiry only | `confirm_late` | Stock re-checked under lock. Free → confirmed. Gone → `refund_due` plus a refund obligation (T11) |
| Same provider transaction again | `duplicate` | Nothing changes |
| `charge.failed` before payment | `record_failure` | Attempt counted. The hold stays, so the customer may retry |
| `charge.failed` after payment | `ignore` | A failure never undoes a payment (T12) |
| Wrong amount, currency or customer, or a second different transaction | `hold_mismatch` | Intent → `mismatch`. Money recorded as unallocated. **No automatic refund**: a person checks first |
| Paid for an order a person cancelled | `refund_paid_cancelled` | Intent → `refund_due`, refund obligation created |
| Unknown reference | `unknown_reference` | Ignored. Non-rental charges fall through to the legacy subscription/service path |

`confirm_rental_payment` does the confirmation in one transaction. It moves the lines, marks the intent `paid` with the provider transaction id, posts the `payment_captured` journal, and enqueues the `payment_received` and `booking_confirmed` notices.

Intent states: `initiated → paid | failed | expired | mismatch | refund_due → refunded`.

Ledger at payment: Dr `cash_at_provider`; Cr `unearned_hire` (hire and delivery fee) and Cr `customer_deposits`. Money received is never revenue at this point. See ADR 0002.

## 4. Manual payments (EFT, cash, card link)

Staff record them with **Mark paid** (`POST /api/admin/equipment-bookings/[id]/mark-paid`). The reference is stored as `manual:<method>:<ref>` and the booking moves `pending → confirmed` as staff. These payments have **no payment intent and no ledger journal**. They sit outside the ledger and are reconciled by hand (risk register R-18).

## 5. Without migration 070

If 070 is missing, every adapter detects it (`isMissingPipeline`) and the code falls back to the pre-Phase-1 path. The webhook processes directly with no inbox. Checkout inserts the lines the old way, with no intent and no database lock. This keeps the site working, but none of the Phase 1 guarantees (T06–T17) hold until 070 is applied.

## 6. Not done

- `PaymentPort.verifyCharge` exists, but no job calls it. A webhook that never arrives is recovered only by Paystack's own redelivery, or by staff checking the Paystack dashboard and acting in Rental ops.
- The full Paystack test-mode journey and the Playwright payment E2E have **not been run**.

## Needs test-mode verification

None of these could be confirmed from the sandbox: no test keys, and Paystack's docs domain was unreachable. The adapters read fields defensively. Each item must be checked in Paystack **test mode** before payments open.

| Item | Where in code | What to confirm |
|---|---|---|
| `charge.success` amount unit and metadata keys (`customStr1`/`customStr2` vs `custom_str*`) | `parsePaystackEvent` | Amount is in cents. Our user id arrives where we read it |
| Refund webhook payload: refund id, the charge it belongs to (`transaction_reference`, `transaction.reference` or `transaction`), status strings | `parsePaystackEvent`, `mapProviderRefundStatus` | Events match an obligation by provider refund id or by transaction and amount |
| `POST /refund` response shape. Whether any idempotency key is honoured (the adapter sends none) | `paystackPayments.refund` | Response carries an id and a status |
| `GET /refund?transaction=` filtering | `paystackPayments.listRefunds` | Reconcile-before-retry finds an earlier refund |
| Transfer webhook names and `GET /transfer/verify/:reference` "not found" message | `processTransferEvent`, `paystackPayouts.verifyTransfer` | "Not found" is reported as a definite answer |
| Transfer Approval URL: request shape, and which status codes mean approve or reject | `app/api/webhooks/paystack/transfer-approval/route.ts` | Do not enable the approval URL on the live account before this |
| `POST /bank/validate`: accepted `document_type` values and the `verified` field | `paystackIdentity.validateBankAccount` | See decision D-23. The adapter is not yet wired into any flow |
