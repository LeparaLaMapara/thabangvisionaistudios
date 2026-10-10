# Delivery architecture (Phase 4)

Delivery, logistics and reverse logistics for gear hire in Gauteng. This is the
core (milestone 4A and the core of 4C): domain rules, ports, the own-vehicle
(manual) adapter, the Supabase adapters, the webhook inbox and migration 076.
Checkout integration, webhook routes, admin pages, Ubunye tools and real
courier adapters are built on top of it by later workstreams.

## Layout

```
lib/core/delivery/            pure: no Supabase, Next.js or provider code
  capabilities.ts             what an adapter can verifiably do
  port.ts                     DeliveryPort, AddressPort, DeliveryInsurancePort
  state.ts                    shipment-leg state machine, ranks, provider mapping
  policy.ts                   eligibility, service area, courier threshold, risk gate
  select.ts                   provider selection (gates first, then preferences)
  quote.ts                    customer quote: provider cost + platform fee, expiry
  custody.ts                  per-item chain of custody rules
  incidents.ts                incidents, late-fee and settlement guards
  repository.ts               DeliveryRepository and the other ports the use cases need
  use-cases.ts                checkDeliveryEligibility … reconcileDelivery
lib/delivery/                 adapters
  quote.ts                    own-vehicle formula (cents) + the old rands wrapper
  manual.ts                   own-vehicle / staff adapter (DeliveryPort)
  ports.ts                    provider registry from env, refuse-everything adapter, insurance stub
  repos.ts                    Supabase adapters (service role)
  inbox.ts                    provider webhook inbox (store → ack → process → retry → dead letter)
  server.ts                   production wiring: deliveryDeps(), deliveryInboxDeps()
lib/migrations/076-delivery.sql (+ .test.sql)
```

The rental rules are not duplicated: the delivery policy calls
`checkEligibility` and `collectionReasons` from `lib/core/rental/trust.ts`, so
first hire in person, items over the high-value threshold in person, and the
trust-tier limits are enforced exactly as at checkout.

## Who may have gear delivered

1. Trust tier, account holds and limits: `checkEligibility(..., delivery: true)`.
2. First hire: collection in person (`first_hire`). Delivery opens after a
   qualifying clean return.
3. Any item over `RENTAL_POLICY.highValueCollectionThresholdCents` (R50,000):
   collection in person (`high_value_item`).
4. The renter-side address (destination out, origin back) must be verified and
   in `STUDIO.serviceArea.province` (Gauteng). Outside: `out_of_area`, travel by
   quotation.
5. Modes:
   - **own fleet** (our vehicle and staff): on when
     `STUDIO.fulfilment.delivery.enabled`, as today;
   - **courier** (automated third party): only when the `delivery_courier`
     flag is on AND every item is at or below
     `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents`. The shipped value is
     **0, so automated courier delivery is off for every item** until the
     founder sets it (D-37).
6. The return leg applies the same rules (gear collected in person is returned
   in person) but does not count the gear twice against the limit.

No eligible option never blocks the booking: collection in person stays.

## Provider risk gate and selection

A provider is offered only if it passes, in order:

1. legal/contractual: enabled, not a sandbox adapter (unless explicitly
   allowed outside production), courier value threshold;
2. verified transit cover (couriers): `DeliveryInsurancePort.coverFor` says
   covered with a policy reference, and every item is within its limit. The
   stub answers "not covered" until `DELIVERY_POLICY.insurance` holds a
   verified policy (D-41). A provider's liability limit is not cover;
3. custody capabilities: `pickupConfirmation`, `proofOfDelivery`,
   `noLeaveAtDoor` (hand-to-hand) and `idempotentCreate` (our stable
   reference refused twice, or looked up); `reverseLogistics` for returns;
   `scheduled` or `onDemand` for the window;
4. serviceability (area) and 5. a quote for the window — a provider that is
   down is skipped with a reason and the rest are still offered.

Survivors are ordered by `DELIVERY_POLICY.providerPreferences.rankBy`
(reliability, speed, price by default). Ranking is configuration, never code.
A failing provider is excluded whatever its price.

