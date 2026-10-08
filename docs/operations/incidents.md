# Incident runbooks

Short checklists. Each assumes migration 070 is applied. It is not applied anywhere yet: until it is, the Rental ops queues report "Migration 070 is not applied" and most tables named here do not exist.

Screens: **Rental ops** `/admin/rental-ops` (API `GET/POST /api/admin/rental-ops`), **Bookings** `/admin/bookings`, **Handover/Return** `/admin/rentals/[id]/handover|return`, **Disputes** `/admin/disputes`, **Verifications** `/admin/verifications`, **Users** `/admin/users`.

Switches (Vercel env vars, take effect on redeploy):

- `PAYMENTS_OFF=true` turns online payment off. Checkout falls back to EFT/cash holds, and the webhook answers 503 so Paystack retries later.
- `MAINTENANCE_MODE=true` closes the site.

Write down every action taken in the incident record (who, when, what, why). Never edit `ledger_journals`, `ledger_lines` or `booking_status_history`. They are append-only by design.

---

## Paystack outage

1. Confirm the outage on Paystack's status page or dashboard. Rental ops will show `payment-inbox-backlog` or refunds/payouts stuck in `claimed`.
2. Do nothing destructive. Refunds and payouts with an unknown outcome stay `claimed` and are **reconciled with Paystack before any retry**. Do not resend them by hand, and do not create new references.
3. If checkouts are failing for customers, set `PAYMENTS_OFF=true` until Paystack recovers. Holds made during the outage expire on their own.
4. After recovery: in Rental ops, press **Run pipeline**. Then check:
   - every `refund_obligations` row in `claimed`/`requested` has moved on;
   - no `owner_payouts` row is left in `claimed`;
   - `payment_events` has no `dead` rows.
5. Paystack redelivers webhooks it could not deliver. How long it keeps retrying is NEEDS_VERIFICATION. For any charge visible in Paystack whose order is still `pending`, see "Double-payment investigation" step 2 and requeue or escalate.

## Refund failures

