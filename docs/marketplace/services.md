# Creative services: fulfilment, acceptance, disputes and payout timing

Spec §8.3. Covers **service bookings** (the `bookings` table: a creator's time
and work, e.g. a portrait shoot). Gear hire has separate rules
(`lib/core/rental`, `docs/payments/`); nothing here applies to gear.

| Where | What |
| --- | --- |
| `lib/core/services/fulfilment.ts` | The state machine, payout due time, payout eligibility (pure) |
| `lib/core/services/payouts.ts` | Stable transfer reference and reconcile-before-resend (pure) |
| `lib/payments/payout.ts` | Sends or reconciles one payout; the daily run |
| `lib/payments/service-transfers.ts` | Transfer webhooks (success / failed / reversed) |
| `app/api/service-bookings/[id]/status` | Accept, decline, approve, request revision, cancel |
| `app/api/service-bookings/[id]/deliver` | Creator delivers (link required) |
| `app/api/cron/daily-maintenance` | Auto-approval, payouts, alerts |
| `lib/payments/routing.ts` (`refundWithOutcome`) | Refunds with a classified result: refunded / rejected / unknown / manual |
| `lib/payments/service-refunds.ts` | Claim a refund before the provider is called; record the outcome only over the claim |
| `lib/migrations/073-service-fulfilment.sql` | Columns, `declined` status, history table, `unknown` refund outcome |

## The journey

```
pending ──client pays──▶ paid ──creator accepts──▶ accepted ──creator delivers──▶ delivered
                          │                          ▲                                │
                          │ creator declines         └──── client asks for a revision ┤ (bounded)
                          ▼                                                           │
                       declined                    client approves, or no answer     │
                    (full refund)                  within 7 days ───────────────────▶ completed
                                                                                      │
                                     payout due = completion + 72 hours, no open dispute
                                                                                      ▼
                                                                                  paid_out
```

| Action | Who | From | To | Notes |
| --- | --- | --- | --- | --- |
| accept | creator | paid | accepted | Client told |
| decline | creator | paid | declined | Full refund; team alerted to offer another creator |
| deliver | creator | accepted | delivered | Needs an http(s) link |
| approve_delivery | client | delivered | completed | Records `accepted_by_client_at`; schedules the payout; pays nothing now |
| request_revision | client | delivered | accepted | Needs a reason; at most `revisions_included` times |
| auto_approve | system | delivered | completed | After `autoApproveDeliveryAfterDays` (7) with no answer |
| cancel | client | paid, accepted | cancelled | Refund by the published tiers. Refused (`already_delivered`) once the work has been delivered, even after a revision request put it back to `accepted` |

Anything else is refused with a 400. Every write is a compare-and-set on the
status that was read; a lost race returns 409. Each change is appended to
`service_booking_events` (who, from, to, why).

The status route still accepts the older `{ status }` body the dashboards send.
A creator's `status: 'cancelled'` (what the old Decline button sent, which used
to fail) now means decline.

## What is agreed at booking time

`POST /api/service-bookings` records on the booking: deliverables, duration
(`duration_hours`), `revisions_included` (default
`STUDIO.booking.defaultRevisionsIncluded` = 1), `revision_policy` (the wording)
and `cancellation_policy` (`STUDIO.booking.cancellationPolicy`). The booking
confirmation page shows the revision and approval terms next to the
cancellation terms. Bookings created by the Ubunye booking tool do not yet
record these; the default allowance applies to them.

## Cancellation and decline

- **Creator declines**: the client gets everything back, whatever the notice,
  because the creator withdrew. Status `declined`. A failed or EFT/cash refund
  is flagged for a person.
- **Client cancels** (paid or accepted): the existing tiers
  (`STUDIO.booking.cancellationTiers`, 7-day cooling-off) decide the refund.
  No shoot date on record means a person assesses it.
- **After delivery** the client cannot cancel: they approve, ask for a
  revision, or raise a problem. This holds after a revision request too,
  although that moves the booking back to `accepted`: once the work has been
  delivered at least once, cancel is refused with code `already_delivered`
  (`hasBeenDelivered`: a `delivery_url` on record, which a revision request
  does not clear, or `revisions_used > 0`, or a current `delivered_at`). The
  client dashboard hides the Cancel button in that case. Before this, such a
  booking could be cancelled for up to a 100% automatic refund (shoot date far
  off, or inside the cooling-off period).
- A creator who must withdraw after accepting contacts the team (admin
  cancel refunds in full, unless a refund is already recorded: see below).

### Refund outcomes

Refunds on decline, client cancel and admin cancel go through
`refundWithOutcome`, which records one of these in
`bookings.cancellation_refund_status`:

