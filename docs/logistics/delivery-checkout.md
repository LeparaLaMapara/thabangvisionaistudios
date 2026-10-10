# Delivery at checkout and in the money flows (Phase 4)

How a renter gets a delivery price, pays for it, sees it, cancels it, and how
settlement treats it. Built on the Phase 4 core (`lib/core/delivery/use-cases.ts`,
see `delivery-architecture.md`). Today delivery is **our own vehicle only**:
no courier is offered (D-37 threshold 0, D-41 no verified cover, flag
`delivery_courier` off), and no shipment insurance is advertised (§4.13).

## The geocoding fix (security and money)

Before this change the checkout priced own-vehicle delivery from
`delivery_lat`/`delivery_lng` sent by the browser. A renter could send a point
next to our office and pay the minimum fee for a delivery across Gauteng.

Now:

- The renter types the address (street, suburb, city, postal code). The
  **server** geocodes it through an `AddressPort` adapter
  (`lib/delivery/address.ts`) and prices the verified point.
- Browser coordinates are at most a hint: compared with the verified point
  within `DELIVERY_CHECKOUT.hintToleranceKm`, logged as
  `delivery_hint_mismatch` when they disagree, never used for a price.
- A result is accepted only when it is a street address in South Africa
  (a suburb or city centre is refused). An address that cannot be verified is
  refused with a clear message; it never falls back to the browser.
- The verified address and the driver's contact (first name, phone,
  instructions) are stored in `delivery_addresses` (076, `renter_address`,
  `verified_by` = the adapter). The legacy booking columns (`delivery_address`,
  `delivery_lat`, `delivery_lng`, `delivery_distance_km`, `delivery_fee`) are
  still written, from the **verified** point, for the staff screens.

### Provider and usage policy

`ADDRESS_PROVIDER=nominatim` (default) uses OpenStreetMap Nominatim; `none`
switches verification off (delivery then falls back to collection, with a
message). The public Nominatim service asks for: at most one request per
second per application, a User-Agent that identifies the application with
contact details, caching, no autocomplete, and attribution. The adapter:

- makes one lookup per "Get delivery quote" press (never per keystroke);
- queues lookups at most one per `DELIVERY_CHECKOUT.address.minIntervalMs`
  (1.1 s) per server instance, with a 5 s timeout;
- caches results in memory for 24 hours (500 entries);
- sends `User-Agent: ThabangVision-delivery/1.0 (+site; contact email)` and a
  Referer, both from `STUDIO` constants;
- asks for South Africa only (`countrycodes=za`);
- shows "Address check: © OpenStreetMap contributors" under the form.

The policy page could not be fetched from this environment (network
restricted); the rules above are the ones published by the OSM Foundation and
should be re-read before launch. Serverless instances do not share the queue,
so the one-per-second cap is per instance; at our volume that is well inside
the limit. A busier platform should add a paid geocoder as another adapter
behind `ADDRESS_PROVIDER` (no checkout change).

Note: the existing `components/ui/AddressAutocomplete.tsx` (used on the
profile page) still calls Nominatim from the browser as you type, which the
policy does not allow for the public service. The cart no longer uses it.
Changing the profile page is outside this workstream (founder decision F-5
below).

## Customer flow (§4.17)

1. The cart asks `GET /api/delivery/eligibility`. Delivery is shown only to
   renters who may have this cart delivered: first hire, items over
   R50,000, the trust tier, account holds and own-vehicle delivery switched off
   all mean **Collection in person only**, with the reason.
2. "Collect in person: Free" or "Deliver to me: Get a quote". For delivery the
   renter enters the address, who receives it, a phone number, a window on the
   first hire day (`DELIVERY_CHECKOUT.windows`, SAST) and, optionally, a return
   pickup on the last hire day.
3. `POST /api/delivery/quote` verifies the address, stores it, and calls
   `quoteDelivery` per leg (our site to the renter, and back). Each quote is
   stored with its expiry (`delivery_quotes`, `DELIVERY_POLICY.quoteTtlMinutes`).
   An ineligible or out-of-area renter gets collection only, with the reason.
   A body that carries a price is refused.
