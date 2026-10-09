# Delivery operations (Phase 4)

The operations side of delivery: provider webhooks, the daily jobs, the
admin console, notifications, Ubunye's delivery tools and address retention.
Everything here calls the delivery use cases in
`lib/core/delivery/use-cases.ts`; nothing re-implements a delivery rule. See
`delivery-architecture.md` for the domain itself.

## Real time vs daily

| Source | When | What |
|---|---|---|
| Provider webhooks | real time | the primary source of courier state |
| Admin actions | real time | own-fleet legs, custody evidence, incidents, cancellations, re-drives |
| `/api/cron/rental-pipeline` | daily, 07:45 SAST | the safety net: retries, reconciliation, polling, reminders |
| `/api/cron/daily-maintenance` | daily, 02:00 SAST | address retention purge |

The current Vercel plan rejects sub-daily crons (CLAUDE.md), so the daily
pass is a safety net only. Anything urgent is done on receipt (webhook) or by
a person ("Run delivery jobs now" in the admin console). Moving to a plan
with hourly crons would shorten the time a missed webhook or an unknown
dispatch waits (R-43).

## Webhooks: `POST /api/webhooks/delivery/[provider]`

Generic for every courier. The route looks the provider up in the parser
registry (`lib/delivery/webhooks.ts`) and hands the raw request to the core
inbox (`receiveDeliveryWebhook` in `lib/delivery/inbox.ts`).

| Case | Answer | Stored? |
|---|---|---|
| unknown provider id | 404 | no |
| provider known, secret not configured | 503 | no |
| body over `DELIVERY_OPS.webhookMaxBodyBytes` | 413 | no |
| signature fails (or `verify` throws) | 401 | **no (D11)** |
| verified, not an event we use | 200 | no |
| verified, stored | 200 | yes, once (unique dedupe key, D12) |
| verified, already stored (replay) | 200 | no (duplicate) |
| verified, could not store | 500 | no; the provider retries |

The signature is checked before any database work. Once stored, the event is
processed once in the same request; a failure there still answers 200 (the
event is durable) and the daily drain retries it with back-off, then
dead-letters it after `DELIVERY_OPS.inboxMaxRetries` for a person
(Provider failures tab, "Requeue"). Provider states only ever move a leg
forward, so an out-of-order event is stored and ignored as `stale` (D13).

The proxy's Origin (CSRF) check exempts every `/api/webhooks/` path
(`proxy.ts`), so server-to-server webhooks are not blocked. Logs carry the
provider id, status and outcome only.

### Adding a courier's webhooks (the parser-registry API)

```ts
import { registerDeliveryWebhookParser, constantTimeEqual, hmacSha256 } from '@/lib/delivery/webhooks';

registerDeliveryWebhookParser('courier_id', (env) => {
  const secret = env.DELIVERY_PROVIDER_COURIER_ID_WEBHOOK_SECRET;
  if (!secret) return null; // not configured → 503, nothing stored
  return {
    providerId: 'courier_id', // must equal the registered id
    verify: (rawBody, headers) => constantTimeEqual(hmacSha256(secret, rawBody, 'hex'), headers['x-courier-signature'] ?? ''),
    parse: (rawBody) => /* ParsedDeliveryEvent | null */,
  };
});
```

1. Put that module in the adapter's own folder (e.g.
   `lib/delivery/courier_id/webhook.ts`).
2. Add one side-effect import to `lib/delivery/webhook-adapters.ts`:
   `import '@/lib/delivery/courier_id/webhook';`
3. Point the provider at `https://<host>/api/webhooks/delivery/courier_id`.

Rules: provider ids are `[a-z0-9_]`, one registration each. `verify` works on
the RAW body and the lower-cased header map, in constant time
(`constantTimeEqual`), and never throws on bad input (a throw is a failed
check). `parse` returns null for events we do not use; its `minimal` copy is
ids, states and timestamps only (no address, name, phone or photo). Use the
provider's event id as `eventId` when it has one; otherwise the dedupe key is
reference + state + provider timestamp.

## Daily pipeline steps (`lib/rental/pipeline.ts`)

Each step is isolated (one failing never stops the others), bounded
(`DELIVERY_OPS.inboxBatchSize`, `jobBatchSize`) and idempotent. They run
after the payment inbox and before the outbox, so the notices they queue go
out in the same pass.