| Outcome | Meaning | Staff told |
| --- | --- | --- |
| `refunded` | The provider accepted the refund | Nothing to do |
| `failed` | The provider refused it (4xx): nothing moved | Refund by hand |
| `unknown` | No clear answer (timeout, network error, 5xx): it **may** have gone through | **Check** the provider (refunds for the payment reference, or the dashboard) and refund by hand only if none is there |
| `manual_review` | Paid by EFT or cash, or no shoot date to measure notice | Refund / assess by hand |

`payment_status` becomes `refunded` only on a confirmed full refund, so after an
`unknown` it stays `paid`. An admin cancel therefore checks
`cancellation_refund_status` too: it sends **no** automatic refund when a refund
is recorded as `refunded`, `unknown` or `pending` (`refundAlreadyStarted`), and
answers `refund_status: 'already_started'`. This also covers a partial refund
that succeeded (payment still `paid`). When the refund is `manual_review` (a
person is handling it) or `not_required` (a cancellation already decided
nothing goes back), the cancel goes through without a refund, answers
`refund_status: 'not_claimed'` and emails the team to decide. An admin cancel
emails the team on `unknown`, `failed` or `manual_review`.

The client's cancellation email from an admin cancel names an amount ("A
refund of R… is being processed") only when the provider accepted the refund.
Otherwise (refused, unknown, by hand, or already handled elsewhere) it says
"Our team will be in touch with you about your refund", with no amount.

### Refunds are claimed before any money moves

The payment provider is not a lock: Paystack's refund call takes no
idempotency key (the adapter drops the one we pass). Before this, two admin
refunds that both read "no refund yet" both called Paystack: a double-clicked
admin cancel refunded once, the second call was refused ("fully reversed") and
wrote `failed` over `refunded`, and staff were emailed to refund by hand. Two
concurrent partial dispute refunds of R500 on R1000 both went through.

Now every service refund (`lib/payments/service-refunds.ts`) goes:

1. **Claim**: one conditional update sets `cancellation_refund_status =
   'pending'` (with the amount) only while the booking still has the status,
   payout status and refund status that were read, and the refund status is
   none or `failed`. Never over `manual_review`: that is a person's job.
   Whoever loses sends nothing and gets a 409 (`BOOKING_CHANGED`).
2. **Send** through `refundWithOutcome`.
3. **Record** the outcome only over `pending` (compare-and-set), so a late or
   repeated result never overwrites `refunded`, `unknown` or a person's record.

An admin cancel writes the status change in the same update as the claim, and
every admin status change is a compare-and-set on the status read. So an admin
cancel and a client cancellation at the same moment cannot both refund: the
second one's compare-and-set fails. The client's cancellation and the creator's
decline already claim this way (their status change writes `pending`) and now
record their outcome through the same helper.

**If the process dies between the claim and the record**, the booking stays
`pending`. That already blocks every automatic refund and the creator payout,
so nothing moves twice, but nothing tells anyone either: a person who sees a
booking with the refund `pending` for more than a few minutes checks the
provider's refunds for the payment reference and records what happened
(`refunded` with the amount, or clears it back to `failed` if nothing was
refunded).

### Never refund the client after the creator was paid

An admin cancel or a dispute refund is refused with 409 `PAYOUT_ALREADY_SENT`
when `payout_status` is `processing` or `paid`, or the booking is `paid_out`
(`payoutAlreadySent`). A person decides: the creator was already paid. The
claim also compares the payout status read, so a payout the daily run claims
between the admin's read and write wins and the refund is not sent.

The other way round, a booking with any refund recorded or started
(`cancellation_refund_status` set to anything but `not_required`) is not paid
out (`refund_recorded` in `checkServicePayoutEligibility`): the client has been
or may be refunded and `creator_amount` is not adjusted, so a person decides
the payout. The payout claim compares the refund status it read too.

Before migration 073 the database does not allow `unknown`: it is stored as
`pending` with "OUTCOME UNKNOWN, check the payment provider…" in
`cancellation_refund_error`, which blocks a repeat automatic refund the same way.

Yoco's refund call answers only success or failure, so a Yoco failure is
treated as `unknown`.

A refund from the admin dispute screen (`app/api/admin/disputes/[id]`) uses
the same classification and the same claim. It is refused when a refund is
already recorded (`refunded`, `unknown` or `pending`: `REFUND_ALREADY_STARTED`),
when a person is handling it (`manual_review` / `not_required`:
`REFUND_NEEDS_A_PERSON`) and after the creator was paid
(`PAYOUT_ALREADY_SENT`). It is capped at the booking total, and records its
outcome on the booking. An unknown outcome leaves the dispute open and tells
the admin to check the provider first. A refused one can be tried again,
because nothing moved.

## Disputes

