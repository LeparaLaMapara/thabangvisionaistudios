# Bob Go adapter (courier aggregator)

Bob Go is a South African courier aggregator: one merchant account books
The Courier Guy, RAM, Skynet, Fastway, WumDrop and Pargo (see
`provider-comparison.md`). It is the fallback route for scheduled,
non-urgent moves.

**The API contract is checked against Bob Go's own reference and sandbox
(2026-10-11).** The reference is public after all: the docs site
https://api-docs.bob.co.za/bobgo loads a Postman collection
(`/postman-collections/bobgo.postman_collection.json`). Every call the adapter
makes was exercised against the Bob Go sandbox with our sandbox key, and
`scripts/delivery/bobgo-sandbox-smoke.ts --book` runs the real adapter end to end
(quote, create, lookup, read, tracking, cancel). What is still unconfirmed is
business, not API: cover, custody, couriers' hand-over rules and the
capabilities (see "Questions" below).

The first version of this adapter was built on guesses and called the wrong
endpoints (`/rates-at-checkout`, a shop checkout price, and `/orders`, a shop
order that books no courier). The sandbox refused the first and would have
booked nothing with the second.

It is **off**, and it stays out of customer selection even if switched on:

- it is not listed in `DELIVERY_PROVIDERS`;
- it needs an explicit `DELIVERY_PROVIDER_BOBGO_ENABLED=true`;
- production mode also needs `DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED=true` and `BOBGO_API_KEY`;
- sandbox mode is refused on the production deployment (`VERCEL_ENV=production`);
- it claims **no capability**, so the risk gate excludes it whatever the policy says;
- the approved service-level list is empty, so it refuses every quote without calling Bob Go;
- the core's own gates still apply: the `delivery_courier` flag (off), the D-37 value threshold (0) and the D-41 verified-insurance gate (no policy).

`tests/unit/delivery-bobgo-gating.test.ts` proves each of these through the
same registry and selection path the other couriers use.

## Files

| File | What it holds |
|---|---|
| `lib/delivery/bobgo/api-contract.ts` | **Every** provider detail in one place: hosts, auth header, paths, request and response field names, price unit, courier wait, status words, approved service levels, lithium rule, webhook signing. Each item is tagged `[sandbox]`, `[docs]`, `[research]` or `[assumed]`. `BOBGO_CONTRACT_SOURCES` lists the tags |
| `lib/delivery/bobgo/adapter.ts` | `createBobgoAdapter` (DeliveryPort), `bobgoConfigFromEnv`, `bobgoDelivery`, `bobgoRandsToCents`. No provider detail of its own |
| `lib/delivery/bobgo/webhook.ts` | `bobgoWebhookParser(env)` returns null (closed). `createBobgoWebhookParser({ verify })` for when a scheme is known |
| `lib/delivery/ports.ts` | Registration: `aggregatorCourierFactories()`, behind `gatedCourierFactory` |
| `lib/delivery/webhook-adapters.ts` | Webhook parser registration (closed) |
| `lib/delivery/http.ts` | Shared fetch: timeouts, rejected/unknown classification, circuit breaker |
| `tests/unit/delivery-bobgo.test.ts` | The adapter against a fake fetch that returns the sandbox's own response shapes |
| `scripts/delivery/bobgo-sandbox-smoke.ts` | The real adapter against the real sandbox. Read-only by default; `--book` creates ONE shipment and cancels it |
| `tests/unit/delivery-bobgo-gating.test.ts` | Registration, production gating, the shared policy gates, closed webhooks |

Outbound calls go through `lib/delivery/http.ts`, like Uber Direct and
WumDrop. The `lib/security/safe-fetch.ts` guard is for user-supplied URLs; no
courier adapter uses it, because every courier URL is a constant in code.

## Environment variables

```env
# Delivery: Bob Go (off unless all switches below are set)
DELIVERY_PROVIDERS=                               # e.g. "bobgo,manual"
DELIVERY_PROVIDER_BOBGO_ENABLED=                  # "true" to build the adapter (default: off)
DELIVERY_PROVIDER_BOBGO_MODE=                     # "sandbox" | "production" (default production)
DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED=      # "true" only after founder approval + verified cover
BOBGO_SANDBOX_API_KEY=                            # sandbox merchant API key
BOBGO_API_KEY=                                    # production merchant API key
```

Each mode reads only its own key, so a sandbox deployment can never pick up
the live key. There is no webhook secret variable: no signing scheme is known.

`.env.example` is matched by `.gitignore` (`.env*`) in this repository and is
not tracked, so these lines live here rather than in `.env.example`.

## The contract

Everything below is in `api-contract.ts`. "Sandbox" means it is in Bob Go's
reference and was exercised against the sandbox on 2026-10-11.

