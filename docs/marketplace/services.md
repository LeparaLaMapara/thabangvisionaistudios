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
| `lib/migrations/073-service-fulfilment.sql` | Columns, `declined` status, history table |

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
| cancel | client | paid, accepted | cancelled | Refund by the published tiers |

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
  revision, or raise a problem.
- A creator who must withdraw after accepting contacts the team (admin
  cancel refunds in full).

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
  no open dispute; due time reached.
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

The daily run emails the team a digest of payouts that need a person and those
held by a rule.

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
- The refund path (`refundPayment`) is the existing one; full refunds on decline
  were tested with a fake only.
- Email and notification wording has not been reviewed by the founder.
