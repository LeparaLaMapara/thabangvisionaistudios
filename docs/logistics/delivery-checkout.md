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
5. After the order is reserved, its quotes are tied to it
   (`delivery_quotes.booking_group_id`, compare-and-set: a quote another order
   holds is refused). The payment intent carries the delivery cents.

Before migration 076 is applied the same screens work in "legacy" mode: the
quote endpoint returns an own-vehicle price for the verified point without a
stored quote, and the checkout verifies the typed address again and applies
the same formula. No browser coordinates in either mode.

## After payment (§4.8)

`lib/delivery/after-payment.ts` runs after a payment is confirmed: the
webhook inbox (`lib/rental/inbox.ts`, outcomes `confirmed`, `confirmed_late`
and `duplicate`), missed-payment recovery (`lib/rental/workers.ts`) and the
manual mark-paid route.

1. Only when the order's payment intent is `paid` (verified by the provider).
2. `markDeliveryQuotesPaid` with the intent's delivery cents (a mismatch marks
   nothing and alerts staff).
3. For each leg, outbound first: `prepareDelivery` (eligibility checked again
   on today's facts) then `commitDelivery` as `system`. For our own vehicle,
   commit creates the staff task (`delivery_manual_tasks`).
4. Replays are harmless: paid quotes stay paid, prepare returns the live leg,
   commit says `already_dispatched`. A replayed webhook therefore also
   finishes a dispatch an earlier run could not.
5. It never throws and never changes the payment outcome. Failures become
   staff alerts (`delivery_*` in the ops queue): payment not verified,
   prepare refused (for example the renter is now on hold), commit refused.

A payment recorded by hand (EFT/cash, mark-paid) is not provider-verified, so
nothing is dispatched automatically; staff get
`delivery_needs_staff_dispatch_payment_not_verified` (F-2).

## Customer views

`GET /api/delivery/status?booking_id=` (the renter's own booking): each leg's
state in plain words, the window, the fee paid, the driver or courier name
**only if recorded** ("not assigned yet" / "not available yet" otherwise), and
a tracking link only when the provider gave an https link. No addresses.
The booking page shows this in a Delivery panel.

`POST /api/delivery/return-pickup` (during the hire): offered only when the
gear went out by delivery (D-44: collected in person, returned in person) and
no return leg exists. `quote` gives a stored quote from the same verified
address; `approve` needs the exact stored price (D08) and re-quotes an expired
one (D07). A free pickup is booked at once (`scheduleReturnPickup`). A paid
pickup added during the hire has no online payment yet, so the approved
request goes to staff (`delivery_return_pickup_requested`), who confirm it and
take the fee before anything is dispatched (F-3). A return pickup bought at
checkout is booked after payment like the outbound leg.

## Cancellation (D-39)

When the renter cancels the last line of an order with delivery
(`PUT /api/bookings/[id]`):

- the hire and deposit refund no longer include the legacy `delivery_fee`;
- each live leg is cancelled with `cancelDelivery` as the renter: the fee is
  refunded in full, unless a courier was already booked, in which case the
  courier's cancellation fee is passed on at cost, capped at the fee paid. Our
  own vehicle charges no cancellation fee. The refund obligation is submitted
  at once (the daily pipeline retries it);
- if a leg is already past the cancellable states (the gear is on its way),
  the booking cannot be cancelled online (`409 DELIVERY_UNDER_WAY`), and
  nothing changes;
- cancelling one line while others remain leaves the delivery as it is.

The booking page's confirmation shows the delivery refund.

## Settlement (R-39, R-40)

`lib/rental/delivery-settlement.ts`:

- **R-39** `usesPhase4Delivery`: an order with shipment legs or a paid
  delivery quote earns its delivery fee per leg (core `deliveryEarned({ leg })`).
  Take-back and the gear dispute settlement no longer post the order-level
  `deliveryEarned({ bookingGroupId })` for such orders, and the dispute does
  not refund the legacy fee either. Orders without Phase 4 delivery are
  unchanged.
- **R-40** `deliverySettlement` (= `checkRentalSettlement`):
  - take-back records the gear as back, then stops before settling while a
    delivery incident is open or a return delivery has not been received and
    inspected (`409 DELIVERY_SETTLEMENT_HELD`, D17, D29). A courier's
    collection never releases a deposit;
  - a provider-caused or unattributed delay on the return stops the
    automatic late fee (`lateFeeAfterDelivery`, D19); staff can still decide;
  - the gear dispute settlement is held the same way;
  - owner payout eligibility (`evaluatePayout`) adds `delivery_<reason>` hold
    reasons (`checkPayoutEligibility.deliveryHoldReasons`).
  Any of these lookups failing holds the step (fail closed).

## Founder decisions surfaced

- **F-1** Courier delivery stays off (D-37, D-41). The cart and booking pages
  say "our own vehicle"; courier options appear only when the flag, threshold
  and verified cover allow.
- **F-2** Orders paid by hand: delivery is not dispatched automatically
  (the core accepts only provider-verified payments). Either staff dispatch
  these by hand, or the core is extended to accept a staff-recorded payment.
- **F-3** Online payment for a return pickup added during the hire (today a
  staff-confirmed request).
- **F-4** Delivery windows (`DELIVERY_CHECKOUT.windows`): 08:00 to 12:00 and
  12:00 to 17:00 SAST, delivery on the first hire day, pickup on the last.
- **F-5** The profile page's as-you-type address lookup against public
  Nominatim (usage policy).
- **F-6** A paid delivery that fails final eligibility after payment is
  alerted to staff; refunding that fee is a manual step today.
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
`tests/e2e/delivery-checkout.spec.ts` covers what runs without a database.