1. Source: the Rental ops refunds list, or finding `rental-refund-failed`/`rental-refund-stuck`. Open the `refund_obligations` row and read `state`, `last_error`, `provider_refund_id` and `attempts`.
2. **If `provider_refund_id` is set, the refund exists at Paystack. Do not press Retry.** Retry reopens the obligation and sends a new refund request. Resolve it in the Paystack dashboard instead (for example, supply the customer's bank details for a `needs-attention` refund). The webhook will then move the obligation.
3. If `provider_refund_id` is empty and the state is `failed` (Paystack refused it): fix the cause from `last_error`, check the Paystack dashboard shows no refund on that transaction, then press **Retry refund**.
4. Stuck in `pending`/`processing` for over 72h: look it up in Paystack and wait for the bank. Tell the customer the honest status ("initiated, not complete").
5. Never refund from the Paystack dashboard without an obligation. A refund made outside the app matches nothing (`unknown_refund`) and breaks reconciliation.
6. Deposits paid by EFT/cash are refunded by hand. Record the method and date on the booking (take-back screen).

## Double-payment investigation

1. Gather the evidence for the order: `rental_payment_intents` (by `reference` = order id), `payment_events` (by `provider_reference`), `ledger_journals` with keys `payment:<txn>` and `unallocated:<txn>`, and the Paystack dashboard for the customer and amount.
2. Cases:
   - **Same transaction delivered twice.** Expected and harmless: the second event's outcome is `duplicate`. Nothing to do.
   - **Two different successful transactions on one order.** The second is held as `mismatch` (finding `rental-unallocated-money`). Once you have checked it, use Rental ops → **refund unallocated** with a note. That refunds the second charge in full. Never refund the transaction that confirmed the booking.
   - **Paid online after staff marked the order paid by EFT/cash.** **Not detected automatically.** The webhook treats the order as already confirmed (`duplicate`): no intent update, no journal, no alert. Find these with `payment_events.outcome = 'duplicate'` where the matching intent is still `initiated`. One of the two payments must be returned by hand. Risk register R-22.
3. Tell the customer what happened and when the money will be back.

## Lost or unreturned equipment

1. The overdue ladder runs daily and creates tasks in Rental ops (+2h, +24h, +48h, +96h). **Acknowledge** each one with what was done.
2. +48h, formal escalation: new bookings for that renter are paused automatically while the gear is out. Decide whether to send a letter of demand. That is a human decision.
3. +96h, senior review: preserve the evidence. That means the handover record (`equipment_bookings.handover`: ID check, signature, serials, location, staff), `checkout_photos`, the booking history and all contact attempts. Do not delete the renter's account or verification data while recovery is open.
4. Any SAPS report, insurer notice (insurance position: D-15, REQUIRES_FOUNDER_APPROVAL) or claim against the deposit is decided by a person and recorded with reasons. Nothing is confiscated automatically. A claim above the deposit is invoiced.
5. The unit stays off sale on its own while the booking is `overdue`. If it is written off, take it off sale permanently before closing the booking. Insert a `rental_blocks` row with `reason = 'lost'` (SQL with the service role; there is no screen yet).
6. For community-owned gear, tell the owner, and hold the payout (if any) in Rental ops with a reason.

## Database restore

1. Turn on `MAINTENANCE_MODE=true` and `PAYMENTS_OFF=true`. Webhooks then get 503 and Paystack retries later (retry window NEEDS_VERIFICATION).
2. Restore through the Supabase dashboard. Which backup or point-in-time options the current plan includes is NEEDS_VERIFICATION. Restore **DEV** first if you are rehearsing. Never test restores on production.
3. After the restore, list everything Paystack recorded after the restore point: charges, refunds and transfers. Each must exist in `payment_events`, `refund_obligations` and `owner_payouts`. Money tables may have lost rows written after the restore point.
4. Check which migrations are present (067, 068, 069 and 070). Re-run the test scripts on DEV only.
5. Turn payments and the site back on. In Rental ops, press **Run pipeline**. Then run the invariant sweep and work through every finding.
6. Missing webhook events: ask Paystack to resend them, or requeue from the dashboard if available (NEEDS_VERIFICATION). Anything that cannot be replayed is recorded by a person, with a reversing or correcting journal, never an edit.

## Identity-verification failure

1. At the counter: if the person does not match the verified ID, or is not the renter on the booking, **do not hand over**. The handover screen refuses an unverified or suspended renter anyway.
2. Cancel the booking as staff with a reason (`PATCH /api/admin/equipment-bookings/[id]`, from Bookings). For a paid booking this creates one capped refund obligation. Manual payments get a staff alert to refund by hand.
3. In the verification queue (`/admin/verifications`), decisions are made by a person. No AI score decides on its own. Record the reason for a rejection; the renter can challenge it.
4. If you suspect fraud: suspend the account in `/admin/users` with a reason, keep the evidence, and do not accuse anyone in messages. ID images are deleted 30 days after review, so save what the case needs before then.

## Account takeover

1. Suspend the account in `/admin/users` (with a reason). Then sign the user out of all sessions from the Supabase Auth dashboard.
2. Hold every scheduled or approved payout for that user in Rental ops (**Hold**, with a reason).
3. Check `security_audit_log` and `platform_events` (`security_write_denied`) for recent changes, especially a new payout recipient on `banking_details`. A changed recipient must be re-validated before any payout is released.
4. Check the account's open bookings. Do not hand over gear while the case is open.
5. Contact the real owner through a channel already on record (not one that was just changed). Restore access only after the owner is confirmed. If personal data was exposed, follow the next runbook.

## Suspected personal-data breach

1. Contain first: rotate any exposed key (Supabase service role, Paystack secret, email credentials), revoke sessions and close the hole. Note that the production service-role key is shared with other apps (risk register R-1; `database-isolation.md`). Treat a leak from any of them as a ThabangVision leak.
2. Tell the Information Officer (`STUDIO.legal.informationOfficer`) at once, and start an incident record: what data, whose, when, how, and what has been done.
3. Preserve logs (Vercel, Supabase, `security_audit_log`, `platform_events`) before they roll over.
4. Under POPIA section 22, the Information Regulator and the affected people must be notified as soon as reasonably possible after the breach is discovered. The exact procedure and wording are REQUIRES_LEGAL_REVIEW. Do not delay containment while that is checked.
5. Bank details and ID documents are the most sensitive data held. Identify whether `banking_details` or the `verifications` storage bucket were reached.
6. Afterwards, record the cause and the fix, and add a test or invariant that would catch it.