Bob Go's model: a **shipment** is a courier booking. It is identified by Bob
Go's `tracking_reference` (e.g. `UASS93F8`), and carries ours in
`custom_tracking_reference`.

| Item | Value | Source |
|---|---|---|
| Production base URL | `https://api.bobgo.co.za/v2` | docs (no production key yet) |
| Sandbox base URL | `https://api.sandbox.bobgo.co.za/v2` | sandbox |
| Auth | `Authorization: Bearer <merchant API key>`; a wrong key gets 401 | sandbox |
| Rates | `POST /rates` | sandbox |
| Create | `POST /shipments` | sandbox |
| Read one, and lookup by our reference | `GET /shipments?tracking_reference={ref}`: matches Bob Go's reference **and** our custom one; `{ shipments, count }` | sandbox |
| Cancel | `POST /shipments/cancel` with `{ "tracking_reference": ... }` | sandbox |
| Tracking, proof of delivery | `GET /tracking?tracking_reference=` (an array), `GET /shipments/pod?tracking_reference=` (`{ count, pods }`) | sandbox. **Not called**: status is read from the shipment; proof is not claimed |
| Our reference field | `custom_tracking_reference`. 80 characters with underscores and hyphens accepted and echoed exactly | sandbox |
| Courier + service level | `provider_slug` + `service_level_code`, both from a rate | sandbox |
| Addresses | `collection_address` / `delivery_address` with `street_address`, `local_area`, `city`, `zone`, `code`, `country`, `lat`, `lng`. Rates work without a street address; full province names work | sandbox |
| Contacts | `collection_contact_name`, `collection_contact_mobile_number`, `delivery_contact_name`, `delivery_contact_mobile_number` (email optional) | sandbox |
| Parcels | `parcels[]`, one per unit, with `description` and `submitted_weight_kg`. Dimensions are optional | sandbox |
| Courier wait | `timeout` in ms (10 s for rates, 20 s for create, the reference's values). Without it a slow courier answers `pending` and its rates are missing | sandbox |
| Rates response | `provider_rate_requests[]` (`provider_slug`, `status`) each with `responses[]` (`service_level_code`, `rate_amount` in rands incl. VAT, `status`) | sandbox |
| Shipment response | `tracking_reference`, `custom_tracking_reference`, `status`, `submission_status` (`success` once the courier has it), `time_created` / `time_modified` | sandbox |
| Status words seen | `pending-collection` (just booked), `cancelled`; the reference also shows `submitted`, `collection-assigned`, `collected` | sandbox |
| Status words mapped | `delivered`, `cancelled`/`canceled`, `in-transit`/`in_transit` | sandbox (only `cancelled` seen live) |
| Quote validity | 15 minutes (our cap) | assumed |
| Webhook signing | none known (the reference has no webhook section) | assumed |

What the sandbox returned for Braamfontein to Pretoria Central, 2 kg, door to
door: courier `sandbox` ECO R114.95, LOF R104.36 to R122.51, LSE R125.24 to
R161.54, LSX R677.60; courier `demo` ECO R100.19 to R139.15. These are test
couriers, never listed as approved.

**Status mapping.** Only the words above are mapped. Everything else maps to
`unknown`, which the core never applies, and the core moves a leg forward only
(D13). So a wrong or new word cannot move a shipment. `collected` is
deliberately not mapped: it could mean the courier collected from us, or the
recipient collected from a pickup point. `pending-collection`,
`submitted` and `collection-assigned` are not mapped either: they do not move
a leg.

## What the adapter does

| Port method | Bob Go call | Notes |
|---|---|---|
| `checkServiceability` | none | Local checks: key present, usable coordinates, no lithium, at least one approved service level |
| `quote` | `POST /rates` | Considers **only approved `provider_slug:service_level_code` entries** that answered `success`, and picks the cheapest of those. A cheaper unapproved option (another courier with the same code, a pickup point) is never chosen. A rate of 0 is never chosen. Rands to integer cents without float drift. The chosen entry travels as `providerQuoteRef` |
| `createDelivery` | `POST /shipments` with `custom_tracking_reference` = our merchant reference | Books exactly the quoted courier and service level, and refuses without sending if it is not approved. See "Create" below |
| `findByMerchantReference` | `GET /shipments?tracking_reference={our ref}` | Returns a shipment only if it echoes our reference **exactly**. If Bob Go holds duplicates, the one that is not cancelled is ours. Empty, 404, someone else's shipment, two live ones, or any error: `unknown`, **never "none"** |
| `getDelivery` | `GET /shipments?tracking_reference={Bob Go ref}` | Exact match on Bob Go's reference. A clean empty answer: `rejected` (no such shipment). Courier name and proof are not stored |
| `cancelDelivery` | `POST /shipments/cancel` | Only an answer whose status is `cancelled` counts. An empty 2xx or any other status: `unknown` (staff check, no refund on a guess). Bob Go's refusals ("cannot be cancelled", "not found") are 400: `rejected`. Fee reported as 0 (the sandbox charged 0); a real fee comes from the invoice |
| `getTracking` | as `getDelivery` | State only. No ETA, location or link is invented |

**What is never sent:** item values, a declared value, brands or models. The
parcel description is the generic driver label.

**Create:**
- A 2xx without a tracking reference → `unknown`. The core reconciles by reference.
- A 2xx whose `submission_status` is not `success` → `unknown`: Bob Go recorded the shipment but did not hand it to a courier. Staff check the dashboard.
- 401/403 → `rejected` with a configuration message, and no lookup.
- 408, 409, 425, 429, 5xx, timeout, network error → `unknown`, with no retry and no lookup.
- Any other 4xx: an earlier attempt may have got through, so the adapter looks the shipment up **before** calling it a refusal:
  - a shipment of ours is found → that shipment is returned. One courier, never two;
  - the lookup answers with no shipment of ours → the refusal stands (`rejected`);
  - the lookup does not answer → `unknown`.

**Why `idempotentCreate` is false: Bob Go books duplicates.** In the sandbox
two creates under the same `custom_tracking_reference` made two shipments
(`UASS93F8` and `UASSSD3C`, both cancelled). So the adapter never retries a
create, the lookup is used only in the safe direction (a positive, exact
match), and `findByMerchantReference` never answers "none". An uncertain create
goes to a person (`reconcile_pending`) and is never re-dispatched automatically.

## Resilience

Same rules as the other couriers, from `lib/delivery/http.ts`.

| Outcome | Classified as |
|---|---|
| 401 / 403 | `rejected`, with a configuration message |
| Other 4xx | `rejected` (after the duplicate check on create) |
| 408, 409, 425, 429, any 5xx | `unknown` |
| Network error, timeout | `unknown` |

**Timeouts:** reads 8 s, quote 15 s, create 25 s, cancel 10 s (quote and create wait for Bob Go's own 10 s and 20 s courier waits). **No retries in the adapter.**
**Circuit breaker:** 5 consecutive unknowns open it for 60 s. It is in memory and per instance.

## Webhooks: closed, poll instead

The signing scheme is unknown, so no algorithm is implemented. Guessing one
would either refuse every real event or accept a forged one.

- `bobgoWebhookParser(env)` returns null under every configuration. `/api/webhooks/delivery/bobgo` therefore answers **503 not_configured**, and nothing is stored or applied (D11).
- Status comes from reading the shipment.
- Once Bob Go documents its scheme in writing, write a verifier for exactly that scheme, with tests, pass it to `createBobgoWebhookParser({ verify })`, and register it in `webhook-adapters.ts` in place of the null factory. Confirm the payload shape at the same time: `parse` is assumed too.

## Capabilities

**All false.** `BOBGO_CAPABILITIES` equals `NO_DELIVERY_CAPABILITIES`.

| Capability | Why false |
|---|---|
| onDemand, scheduled | Same-day and later collections are courier-dependent; which service levels we may use is not settled |
| reverseLogistics | Returns exist (`POST /orders/return` in the reference), not wired or tested |
| liveTracking, trackingWebhooks | No verified location; webhook signing unknown |
| pickupConfirmation, proofOfDelivery, signature, recipientPin | A POD endpoint exists, but what each courier puts in it is unknown |
| noLeaveAtDoor | No per-shipment control known |
| declaredValueSupport, verifiedTransitCover | Cover passes through each courier, with second-hand exclusions |
| cancellation | Works in the sandbox; not yet confirmed in writing (windows and fees per courier) |
| idempotentCreate | Proven false in the sandbox. See above |

## Questions to send Bob Go before enabling

**From `provider-comparison.md` (all providers):**

1. **Terms:** full current SA terms for API shipments: merchant agreement, liability schedule, prohibited and restricted items, with effective dates. Per courier where they differ.
2. **Cover:** goods-in-transit cover for each courier and service level: policy wording, insurer, per-item and per-load limits, excess, exclusions, claims procedure, time-bar and evidence required. Does Bob Go add any cover of its own?
3. **Second-hand and third-party goods:** are used, second-hand or rental items owned by a third party (the gear owner, not the sender) accepted and covered by each courier? Is original packaging required? (TCG and RAM exclude second-hand goods.)
4. **Cameras and lithium batteries:** cameras, lenses and lithium-ion batteries, installed and loose: which couriers and service levels accept them, with what limits and packaging? (RAM needs written consent.)
5. **Declared value:** maximum declared value per item and per shipment. Single items of R50,000? Is a declared value an API field, and does it change cover or price?
6. **Idempotency:** is `channel_order_number` (or another field) our unique reference? How long is it kept unique, and what exactly is returned for a duplicate (status code and body)? What is its maximum length and allowed characters? A leg collected from an owner's address has a 72-character reference (`tvd_{group}_{o|r}{n}_{owner}`, R-85).
7. **Hand-over:** can leave-at-door be disabled per shipment, enforced by the courier? Pickup confirmation, PIN or OTP, signature, photo and ID at collection and delivery: returned through the API or webhooks?
8. **Webhooks:** signing algorithm, header, secret rotation, retry policy, full event list, live location and ETA.
9. **Cancellation:** cancellation windows and fees per courier, before and after collection; failed-delivery and return-to-sender fees.
10. **Coverage and SLAs:** Gauteng coverage per courier, same-day cut-offs, collection windows, SLAs.
11. **Onboarding:** sandbox, onboarding time, credit checks, published rand rates.

**API-specific.** Answered by the reference and the sandbox (2026-10-11): 13
(sandbox host), 14 (bearer key), 15 (lookup by `tracking_reference`, empty list
when none), 18 (create: `provider_slug` + `service_level_code`), and most of
12, 16 and 21. Partly answered: 6 (duplicates are booked, so there is no
uniqueness; 80 characters accepted), 19 (some status words seen). Still open,
for Bob Go to confirm:

12. **Production:** that `api.bobgo.co.za/v2` is the production base URL, and whether production keys differ in scope.
13. **Sandbox:** the sandbox base URL, or whether a sandbox key works against the production host. Is sandbox data ever handed to a real courier?
14. **Auth:** the exact header (`Authorization: Bearer <key>`, or another), key scopes, rotation, and separate sandbox and production keys.
15. **Lookup by our reference:** an endpoint or filter that returns an order by our reference, and what it returns when there is none (404 or an empty list).
16. **Rates:** how long a rate holds, and whether dimensions change the price for real couriers (the sandbox quotes without them).
17. **Service levels:** the list of service-level codes, which courier each maps to, and which are door-to-door versus pickup point. We will book only hand-to-hand, door-to-door levels.
18. **Create:** required fields, how the chosen rate or service level is passed, and the response (order id, shipment id, waybill, tracking link).
19. **Statuses:** the full order and shipment status vocabulary, in order, with meanings. Especially `collected`, exceptions and returns.
20. **Proof of delivery:** POD fields in the API (signature, OTP, photo, recipient name), per courier, and whether they come as files or links.
21. **Cancel:** whether a cancel can fail after collection, and the fee per courier.
22. **Rate limits:** requests per minute, and the error body format (`message` / `error` fields).

## Switching it on

### Sandbox (preview or development only)

1. The API contract is done (above). `npx tsx scripts/delivery/bobgo-sandbox-smoke.ts --book` proves it against the sandbox at any time.
2. Fill `approvedServiceLevels` with `provider_slug:service_level_code` entries for hand-to-hand, door-to-door levels only. Set `lithiumAccepted` only if Bob Go confirms it in writing for those levels.
3. Set `BOBGO_SANDBOX_API_KEY`, then:
   - `DELIVERY_PROVIDERS=…,bobgo,manual`;
   - `DELIVERY_PROVIDER_BOBGO_ENABLED=true`;
   - `DELIVERY_PROVIDER_BOBGO_MODE=sandbox`;
   - `DELIVERY_ALLOW_SANDBOX=true`.
4. Exercise rates, create (once: a second create books a second shipment), lookup by reference, read, cancel, and polling.
5. Customers still will not see Bob Go: it claims no capabilities. Set a capability to true only once it is verified in writing and in sandbox, with a test.

### Production (only after all of the following)

1. Founder approval, recorded in the decision register (D-90).
2. A goods-in-transit policy confirmed **in writing** for third-party-owned rented gear carried by the approved Bob Go couriers. Record it in `DELIVERY_POLICY.insurance` with `coveredProviders: ['bobgo']` (D-41).
3. `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents` set by the founder (D-37), no higher than the cover limit and R50,000.
4. Pickup confirmation, proof of delivery, hand-to-hand and idempotent create verified in writing and in sandbox, and set in `BOBGO_CAPABILITIES` with tests. Webhook signing either verified and implemented, or polling relied on.
5. Set `BOBGO_API_KEY` and `DELIVERY_PROVIDER_BOBGO_MODE=production`.
6. Set `DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED=true`.
7. Turn on the `delivery_courier` flag.