4. The checkout sends only the quote ids and the total the renter saw
   (`delivery_approved_cents`). `priceCheckoutDelivery` decides the amount:
   - live quote, same total: charged from the stored quote;
   - a different browser total: `409 DELIVERY_PRICE_CHANGED` (D08);
   - expired (or the cart changed, or the quote is held by another order):
     re-quoted for the same addresses and window. Same total: goes ahead with
     the new quote. A different total: `409 DELIVERY_REQUOTE` with the new
     quotes; the renter presses "Accept delivery at R…" and checks out again
     (D07). Nothing is reserved or charged before that.
   Phase 8: when some of the gear is collected from its owner's address
   (D-86), the quote has one line per trip and origin ("Delivery from our
   studio", "Delivery from the owner (Melville)", the same for the return)
   and the total. The checkout sends every quote id (`delivery_quote_ids`,
   with the older `delivery_quote_id` / `return_quote_id` still read); the
   price check wants exactly one live quote per leg asked for and per origin
   of the cart as the server sees it now. If an owner switched pickup on or
   off since, the cart changed, or a quote is missing, the whole delivery is
   re-quoted from the same address and window and comes back for approval
   (D07). The renter never sees an owner's street (D-88).
5. After the order is reserved, its quotes are tied to it
   (`delivery_quotes.booking_group_id`, compare-and-set: a quote another order
   holds is refused). The payment intent carries the delivery cents.

Before migration 076 is applied the same screens work in "legacy" mode: the
quote endpoint returns an own-vehicle price for the verified point without a
stored quote, and the checkout verifies the typed address again and applies
the same formula. No browser coordinates in either mode. Whether 076 is
applied is probed with a GET (`tableExists`): PostgREST answers a HEAD on a
missing table with 404 and an empty body, which postgrest-js reports as
success, so a HEAD probe would have sent every delivery checkout into the
Phase 4 path and failed it (review finding 5).

A stored quote records the lines it was priced for (listing, units, hire
days). It is stale, and re-quoted at checkout, when the cart's items, units
or dates differ; the window moves with the new leg day (the same slot).
`prepareDelivery` refuses a quote whose snapshot no longer matches the
booking (`dates_mismatch`). The own-vehicle price counts units (a line of 3
tripods is 3 items), as the cart and the legacy route do.

An unpaid order that is released (payment page failed, limit re-check) has its
quotes unlinked so they never stay tied to an order that no longer exists.

## After payment (§4.8)

`lib/delivery/after-payment.ts` runs after a payment is confirmed: the
webhook inbox (`lib/rental/inbox.ts`, outcomes `confirmed`, `confirmed_late`
and `duplicate`), missed-payment recovery (`lib/rental/workers.ts`) and the
manual mark-paid route.

1. Only when the order's payment intent is `paid` (verified by the provider).
   Only the quotes that payment covered take part: a quote paid by hand
   (`manual:` reference, e.g. a return pickup staff confirmed) is left out, so
   a replay never raises a false amount mismatch (review fix round 2).
2. An order whose every line is cancelled stops here with a staff alert
   (`delivery_after_payment_order_cancelled`) and NO refund: its cancellation
   settled the delivery money (round 2, finding 1). `markDeliveryQuotesPaid`
   refuses such an order too (`order_cancelled`), except for the
   cancellation's own settlement, which marks the quotes only to refund them.
3. `markDeliveryQuotesPaid` with the intent's delivery cents (a mismatch marks
   nothing and alerts staff).