| Step | What it does | Never does |
|---|---|---|
| `delivery_inbox` | `drainDeliveryInbox`: retries stored provider events that are due | apply an event twice |
| `delivery_reconcile` | dispatch intents left `unknown` (or a claim older than `staleClaimMinutes`): looks the job up at the provider by OUR merchant reference; found → recorded through `commitDelivery`; not found → staff alert | create a courier job on its own; book a second courier (D10) |
| `delivery_poll` | courier legs on the move with a provider reference: reads the job and applies it through `recordProviderEvent` with the webhook's dedupe key | move a leg backwards (D13); poll our own fleet |
| `delivery_return_reminders` | `delivery_return_reminder` once per return leg whose pickup window starts within `returnReminderLeadHours` | remind twice (dedupe key per shipment) |

Code: `lib/delivery/jobs.ts`. A dispatch the job could not find at the
provider stays `unknown` until a person presses "Reconcile with provider" /
"Dispatch" in the console, which runs `commitDelivery` as staff (ask first,
then create again with the SAME reference).

## Admin console: `/admin/delivery-ops`

API: `GET /api/admin/delivery` (queues), `GET /api/admin/delivery/[id]`
(one shipment's history and evidence), `POST /api/admin/delivery` (actions).
Every endpoint requires an admin session (`requireAdmin`); POST is rate
limited (`rateLimitAdmin(…, 'sensitive')`).

Queues: awaiting dispatch, scheduled pickups, couriers assigned, in transit,
delivered (waiting for the renter to accept), return pickups, failed jobs,
missing/damaged, unresolved incidents, provider failures (dead-lettered
webhooks, unknown or refused dispatches) and cost reconciliation (courier
legs with no invoice yet, recent reconciliations).

Actions, each through the use case as `{ kind: 'staff', userId }`:

| Action | Use case | Notes |
|---|---|---|
| `dispatch` | `commitDelivery` | approve and dispatch a prepared leg, or reconcile an unknown one |
| `advance_manual` | `advanceManualDelivery` | own fleet only: driver assigned, at pickup, on the way, at drop-off, attempt failed |
| `record_collection` | `confirmCollection` | photos must be https links to our storage; serial, accessories, condition |
| `record_handover` | `confirmHandover` | `delivered` (our driver), `exception` (opens an incident), `received`; never `accepted` (only the renter, D15) |
| `record_inspection` | `recordReturnInspection` | condition required |
| `report_incident` | `reportIncident` | nobody is accused; a lost/damaged/stolen report puts the leg under review |
| `resolve_incident` | `resolveIncident` | liability is chosen by the person (or `undetermined`); moves no money |
| `cancel` | `cancelDelivery` | unstarted legs only; refund and any provider fee passed on are worked out by the core |
| `reschedule` | (own fleet only) | logged as a staff event on the leg; the window is saved on the leg and the driver task. Couriers: cancel and quote again (no adapter supports rescheduling) |
| `reconcile_invoice` | `reconcileDelivery` | amount in integer cents |
| `quote_leg` | `quoteDelivery` | quote a leg for the renter (e.g. a return pickup by phone); the renter gets `delivery_quote_ready` and pays through checkout |
| `requeue_event`, `run_jobs` | `drainDeliveryInbox`, the daily jobs | re-drive the inbox and reconciliation now |
| `reveal_address` | — | one side of one shipment, for dispatch |

Logging: every action writes `platform_events` `delivery_ops_<action>` with
the staff id and ids/outcomes/amounts only, never an address, phone number
or free text. The use cases add the canonical delivery event, custody events
and proofs.

Addresses (D21): the queues and the detail never select an address, an
address id, a contact detail or the tracking link (a tracking page shows
where the renter is). `reveal_address` returns one side of one shipment
(`Cache-Control: no-store`) and is logged (`addressId`, side, shipment).

## Notifications (§4.19)

All 15 kinds in `RENTAL_NOTICE_KINDS` are queued from real events, through
the outbox (dedupe key per kind, channel, person and event), with amounts at
most, never an address:

| Kind | Real event | Where |
|---|---|---|
| `delivery_quote_ready` | staff quoted a leg for the renter | `quoteReadyNotices` (admin `quote_leg`) |
| `delivery_booked` | dispatch succeeded | `commitDelivery` |
| `delivery_courier_assigned` | provider / our driver assigned (outbound) | `recordProviderEvent` |
| `delivery_courier_at_pickup` | driver at pickup (owners, outbound; renter, return) | `recordProviderEvent` |
| `delivery_collected` | collected (outbound) | `recordProviderEvent`, `confirmCollection` |
| `delivery_in_transit` | on the way (outbound) | `recordProviderEvent` |
| `delivery_delivered` | delivered: please confirm | `recordProviderEvent`, `confirmHandover` |
| `delivery_attempt_failed` | failed attempt | `recordProviderEvent` |
| `delivery_return_reminder` | return pickup window starts soon | daily `remindReturnPickups` |
| `delivery_return_courier_assigned` | driver assigned (return) | `recordProviderEvent` |
| `delivery_return_collected` | return collected | `recordProviderEvent`, `confirmCollection` |
| `delivery_returned_for_inspection` | every item received back | `confirmHandover` |
| `delivery_incident` | incident opened | `recordProviderEvent`, `confirmHandover`, `reportIncident` |
| `delivery_cancelled` | leg cancelled or refused | `cancelDelivery`, `commitDelivery`, `recordProviderEvent` |
| `delivery_fee_refund` | delivery fee owed back | `cancelDelivery`, `commitDelivery`, `recordProviderEvent` |

Test: `tests/unit/delivery-ops-notices.test.ts`. A reschedule has no notice
kind of its own (staff agree the new window with the renter directly).

## Ubunye (§4.20)

Tools in `lib/agents/tools/delivery.ts`, given to both the booking and the
assistant agents (`getToolsForAgent`), described in their prompts:

| Tool | Use case | Kind |
|---|---|---|
| `check_delivery_eligibility` | `checkDeliveryEligibility` | read-only |
| `get_delivery_quote` | `quoteDelivery` | read-only (stores an expiring quote; charges nothing) |
| `get_delivery_status` | `getDeliveryStatus` | read-only; owners see only their items, no tracking link (D22) |
| `get_return_pickup_options` | `quoteDelivery` (return leg) | read-only |
| `report_delivery_issue` | `reportIncident` | state-changing, no money; rate limited; text sanitised |

The renter acts as `{ kind: 'agent', userId, approval: null }`; an owner as
`{ kind: 'owner' }`; anyone else gets "not found". Quotes exist only for
legs whose addresses are already on the order (a new outbound attempt, or
the return the way the gear came); a first delivery is chosen at checkout.
Answers carry a note forbidding invented prices, courier names, ETAs or
locations and any claim of insurance.

**Not built (next steps), D26:** `prepareDelivery`, `confirmDelivery`,
`scheduleReturnPickup` and `requestDeliveryCancellation` through Ubunye.
Each charges, refunds or commits a courier, so each needs the existing
prepare → approval card → commit pattern: a new agent action kind (e.g.
`delivery_return_pickup`, `delivery_cancellation`) in `AGENT_ACTION_KINDS`
plus a migration extending `agent_actions.kind`, a `requote` and `execute`
for it in `lib/agent/offers.ts` (execute passes
`approval: { verified: true, userId, amountCents }` to the use case), and
the approval card. Until then the model sends the person to their booking
page, and the core refuses an agent without a verified approval
(`scheduleReturnPickup`, `cancelDelivery`) and never lets an agent commit
(`commitDelivery`).

## Address retention (R-41, D-46)

`/api/cron/daily-maintenance` step 16 calls `purgeDeliveryAddresses`
(`lib/delivery/jobs.ts`). Renter and owner-handover addresses (never our own
sites) are reduced to suburb level — street, contact name, phone and
instructions removed, coordinates rounded to
`DELIVERY_OPS.purgedCoordinateDecimals` — `DELIVERY_POLICY.addressRetentionDays`
after the last activity (a leg closing, a quote being made).

Never purged while: any shipment using the address is open (anything but
cancelled, failed, or delivered AND accepted/received — so lost, damaged,
under review and delivered-but-unaccepted all keep it), the shipment has an
open incident, a quote using it is still live, or a paid quote has not been
dispatched. A kept address gets `retain_until` (tomorrow for open legs, end
of retention otherwise), so each run makes progress through a bounded batch.
A purged address cannot be used for a new quote (`getPoint` refuses redacted
addresses). Copies a courier holds are governed by the provider's terms.

## Configuration

`DELIVERY_OPS` in `lib/constants.ts`: webhook body limit, inbox batch and
retries, job batch, stale-claim minutes, return-reminder lead time, failed
look-back, purge batch and coordinate precision. Retention days, fees and
thresholds stay in `DELIVERY_POLICY` (founder decisions D-37…D-47).
