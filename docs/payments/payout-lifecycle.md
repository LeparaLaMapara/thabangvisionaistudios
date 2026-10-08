# Owner payout lifecycle (community gear)

**Status:** the code is on `phase-1-gear-pipeline`. Migration 070 is not applied on dev or production. No transfer has been sent through this path, in test mode or live. The Transfer Approval URL request shape and the transfer webhooks need test-mode verification ([payment-lifecycle.md](payment-lifecycle.md#needs-test-mode-verification)).

Code: `lib/core/rental/payouts.ts` (rules), `lib/core/rental/use-cases.ts` (`submitPayout`, `processTransferEvent`), `lib/rental/workers.ts` (`reviewScheduledPayouts`, `evaluatePayout`, `runPayouts`), `app/api/webhooks/paystack/transfer-approval/route.ts`, table `owner_payouts` and RPC `payout_transition` (070).

Service-booking (creator) payouts keep their existing path (`lib/payments/payout.ts`). The Transfer Approval URL checks both kinds.

## 1. When a payout is created

At a **clean completion**: a take-back that ends with the booking `completed`. One `owner_payouts` row is written per community-gear booking, in the same transaction as the completion (`transition_rental_booking`):

- `owner_amount_cents` = the owner's share snapshotted at checkout (`RENTAL_POLICY.ownerShareBps`). `platform_commission_cents` = the platform share. The deposit is never part of the split.
- `scheduled_at` = completion + `RENTAL_POLICY.ownerPayoutDelayHours` (48h).
- `transfer_reference` = `tvpo_<booking id without dashes>`. It is **one stable reference per booking, forever** (`payoutReference`). `booking_id` is unique, so a second payout row cannot exist (T16).
- The ledger moves the hire from `unearned_hire` to `owner_payable` + `platform_commission` (`hire_earned` journal).

## 2. Review (daily job, or Rental ops)

`reviewScheduledPayouts` checks every `scheduled`/`held` payout that is due against `checkPayoutEligibility`. Every unmet condition is recorded in `hold_reasons`:

`owner_not_verified`, `payout_account_not_validated`, `booking_not_completed`, `payment_not_confirmed`, `inspection_not_completed`, `open_dispute`, `deposit_not_settled`, `payout_already_started`, `delay_not_elapsed`.

**Auto-approval is OFF** (`RENTAL_POLICY.payoutAutoApprove = false`, decisions D-19 and D-24). An eligible payout waits in Rental ops with no hold reasons. A member of staff presses **Approve & send**, which re-runs every check on the server before moving the payout to `approved`. **Hold** needs a written reason.

## 3. Sending (`submitPayout`)

1. Claim: compare-and-set from `approved` to `claimed`.
2. `POST /transfer` with `reference = tvpo_…`, the amount in cents and the recipient code.
   - OK → `pending`/`received`/`success` as reported.
   - Rejected → `failed` and a staff alert.
   - Unknown (timeout or 5xx) → the row stays `claimed`.
3. Reconcile before any retry: `GET /transfer/verify/<same reference>`. Found → adopt its state. "Not found" → release to `approved`. A new reference is never invented. Paystack treats references as unique, so a repeat cannot pay twice.
4. `otp` means the Paystack account requires OTP for transfers, which is a configuration problem. It escalates to staff.

## 4. Provider updates (`processTransferEvent`)

`transfer.success`, `transfer.failed`, `transfer.reversed` and others arrive through the inbox.

- `success` is final. It posts the `payout_completed` journal once and notifies the owner.
- A late `failed` after `success` is ignored.
- `reversed` after success posts `payout_reversed`, which re-opens `owner_payable`. A person looks at why (T17).
- A transfer reference that isn't a gear payout falls through to the creator-payout handler.

## 5. Transfer Approval URL

`POST /api/webhooks/paystack/transfer-approval` approves (200) only a transfer that matches an instruction we created. It must have the same reference, the exact amount, the same recipient, and be in flight. Anything else is refused (400), including a bad signature or an unreadable body. **Do not enable the approval URL on the live Paystack account until the request shape and response codes are confirmed in test mode.**

## 6. Known gaps (not done)

- **Bank validation covers SA ID holders with personal accounts only.** `POST /api/banking` sets `banking_details.is_verified` only when four things hold: the profile is identity-verified, the account holder matches the verified name, a 13-digit SA ID number is supplied (used for the check, not stored), and Paystack `/bank/validate` confirms the account. Changing bank details clears it. Owners with a passport or a business account cannot be validated yet. Their payouts stay held (`payout_account_not_validated`) until a reviewed manual process exists (D-23).
- **A resolved dispute does not create a payout.** `PATCH /api/admin/disputes/[id]` moves `disputed → completed` without the `hire_earned`/`deposit_settled` journals or an `owner_payouts` row. Payouts for disputed community bookings must be handled by hand. For orders paid online, reconciliation flags them (`hire_not_recognised`, `deposit_still_held`).
- Who bears the transfer fee (D-18) is not decided. `owner_payouts.provider_fee_cents` exists but nothing fills it yet. Nothing is deducted from the owner amount.