A problem is raised through `POST /api/disputes`, which sets the booking to
`disputed`. A dispute in `open`, `investigating` or `escalated` holds the
payout. If the dispute lookup fails, the payout is held (fail closed). An admin
who resolves it for the creator sets the booking `completed`, which starts a
fresh 72-hour payout clock.

The dispute window runs until the payout is due (`dispute_window_ends_at` =
`payout_due_at`). `canRaiseServiceDispute` encodes this, but the disputes route
does not enforce the window yet (it is outside this change).

## Payout timing

- The payout is **due 72 hours** (`STUDIO.booking.payoutDelayHours`) after the
  work is approved, by the client or automatically.
- It is **sent** by the daily maintenance job (or an admin's "pay out" action),
  only when every rule holds: booking completed and marked paid; the provider
  confirms the client's payment for at least the total; creator ID-verified;
  bank account validated (`banking_details.is_verified` with a recipient code);
  no open dispute; no refund to the client recorded or under way; due time
  reached.
- Because the cron runs once a day (plan limit), a payout goes out on the first
  run after it falls due, so up to about a day after the 72 hours.
- **We never promise when money reaches the bank.** Messages say when we send
  it and that arrival depends on the creator's bank.

## Payout safety

- One transfer reference per booking, for life: `tvsp_<booking id without dashes>`.
- Before anything is sent again, the reference on record is looked up with the
  provider (`payoutPort.verifyTransfer`):
  - not found: send under the stable reference;
  - success: record it as paid (missed webhook);
  - pending / received: wait for the webhook;
  - failed / reversed / rejected / blocked / abandoned / otp: a person decides.
    Nothing is re-sent automatically.
- A definite refusal at send time marks the payout failed; the next run looks
  the reference up before trying again, up to `STUDIO.booking.maxPayoutAttempts`.
- An unknown outcome (timeout, 5xx) leaves it processing under the same
  reference; the next run looks it up.
- Older bookings carry a `payout-<ref>-<time>` reference. Webhooks for them
  still resolve. The daily run looks such a reference up; if the old scheme had
  already retried (earlier references lost), a person decides.
- The send goes through `payoutAdapterFor(['bankTransfers', 'transferVerification'])`,
  never a provider module directly.
- A reversal after a recorded success re-opens the booking (`completed`, payout
  `failed`) and alerts the team.

The daily run reads the **whole** payout queue (pages of 50, up to 1000
bookings) before processing it. It used to read only the 50 oldest rows, so
bookings held for good (creator not verified, no validated account) or waiting
for a person could fill that page every day: newer due payouts were never sent
and never reported. Now every due payout is reached, and the team's daily
digest lists every booking that needs a person and every one held by a rule.
If the queue ever exceeds 1000 rows, the digest says so.

The run works one payout at a time inside the daily maintenance cron
(`maxDuration` = 60 s, with many steps and the digest after it). It stops
**starting** new payouts once `PAYOUT_RUN_TIME_BUDGET_MS` (35 s) has passed
since the cron started; anything not reached is counted and the digest says
"N not processed this run (time budget)". They wait for the next run. The
order of work is: payouts in flight with the provider, then fresh due payouts,
then ones already known to be held or waiting for a person
(`payout_last_error` set, or a refused transfer). A held payout records why in
`payout_last_error` ("held: …", written only when it changes), so it does not
use up the budget before fresh payouts are reached. One slow provider call can
still run past the budget; the budget only stops new ones.

A stale `processing` payout under an old-scheme reference with retries
(`payout_retry_count > 0`) also goes to a person; it used to be looked up and,
when that one reference was not found, re-sent under the stable reference,
although an earlier attempt under a reference we no longer hold may have paid.

## Before migration 073 is applied

The code detects the missing columns and carries on without them: terms are
not recorded, the payout due time is worked out from `completed_at`, a decline
is stored as `cancelled` (still refunded in full), and history is not written.
Apply 073 on dev first, run `073-service-fulfilment.test.sql`, then production.

## Not verified live

- Nothing here has been run against Paystack. The transfer lookup
  (`GET /transfer/verify/:reference`) and its "not found" answer, and whether
  Paystack refuses a reused reference, follow its documentation and still need
  confirming in test mode (see `docs/payments/`).
- Migration 073 was checked on a local Postgres stub with a stand-in `bookings`
  table, not on the Supabase dev or production projects.
- The refund path (`refundWithOutcome` over the Paystack payment adapter) was
  tested with fakes only. Paystack's refund response fields and its answer to
  a refund it will not make still need confirming in test mode.
- The `unknown` refund outcome in 073 was not run on any Postgres (no local
  server could be started for the review fixes).
- Email and notification wording has not been reviewed by the founder.
- The refund claim and the payout time budget were tested with in-memory
  fakes (two requests interleaved by hand, a fake clock), not against
  Supabase: the claim relies on PostgREST applying the update's filters
  atomically, which it does for a single-row update.