Our own fleet proves custody with our own evidence (staff photos and the
renter's acceptance in the app) and is not subject to the courier cover gate;
it records `coverage_verified = false` (D-40).

## Money

- Integer cents everywhere. A quote stores `quote_amount_cents` (provider's
  quote), `provider_cost_cents`, `platform_fee_cents` and
  `customer_fee_cents = provider cost + platform fee` (own fleet: no fee; the
  own-vehicle formula is the customer price).
- Each leg has its own quote. Quotes expire (`quoteTtlMinutes`, never later
  than the provider's quote). `priceDeliveryForCheckout` refuses an expired or
  foreign quote and refuses any browser-sent amount that differs (D07, D08).
- Delivery money is never part of the owner's 80% hire share.
- Ledger (`lib/core/rental/ledger.ts`):
  - the fee is collected into `unearned_hire` with the order (unchanged);
  - `deliveryEarned({ leg, attempt })` → `delivery:{group}:{leg}` (attempt 1;
    later attempts `delivery:{group}:{leg}:a{n}`) moves it to
    `delivery_income` when the leg is done: outbound when every item is
    accepted by the renter, return when every item is received back;
  - `courierCost` → `courier_costs` / `delivery_payable` when a courier job is
    booked; invoices adjust it (`reconcileDelivery`);
  - `deliveryCancelled` → refund owed (`refunds_payable`) and anything kept
    (a provider cancellation fee passed on at cost, D-39) as `delivery_income`.
    The refund obligation is capped in SQL at what is LEFT of the ORDER's
    charge: the charge less every obligation already on the order, whatever
    its reason and whichever reference it was filed under (delivery fees
    under the intent reference, hire, deposit and staff refunds under the
    provider's transaction id; review fix round 2). A leg's refund can never
    take the order above what was charged; with no verified charge on record
    nothing goes to the provider and staff are alerted. `chargeOfBooking`
    (hire and staff refunds) counts the delivery refunds the same way;
  - a fee already EARNED (`acceptedAt` set) that is refunded after all (a
    review closed as failed with a refund, a staff refund on a delivered leg)
    reverses the income instead (`deliveryEarnedRefund`: `delivery_income` →
    `refunds_payable`); `deliveryCancelled` would release unearned hire a
    second time. Both journals share the key `delivery-cancel:{shipment}`, so
    a leg's fee is refunded in the ledger once;
  - a fee NOT yet earned on a leg that stays open after the refund (a staff
    refund on a delivered leg, or one lost, damaged or under review) could
    still be earned later (the renter accepts, deemed acceptance, a review
    closed as delivered). Its refund posts `deliveryEarned` and then
    `deliveryEarnedRefund` (the same net effect as `deliveryCancelled`), so
    any later earn of that attempt of the leg dedupes on its key; every
    earn site also skips a fee whose quote is `refunded`, and deemed
    acceptance skips such a leg (and a leg whose booking lines are all
    cancelled) entirely (review fix round 3, D-56);
  - a fee paid by hand (`manual:` reference, D-50) never entered the ledger:
    no delivery journals are posted for it and its refund is made by a person;
  - the legacy `deliveryEarned({ bookingGroupId })` keeps its old key
    `delivery:{group}` for pre-Phase-4 own-vehicle orders (one fee per order).
    Mapping it to the outbound leg would give orders already part-way through a
    second, differently keyed journal. An order uses one form, never both
    (R-39).

## Dispatch: prepare, then commit

`prepareDelivery` validates the booking, the renter, the items against the
quote (the same listings, units and hire days the quote was priced for: its
line snapshot), eligibility (again, on today's facts), the provider gate and
cover, and creates the shipment leg plus a durable **dispatch intent** with a
stable merchant reference `tvd_{group}_{o|r}{attempt}` and idempotency key. It
is idempotent: a live shipment for the same leg is returned.

A quote is dispatched at most once. Cancelling a paid leg, a refused
dispatch and a provider cancellation all move its quote to `refunded` (or
`consumed` when the fee was kept), and prepare refuses any quote a leg was
already made from, so a payment replay (webhook duplicate, missed-payment
recovery) can never send attempt 2 on an already-refunded fee. A re-attempt
needs a new quote and its own payment. `delivery_create_shipment` also
refuses, under a lock, a quote that is no longer `active` or `paid`.

`commitDelivery` (server after a verified payment, or staff; never an agent):

1. payment verified, fee paid, lines in the right status;
2. if the intent is `unknown` (or a stale claim): **ask the provider first**
   (`findByMerchantReference`). Found → record it. Not found → create again with
   the SAME reference. Provider unreachable → stop (`reconcile_pending`);
3. claim the intent (compare-and-set); one caller wins;
4. call `createDelivery`:
   - ok → shipment `scheduled` (or the provider's later state), cost journal,
     notice; then the intent is closed;
   - unknown (timeout, 5xx, exception) → intent `unknown`, nothing else; staff
     alerted; never a second courier (D10);
   - rejected → shipment `failed` and the fee refund obligation in one
     transaction, then the intent is closed (D24). The hire itself is
     untouched: collection in person remains.

## Shipment-leg states

```
requested → quoted → prepared → booking → scheduled → courier_assigned
  → courier_at_pickup → collected → in_transit → courier_at_dropoff → delivered
exceptions: cancelled, failed (final), delivery_attempt_failed, return_to_sender,
            lost, damaged, incident_under_review
```

Every allowed move, and who may make it (system, provider, staff), is listed
in `DELIVERY_TRANSITIONS`. Provider updates are applied only forward by rank;
the only sideways moves (a re-attempt after a failed attempt) also need a
newer provider timestamp. A late "in transit" can never overwrite
"delivered"; nothing a provider says pulls a leg out of `lost` or
`incident_under_review` (D13). Replays are applied once (unique dedupe key per
event, D12). Unverified input is refused and cannot be stored (D11).

The delivery state is **separate from the booking status**. Gear can be in
transit while the hire is `confirmed`; a courier's "delivered" never makes a
hire `active`.

## Chain of custody

Per physical item (booking line + listing), append-only:

| Event | Leg | Recorded by | Evidence |
|---|---|---|---|
| handed_to_courier | outbound | the item's owner, or staff | photo |
| collected_by_courier | both | courier (provider confirmation) or our staff driver | provider proof / photo |
| delivered_to_renter | outbound | courier or our staff driver | provider proof / photo |
| renter_accepted | outbound | **only the booking's renter** | in-app acceptance (authenticated, `POST /api/delivery/accept`) |
| renter_reported_exception | outbound | the renter, or staff for them | what is wrong (opens an incident) |
| deemed_accepted | outbound | the system only (D-48) | no answer within `deemedAcceptanceHours` of a recorded delivery, after a reminder; never over an exception or open incident |
| staff_confirmed_received | outbound | staff only, closing a review as delivered | the reason (in `condition`); settles an item with a renter exception as received |
| handed_to_return_courier | return | the renter, or staff | photo; only staff's record (or the courier's `collected_by_courier`) ends the renter's possession for late fees (`endsRenterPossession`) |
| received_by_owner | return | the item's owner, or staff | photo |
| inspected | return | staff | condition |

- A courier's "delivered" records the courier's side only; receipt is
  certified by the renter's acceptance or exception (D15). The renter answers
  per item on the booking page ("Received" / "Report a problem"). With no
  answer, the daily pipeline reminds them once and then records
  `deemed_accepted` (D-48): it earns the outbound fee and lets the address
  follow retention, and is never used for a return leg's inspection, a leg
  whose fee was refunded or a leg whose booking is cancelled (D-56).
- Each item has its own chain (D28): an exception on a lens does not affect
  the camera.
- Every event names the shipment, the order and the booking line (D14).
- Events never go backwards; a replay is stored once.
- Drivers see a generic label (`DELIVERY_POLICY.driverLabel`), never the
  value or an ID record.

## When the rental period starts and ends

**Unchanged: the rental period is date-based** (the booked start date to the
end of the booked end date, SAST), exactly as for collection. Custody
timestamps are recorded alongside but do not move the period. This is a
founder decision (D-42): if the period should instead start at renter
acceptance and end at courier collection, that is a deliberate change to the
pricing, overdue and late-fee rules, not something to infer from courier
timestamps.

- The hire becomes `active` through the existing handover flow, not through a
  delivery event.
- Courier collection of a return does **not** end the renter's responsibility
  for settlement and does **not** release the deposit (D17): every item must be
  received back and inspected (`checkRentalSettlement`).
- A delay, no-show or failed collection on the return leg that staff (or the
  provider's own event) attributed to the provider means no automatic late
  fee (D19). An unattributed one holds settlement for a person while open and
  never waives the fee by itself (D-51).
- Any open delivery incident on the line holds settlement (D29).
- When a return pickup takes the gear from the renter, that moment is the
  return time for the late fee and the overdue ladder stops chasing (D-49);
  the deposit still waits for receipt and inspection.

## Incidents

`lost`, `damaged`, `stolen`, `delayed`, `failed_attempt`, `driver_no_show`.
Opened by provider events (lost, damaged, failed attempt), by a renter
exception, or reported by the renter, the item's owner or staff. Each starts
`open` with `liability = 'undetermined'`: no automatic theft accusation, no
automatic deposit forfeiture. Only staff resolve one, with a reason.

An incident covers the reporter's own lines: an owner's report only their
items, the renter's the order's lines; staff may name lines. It holds
settlement only for those lines. `providerCaused` is set only by staff or a
provider's own event (a provider reporting the parcel lost); a renter, owner
or Ubunye report starts unattributed (D-51). A leg left under review, lost,
damaged or returning to the sender is closed by staff to a final state with
a reason (`closeDeliveryReview`; closing an outbound leg as delivered needs
the staff decision that the renter has the gear (`confirmReceived`): it
records `staff_confirmed_received` per item, sets `acceptedAt` and earns the
fee once; optionally refunding the fee on a leg that
failed).

## Collection from the owner's address (Phase 8, migration 080)

Until Phase 8 every leg ran between OUR SITE and the renter: community
owners keep their gear at home and had to bring it to the studio. Now gear
can be collected from (and returned to) the owner's own address. Own vehicle
first; couriers stay off (D-41) and plug in through the same `DeliveryPort`
(an adapter only ever sees `from` and `to` points; it never knows whether a
point is our site or an owner).

**Origin of a leg.** Each leg has an origin (`originOwnerId`, column
`origin_owner_id` on quotes and shipments): `null` = our site, else the owner
whose pickup address is the gear's end of the leg (outbound origin, return
destination). A line's gear is collected from its owner only when
`ownerPickupDecision` (`lib/core/delivery/origin.ts`) says so (D-86): a live
community listing the owner opted in (`listing_private.owner_pickup`, per
listing, default off), an owner whose ID is verified and who is not
suspended, and an active pickup address the server verified inside the
service area. Anything else goes from the studio exactly as before (the
owner brings it in). The decision is read on the server by
`DeliveryDeps.origins` (`lib/delivery/origins.ts`); without that port every
leg is the studio and an owner leg is refused (fail closed).

**Legs by origin.** `quoteCartDelivery` splits the cart by origin
(`deliveryOriginPlan`, studio first, then owners by id) and quotes one
outbound leg per origin and, when asked, one return leg back to each origin,
each priced by the provider from that origin (own vehicle:
`quoteOwnVehicleCents` from the leg's actual `from`, so no new price). The
renter sees one line per trip and the total before paying.

**Pricing from a coarse point (D-93).** The renter sees each owner trip's fee
separately, and the own-vehicle fee follows distance to 0.1 km: priced from
the owner's exact point, three quotes from three of the renter's own
addresses would place the owner's house to about 100 m without booking. So
the OWNER's end of a leg is priced from `coarsePricingPoint`
(`lib/core/delivery/origin.ts`): the owner's verified point snapped to the
centre of its `DELIVERY_POLICY.ownerPickup.pricingGridDegrees` cell (0.02
degrees, about 2 km), with only the area fields kept (suburb, city, postal
code, province; never the street or the contact, so a courier quote that
geocodes a street cannot price the house either). Every owner in one cell gets
the same price from the same renter address; the renter learns the cell at
most. The provider's cost on that quote comes from the same coarse point. The
driver still goes to the real address: dispatch (`commitDelivery`) reads the
stored address ids. Studio legs are priced exactly as before, from the same
objects (byte-identical requests). The renter may pay slightly more or less
than the exact distance would give (at most about 1.5 km of distance either
way). Tested in `tests/unit/delivery-owner-pickup-review.test.ts` (P1). With several origins the renter's rules (trust limit, holds, first
hire, high value) are checked on the WHOLE order before any part is quoted
(D-85). `prepareDelivery` keeps one live leg per order + leg + ORIGIN and
re-checks, for an owner leg, that every line is that owner's and that the
owner-side address is still their ACTIVE pickup address with the pickup
still allowed; if not (`origin_unavailable`) the paid fee is refunded at once
and staff arrange the gear from the studio.

**Keys (D-84).** Every per-leg key carries an origin discriminator that is
empty for the studio, so a studio-only order keeps every key it had:

| Key | Studio leg (unchanged) | Leg from owner X |
|---|---|---|
| merchant reference | `tvd_{group}_{o\|r}{n}` | `tvd_{group}_{o\|r}{n}_{X without dashes}` |
| dispatch idempotency key | `delivery-dispatch:{group}:{leg}:{n}` | `delivery-dispatch:{group}:{leg}@{X}:{n}` |
| ledger earn journal | `delivery:{group}:{leg}[:a{n}]` | `delivery:{group}:{leg}@{X}[:a{n}]` |
| fee refund / cancel / courier cost | per shipment (`delivery-cancel:{shipment}` …) | the same, per shipment |

So each origin's fee is earned once, under its own key, and the ledger
balances per journal and in total (delivery income = the fees earned; tested
in `tests/unit/delivery-owner-pickup.test.ts` and journey H).

**Custody at the owner's door (D-87).**

| Event | Leg | Who | Evidence |
|---|---|---|---|
| handed_to_courier | outbound from the owner | the item's owner (Listings → "Handed to our driver") | photo |
| collected_by_courier | both | our driver (staff) or the courier | photo / provider proof |
| received_by_owner | return to the owner | the owner ("Received back"), or staff for them | photo |
| inspected | return to the owner | **the owner**, with the condition (same press), or staff | condition |

**When the owner can confirm a return.** Only once the gear has left the
renter: the return leg is `courier_at_dropoff`, `delivered` or
`incident_under_review`, or the item's own chain shows its collection from
the renter (`collected_by_courier`, `handed_to_return_courier`), or its
receipt is already recorded (inspection still to come). One predicate,
`ownerMayConfirmReturn` (`lib/core/delivery/custody.ts`), is enforced by the
core (`confirmOwnerReturn`, and `confirmHandover` for an owner caller) and
drives the owner's `can_confirm_return`. Before that the owner-handover route
answers 409 `not_returned_yet`. Without it, an owner could mark a scheduled
return (gear still at the renter's) received and inspected: the return fee
earned, settlement and the owner's payout released, the renter's deposit
released early.

A problem on return ("Report a problem"): a **damaged** item records the
receipt and the owner's inspection with the problem, and opens an incident
(liability undetermined, nobody accused) for that line only: it holds
settlement and the owner's payout for that line until staff resolve it. A
**missing** item (`lost`) is not a receipt: only the incident is recorded (no
`received_by_owner`, no `inspected`, nothing earned) and the leg goes to
`incident_under_review` where the state rules allow it; staff decide. An
owner can inspect only on a return to THEIR address, only their own items
(custody rule `ownerInspects`); studio returns are inspected by staff as
before.

**Notices to the owner.** `owner_pickup_scheduled` (a collection from, or a
return to, their address is booked), `owner_pickup_collected` (our driver
collected it), `owner_gear_returned` (the gear is back at their address,
please confirm). Data: the leg only. Link: Listings → "Pickups from your
address". Never the renter's details.

**Settlement.** Unchanged rule: a return leg's items must be received back
and inspected (D17); for a return to the owner that inspection is the
owner's. Staff still complete the counter take-back for the order, which
waits on the same guard. A renter who chose no return pickup brings
everything back to the studio; the owner collects their gear there.

**Cancelling an order with gear out (R-84).** "The renter may still have the
gear" is decided PER ORIGIN (`originsWithGearAtRenter`,
`lib/rental/delivery-settlement.ts`, mirrored per origin by 080's
`delivery_cancelled_orders_to_settle`): an outbound leg of that origin
reached the renter and no return leg of the SAME origin brought it back or is
under review. That origin's cancellable return pickup is kept (never
cancelled or refunded with the order) and staff are alerted; other origins'
cancellable legs are cancelled as before. A studio-only order is decided
exactly as before.

**Unused-quote refund alerts.** The staff alert for a paid quote whose leg
never ran is keyed per quote (`{group}:{leg}[@owner]:{fee}:{quote id}`), so
two owners' trips refunded at the same fee are two alerts, never one dropped
as a duplicate (an EFT refund staff must make by hand would otherwise be
missed).

**Privacy (D-88).** The pickup address is a `delivery_addresses` row
(`purpose = 'owner_pickup'`): only the owner reads it (RLS), staff only
through the audited reveal, renters see the suburb at most, other users
nothing. The owner sees only their own items on a leg, never the renter or
the fee or a tracking link (`lib/delivery/owner-view.ts`). The renter never
gets the courier tracking link of a leg from or back to an owner's address
either (a courier's tracking page shows the pickup or drop-off point):
`getDeliveryStatus` and `customerLegs` drop it; staff still see it. The
renter's own quotes are readable through a column grant without the
provider's cost or where the gear is (080 section 8), and the fee itself is
priced from the coarse cell (D-93).

**The owner's pickup address** is replaced through
`delivery_save_owner_pickup` (080): the old row is retired and the new one
stored in one transaction, so a failed insert never leaves the owner with no
address. It cannot change while a live leg uses it; "live" is filtered in the
database (not cancelled or failed, and not delivered-and-accepted), so a long
history never hides one.

## Data and access (migration 076)

Legs are folded into `delivery_shipments`: one row per order + leg + attempt
(+ origin since 080), so retries and failures keep their history; at most one
live attempt per leg and origin.

| Table | Who can read (besides the server) |
|---|---|
| delivery_addresses | the person whose address it is. Never owners or other users (D21). An owner's pickup address (080): the owner only; staff by audited reveal; never the renter (D-88) |
| delivery_quotes | the renter: their fee, status, window and lines; not the provider's cost, platform fee, provider quote ref, origin owner or address ids (column grant, 080) |
| delivery_shipments | the renter and the owners of gear on it, **only** non-sensitive columns (no address ids, tracking link or money) (D22) |
| delivery_events | the renter, without `actor_id` or staff `note` |
| delivery_custody_events | the renter; an owner for their own items. Never `evidence` (photo links, e.g. taken at the renter's door) or `actor_id` |
| delivery_incidents | the renter; an owner only when EVERY line on the incident is theirs. Never `evidence`, reporter/resolver ids or the resolution note |
| delivery_proofs, delivery_dispatch_intents, delivery_provider_events, delivery_reconciliation, delivery_manual_tasks | server only |

Every write goes through the server (service role); state changes go through
SECURITY DEFINER functions with pinned search paths, executable by
service_role only. Events, custody and proofs are append-only even for the
server. The webhook inbox only accepts `signature_verified = true` rows.

## Public API for the next workstreams

All in `lib/core/delivery/use-cases.ts`, called with `await deliveryDeps()`
(`lib/delivery/server.ts`). See the Phase 4 core report for signatures.

- Checkout: `checkDeliveryEligibility`, `quoteDelivery`,
  `priceDeliveryForCheckout`, `prepareDelivery`, `markDeliveryQuotesPaid`,
  `commitDelivery` (with `{ kind: 'system' }` after the verified payment).
- Webhooks: a courier adapter supplies a `DeliveryWebhookParser`; the route
  calls `receiveDeliveryWebhook({ rawBody, headers, parser, deps: await deliveryInboxDeps() })`;
  the daily job calls `drainDeliveryInbox`.
- Admin: `advanceManualDelivery`, `confirmCollection`, `confirmHandover`,
  `recordReturnInspection`, `reportIncident`, `resolveIncident`,
  `cancelDelivery`, `reconcileDelivery`, `commitDelivery` (retry/reconcile).
- Settlement: `checkRentalSettlement` before deposit settlement and owner
  payout.
- Ubunye: read `checkDeliveryEligibility`, `quoteDelivery`,
  `getDeliveryStatus`; act `prepareDelivery`, `scheduleReturnPickup` and
  `cancelDelivery` with `{ kind: 'agent', userId, approval }` where `approval`
  is the server's verified approval-token result. Agents never commit.