4. For each leg, outbound first: `prepareDelivery` (eligibility checked again
   on today's facts) then `commitDelivery` as `system`. For our own vehicle,
   commit creates the staff task (`delivery_manual_tasks`).
5. Replays are harmless: paid quotes stay paid, prepare returns the live leg,
   commit says `already_dispatched`. A replayed webhook therefore also
   finishes a dispatch an earlier run could not. A quote that was refunded (its
   leg cancelled or refused) is skipped: it is never dispatched again.
6. A paid leg that cannot be prepared for a lasting reason (no longer
   eligible, the booking changed, the provider is gone) has its fee refunded
   at once: `refundUnusedDeliveryQuote` moves the quote to `refunded` with the
   journal and a refund obligation capped at what is left of the charge
   (D-52, replaces F-6).
7. It never throws and never changes the payment outcome. Failures become
   staff alerts (`delivery_*` in the ops queue): payment not verified,
   prepare refused (for example the renter is now on hold), commit refused.

A payment recorded by hand (EFT/cash, mark-paid) is not provider-verified, so
nothing is dispatched automatically; staff get
`delivery_needs_staff_dispatch_payment_not_verified` and dispatch it from the
console ("Paid by hand": `dispatch_manual_paid`, D-50). The core checks the
order was confirmed through the manual-payment path, the quotes are this
renter's and on this order, and the delivery total recorded at checkout equals
them; it marks them paid with the order's manual reference and prepares and
dispatches as staff. Never unpaid.

## Customer views

`GET /api/delivery/status?booking_id=` (the renter's own booking): each leg's
state in plain words, the window, the fee paid, the driver or courier name
**only if recorded** ("not assigned yet" / "not available yet" otherwise), and
a tracking link only when the provider gave an https link. No addresses.
The booking page shows this in a Delivery panel.

`POST /api/delivery/accept` (renter only, signed in): per delivered item,
`accepted`, or `exception` with a kind (damaged, missing) and what is wrong.
The core accepts only the booking's own renter (D15); an exception opens an
incident and puts the leg under review. Idempotent. The booking page's
Delivery panel shows "Received" / "Report a problem" for each item our driver
or the courier recorded as delivered, and says that without an answer it
counts as received after `DELIVERY_POLICY.deemedAcceptanceHours` (D-48).

`POST /api/delivery/return-pickup` (during the hire): offered only when the
gear went out by delivery (D-44: collected in person, returned in person) and
no return leg exists. `quote` gives a stored quote from the same verified
address (advisory: stored without the order link, so it never joins the
order's checkout payment); `approve` needs the exact stored price (D08) and
re-quotes an expired one (D07). A free pickup is booked at once
(`scheduleReturnPickup`). A paid pickup added during the hire has no online
payment yet: the request is recorded ONCE on its quote (`requested_at`),
staff are alerted once (`delivery_return_pickup_requested`), and the booking
shows "Return pickup requested. Our team will contact you to arrange
payment" and stops offering a new pickup while it is pending. Staff confirm
it after taking the payment by hand ("Paid by hand" in the console:
reference, amount; D-50, F-3). A return pickup bought at checkout is booked
after payment like the outbound leg.

## Cancellation (D-39)

When the renter cancels the last line of an order with delivery
(`PUT /api/bookings/[id]`), or staff cancel it
(`PATCH /api/admin/equipment-bookings/[id]`, same money rules: the delivery
fee is never part of what the line releases or what staff can refund, live
legs are cancelled through the core as a platform cancellation):

- the hire and deposit refund no longer include the legacy `delivery_fee`;
- each live leg is cancelled with `cancelDelivery` as the renter: the fee is
  refunded in full, unless a courier was already booked, in which case the
  courier's cancellation fee is passed on at cost, capped at the fee paid. Our
  own vehicle charges no cancellation fee. The refund obligation is submitted
  at once (the daily pipeline retries it);
- a paid quote no leg was made from is refunded too
  (`refundUnusedDeliveryQuote`), once;
- the paid quote is then `refunded` (or `consumed` when a pass-on fee was
  kept), so a later payment replay never dispatches it;
- linked quotes nobody marked paid (the after-payment step never finished)
  follow the same Phase 4 rules: on an order paid online they are marked and
  refunded once with the order; on an unpaid order they are superseded. Any
  linked quote (not superseded) makes the order a Phase 4 order, so the hire
  refund never carries the legacy fee for it (round 2, finding 1). If the
  order was cancelled under the legacy rules (its fee refunded with the hire)
  and a quote turns up linked afterwards, the quote is only superseded;
- **the renter** (strict): if a leg is past the cancellable states (on its
  way, or already delivered, lost, damaged or under review), the booking
  cannot be cancelled online (`409 DELIVERY_UNDER_WAY`), and nothing changes;
- **staff** (round 2, finding 3, D-53): only a leg actually in motion (the
  gear with a courier or our driver: collected, in transit, at the drop-off,
  a failed attempt, returning to the sender) blocks them
  (`409 DELIVERY_UNDER_WAY`; a booked courier on a scheduled leg is cancelled
  at the provider first, as before). Legs that reached the renter, or are
  lost, damaged or under review, are left as they are and logged
  (`deliveryLegsLeft`); their fee is kept (D-39/D-52) unless staff send
  `refundDeliveryFee: true`, which refunds it once through
  `refundDeliveryFee` (an earned fee is reversed out of income; a fee not yet
  earned can never be earned afterwards, D-56). When the renter may still
  have the gear (an outbound leg delivered, damaged or under review, and no
  return leg delivered or under review), a scheduled return pickup is NOT
  cancelled with the order: it is how the gear comes back
  (`returnKeptShipmentIds`, `deliveryReturnLegsKept` in the log), and staff
  get `delivery_gear_with_renter_after_cancel`, because the cancelled
  booking is off the overdue ladder (round 3, finding 2, D-57);
- cancelling one line while others remain leaves the delivery as it is. The
  order is read AGAIN after the line's cancellation commits
  (`settleAfterLineCancelled`): two cancellations of the last two lines at
  the same moment each saw the other open, but both now see the order fully
  cancelled, and settling is idempotent per leg and quote, so the fee is
  refunded once (round 2, finding 6). The daily step
  `delivery_cancelled_orders` catches anything left (a failed settlement).
  What a legacy-rules cancellation left to staff (a leg, or a paid quote no
  leg was made from) stays theirs: the quote is `consumed` and the order is
  held out of the sweep (`delivery_note_cancelled_order(…, 'legacy_cancel')`,
  round 3, finding 3, D-58).

The booking page's confirmation shows the delivery refund.

## Settlement (R-39, R-40)

`lib/rental/delivery-settlement.ts`:

- **R-39** `usesPhase4Delivery`: an order with shipment legs or ANY linked
  delivery quote that was not superseded (an unmarked `active` one included,
  round 2) earns its delivery fee per leg (core `deliveryEarned({ leg })`).
  Take-back and the gear dispute settlement no longer post the order-level
  `deliveryEarned({ bookingGroupId })` for such orders, and the dispute does
  not refund the legacy fee either. Orders without Phase 4 delivery are
  unchanged.
- **R-40** `deliverySettlement` (= `checkRentalSettlement`):
  - take-back records the gear as back, then stops before settling while a
    delivery incident is open or a return delivery has not been received and
    inspected (`409 DELIVERY_SETTLEMENT_HELD`, D17, D29). A courier's
    collection never releases a deposit;
  - a delay on the return that staff (or the provider) attributed to the
    provider stops the automatic late fee (`lateFeeAfterDelivery`, D19); an
    unattributed one holds settlement while open and never waives the fee
    by itself (D-51);
  - the late fee runs to when a return pickup took the gear, not to when it
    reached us (`returnCollectedAt`, D-49). Only the courier's own
    confirmation or our staff's record counts; a renter recording their own
    handover is kept as evidence but never stops the clock (round 2);
  - the gear dispute settlement is held the same way;
  - owner payout eligibility (`evaluatePayout`) adds `delivery_<reason>` hold
    reasons (`checkPayoutEligibility.deliveryHoldReasons`).
  Any of these lookups failing holds the step (fail closed).

## Multi-item delivery orders (R-88)

Before Phase 8 a delivery order with more than one item could not be
reserved: 041's CHECK (`delivery_needs_address`) wants every delivered line
to carry an address and a fee, but only the first line got them. Every
delivered line now carries the verified address; the fee stays on the first
line (0 on the others), so every sum of `delivery_fee` over an order is
unchanged.

## Founder decisions surfaced

- **F-1** Courier delivery stays off (D-37, D-41). The cart and booking pages
  say "our own vehicle"; courier options appear only when the flag, threshold
  and verified cover allow.
- **F-2** Orders paid by hand: delivery is not dispatched automatically.
  Staff dispatch them from the console after the payment is recorded (D-50).
- **F-3** Online payment for a return pickup added during the hire (today a
  request recorded once, confirmed by staff after a payment taken by hand,
  D-50).
- **F-4** Delivery windows (`DELIVERY_CHECKOUT.windows`): 08:00 to 12:00 and
  12:00 to 17:00 SAST, delivery on the first hire day, pickup on the last.
- **F-5** The profile page's as-you-type address lookup against public
  Nominatim (usage policy).
- **F-6** A paid delivery that fails final eligibility after payment: its fee
  is refunded at once (D-52; was a manual step).
- **F-7** Address retention (D-46): rows are written without `retain_until`;
  the purge job is R-41.

## Tests

`tests/unit/delivery-checkout-*.test.ts`: address adapter and policy limits,
quote route (spoofed position, verified price, eligibility gating),
checkout route (stored quote charged, browser total refused, expired quote
re-quote and approval, legacy mode), after-payment dispatch (once, replays,
unverified payment, mismatch, final eligibility, never throws, inbox hook),
settlement (R-39 no double earn in take-back and dispute, R-40 holds,
late fee, payout), cancellation (D-39 full refund, pass-on, cap, too late),
customer views and return pickup. The money tests were mutation-checked.
Review fixes: `tests/unit/delivery-review-*.test.ts` (replayed payment after
a cancellation, staff cancellation, renter acceptance and deemed acceptance,
attribution and late fees, the missing-table probe against real PostgREST
answer shapes, unused paid quotes, stale quotes, units, incident scope,
closing reviews, hand-paid dispatch, return-pickup requests, overdue ladder,
pipeline order, purge, advisory quotes, webhook body limit); the HIGH ones were
mutation-checked. Review fixes round 2: `tests/unit/delivery-review2-*.test.ts`
(no double fee refund through a payment replay after a cancellation, the
order-wide refund cap in `chargeOfBooking`, staff cancellation after
delivery, earned-fee refunds and ledger balances, closing a review as
delivered, the last-line race and the daily sweep, hand-paid quotes on a
replay, who ends the renter's possession, the studio day) and
`076-delivery.test.sql` 14 and 19–21; every fix was mutation-checked.
Review fixes round 3: `tests/unit/delivery-review3-fixes.test.ts` (a fee
refunded before it was earned is never earned by deemed acceptance, the
renter's acceptance or closing a review; the return pickup kept when the
renter has the gear; the legacy cancel path and the sweep; sweep attempts)
and `076-delivery.test.sql` 22–24 (sweep holds, kept return pickups and
attempt order; the deemed-acceptance list; the order-wide 070 cap trigger).
`tests/e2e/delivery-checkout.spec.ts` covers what runs without a database
(no always-skipped placeholders).
