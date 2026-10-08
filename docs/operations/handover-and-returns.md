# Handover and returns (counter procedure)

**Status:** the code is on `phase-1-gear-pipeline`. Without migration 070 (not applied anywhere yet), both screens use the earlier guarded updates: no status history, no ledger, no refund obligation, no payout row.

Screens: `/admin/rentals/[id]/handover` and `/admin/rentals/[id]/return`. APIs: `POST /api/admin/rentals/[id]/handover` and `POST /api/admin/rentals/[id]/take-back`. Every rule below is enforced on the server. A disabled button is not the control.

## Dates

Bookings are by date and **inclusive**. Gear is due back by the end of its end date, in SAST (`returnDueAt`). The return day is not sold to anyone else. Same-day turnaround is a founder decision (D-21).

## Handover (`confirmed → active`)

Refused unless **all** of the following hold:

1. The booking is `confirmed` (paid, or marked paid with a reference).
2. Staff confirm they checked the person's ID against the account, **and** that the person collecting is the renter named on the booking. Nobody else collects.
3. The renter's identity verification is `verified` and the account is not suspended.
4. If the booking has `requires_manual_approval`, the risk approval box is ticked with a note of at least 5 characters. Any admin can approve. The code does not distinguish a manager.
5. Condition chosen, and at least one condition photo.
6. Serial number entered and matching the registered serial, when the item has one.
7. The renter has signed the current agreement version (`lib/rental/agreement.ts`). If the version changed, the page must be reloaded.
8. The handover location is recorded.

Recorded on the booking: `handover` (ID check, collector, signature, agreement version, serials, accessories, location, risk approval, staff id, time), `condition_at_checkout` and `checkout_photos`. Plus a status-history row and a "gear handed over" notice.

Collection-only rules are set at checkout: the first hire, and any item over `RENTAL_POLICY.highValueCollectionThresholdCents` (R50,000).

## Take-back (`active | overdue → return_pending → completed | disputed`)

Required: the return condition, at least one photo, and a note if a damage charge is entered (the renter sees it).

**Step 1. The gear is back.** The booking moves to `return_pending` with `return_evidence` attached: received by, serials confirmed, accessories returned, missing components, functional check, days late, photos. This is recorded even if settlement needs a person, so the unit is accounted for. It stays off sale until the next step.

**Step 2a. Disputed.** If staff tick "dispute", or the item has a registered serial that was not confirmed, the booking moves to `disputed` and a dispute notice goes out. Nothing is settled. The gear stays off sale (T24). Resolve it in `/admin/disputes`.

**Step 2b. Settle.**

- The outcome is worked out from the evidence: `missing_parts`, `damage` (damage charge or a faulty functional check), `late`, or `clean`.
- Late fee: `RENTAL_POLICIES.lateFeePerDayZar` per item for each started day after the return day, for at most `RENTAL_POLICIES.maxLateDays` days, never more than the deposit (D-25).
- Damage deduction: needs evidence (photos and a note). It is capped at the deposit. Anything above is invoiced separately, never taken.
- Deposit back:
  - **Card.** One `deposit_settlement` refund obligation, submitted immediately. If Paystack is slow or down, the daily job reconciles and retries; it never sends twice.
  - **EFT or cash.** Staff must choose the method and pay it back by hand.
- Ledger (card orders only): `hire_earned` and `deposit_settled`.
- Community gear: an `owner_payouts` row is scheduled 48h later ([payout-lifecycle.md](../payments/payout-lifecycle.md)).
- The booking moves to `completed`, and the renter is told the inspection is complete.

If the screen reports "The booking changed while you were working", someone else moved it. Reload and check before acting again.

## Overdue

The daily job marks `active` bookings `overdue` once the return time has passed. It then records each ladder stage once (`rental_escalations`) and queues a task in Rental ops:

| After | Stage | Renter notice | Staff task |
|---|---|---|---|
| +2h | reminder | yes | Check the reminder arrived |
| +24h | phone follow-up | yes | Phone the renter, record the outcome |
| +48h | formal escalation | yes | Decide on a letter of demand. New bookings for this renter are paused while the gear is out |
| +96h | senior review | no | Preserve evidence, decide on lawful recovery. Any SAPS report is a human decision |

Because the job is daily, a stage can be recorded up to about 24 hours after it becomes due. Record what was done with **Record** (an outcome is required). Nothing in the ladder accuses anyone, suspends an account or keeps a deposit automatically. See [incidents.md](incidents.md#lostunreturned-equipment) for lost or unreturned gear.
