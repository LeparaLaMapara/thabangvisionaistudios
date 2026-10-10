# Bob Go adapter (courier aggregator)

Bob Go is a South African courier aggregator: one merchant account books
The Courier Guy, RAM, Skynet, Fastway, WumDrop and Pargo (see
`provider-comparison.md`). It is the fallback route for scheduled,
non-urgent moves.

**The API contract is UNVERIFIED.** Bob Go's API reference is available only
through Bob Go sales (sales@bobgo.co.za), and we have not seen it. The adapter
is built against what a third-party WooCommerce plugin calls, plus guesses. It
is tested against mocked HTTP only. Nothing has been sent to Bob Go.

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
| `lib/delivery/bobgo/api-contract.ts` | **Every** assumed detail in one place: hosts, auth header, paths, request and response field names, price unit, cancel body, status words, approved service levels, lithium rule, webhook signing. Each item is tagged `[plugin]`, `[research]` or `[assumed]`. `BOBGO_CONTRACT_SOURCES` lists the tags |
| `lib/delivery/bobgo/adapter.ts` | `createBobgoAdapter` (DeliveryPort), `bobgoConfigFromEnv`, `bobgoDelivery`, `bobgoRandsToCents`. No provider detail of its own |
| `lib/delivery/bobgo/webhook.ts` | `bobgoWebhookParser(env)` returns null (closed). `createBobgoWebhookParser({ verify })` for when a scheme is known |
| `lib/delivery/ports.ts` | Registration: `aggregatorCourierFactories()`, behind `gatedCourierFactory` |
| `lib/delivery/webhook-adapters.ts` | Webhook parser registration (closed) |
| `lib/delivery/http.ts` | Shared fetch: timeouts, rejected/unknown classification, circuit breaker. `PATCH` was added to its method list for the cancel call |
| `tests/unit/delivery-bobgo.test.ts` | The adapter against a fake fetch |
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

## The assumed contract

Everything below is in `api-contract.ts`. "Plugin" means a third-party
WooCommerce plugin calls it. That shows a path exists, not how it behaves.

| Item | Assumed value | Source |
|---|---|---|
| Production base URL | `https://api.bobgo.co.za/v2` | plugin |
| Sandbox base URL | `https://api.sandbox.bobgo.co.za/v2` | assumed (a sandbox exists; its host is unknown) |
| Auth | `Authorization: Bearer <merchant API key>` | assumed (the plugin uses the merchant key; header form unknown) |
| Rates | `POST /rates-at-checkout` | plugin |
| Create | `POST /orders` | plugin |
| Read one | `GET /orders/{id}` | assumed (the plugin GETs `/orders`) |
| Lookup by our reference | `GET /orders?channel_order_number={ref}` | assumed |
| Cancel | `PATCH /orders/{id}` with `{"status":"cancelled"}` | assumed (the plugin PATCHes `/orders`) |
| Tracking, webhooks | `GET /tracking`; `GET/POST/DELETE /webhooks` | plugin. **Not called**: tracking is read from the order; webhooks are never registered by code |
| Our reference field | `channel_order_number` | assumed |
| Service level field | `service_level_code` | assumed |
| Addresses | `collection_address` / `delivery_address` with `street_address`, `local_area`, `city`, `zone`, `code`, `country`, `lat`, `lng` | assumed |
| Contacts | `collection_contact` / `delivery_contact` with `name`, `mobile_number` | assumed |
| Parcels | `parcels[]` with `description`, `quantity`, `submitted_weight_kg` | assumed |
| Rates response | `rates[]` with `service_level_code`, `total_price` (rands), optional `currency` | assumed |
| Order response | `id`, `channel_order_number`, `status`, `time_modified` / `time_created`, `shipments[0].status`, `shipments[0].tracking_url`; bare or wrapped in `order` / `data` | assumed |
| Status words mapped | `delivered`, `cancelled`/`canceled`, `in-transit`/`in_transit` | assumed |
| Quote validity | 15 minutes (our cap) | assumed |
| Webhook signing | none known | assumed |

**Status mapping.** Only the words above are mapped. Everything else maps to
`unknown`, which the core never applies, and the core moves a leg forward only
(D13). So a wrong or new word cannot move a shipment. `collected` is
deliberately not mapped: it could mean the courier collected from us, or the
recipient collected from a pickup point.

## What the adapter does

| Port method | Bob Go call | Notes |
|---|---|---|
| `checkServiceability` | none | Local checks: key present, usable coordinates, no lithium, at least one approved service level |
| `quote` | `POST /rates-at-checkout` | Considers **only approved service levels** and picks the cheapest of those. A cheaper unapproved option (a pickup point, for example) is never chosen. Rands → integer cents without float drift. The chosen service level travels as `providerQuoteRef` |
| `createDelivery` | `POST /orders` with `channel_order_number` = our merchant reference | Books exactly the quoted service level, and refuses without sending if it is not approved. See "Create" below |
| `findByMerchantReference` | `GET /orders?channel_order_number=…` | Returns an order only if it echoes our reference **exactly**. Empty, 404, someone else's order, two of ours, or any error → `unknown`, **never "none"** |
| `getDelivery` | `GET /orders/{id}` | Courier name and proof are not stored: neither is in the contract |
| `cancelDelivery` | `PATCH /orders/{id}` | Only an answer whose status is `cancelled` counts. An empty 2xx or any other status → `unknown` (staff check, no refund on a guess). Fee reported as 0; a real fee comes from the invoice |
| `getTracking` | `GET /orders/{id}` | State and tracking link only. No ETA or location is invented |

**What is never sent:** item values, a declared value, brands or models. The
parcel description is the generic driver label.

**Create:**
- A 2xx without an order id → `unknown`. The core reconciles by reference.
- 401/403 → `rejected` with a configuration message, and no lookup.
- 408, 409, 425, 429, 5xx, timeout, network error → `unknown`, with no retry and no lookup.
- Any other 4xx may be "duplicate reference", so the adapter looks the order up **before** calling it a refusal:
  - an order of ours is found → that order is returned. One courier, never two;
  - the lookup answers with no order of ours → the refusal stands (`rejected`);
  - the lookup does not answer → `unknown`.

**Why `idempotentCreate` is still false.** Duplicate-reference behaviour and
the lookup are both assumed. The adapter uses the lookup only in the safe
direction (a positive, exact match), and `findByMerchantReference` never
answers "none". So an uncertain create goes to a person (`reconcile_pending`)
and is never re-dispatched automatically.

## Resilience

Same rules as the other couriers, from `lib/delivery/http.ts`.

| Outcome | Classified as |
|---|---|
| 401 / 403 | `rejected`, with a configuration message |
| Other 4xx | `rejected` (after the duplicate check on create) |
| 408, 409, 425, 429, any 5xx | `unknown` |
| Network error, timeout | `unknown` |

**Timeouts:** reads 8 s, create 15 s, cancel 10 s. **No retries in the adapter.**
**Circuit breaker:** 5 consecutive unknowns open it for 60 s. It is in memory and per instance.

## Webhooks: closed, poll instead

The signing scheme is unknown, so no algorithm is implemented. Guessing one
would either refuse every real event or accept a forged one.

- `bobgoWebhookParser(env)` returns null under every configuration. `/api/webhooks/delivery/bobgo` therefore answers **503 not_configured**, and nothing is stored or applied (D11).
- Status comes from reading the order.
- Once Bob Go documents its scheme in writing, write a verifier for exactly that scheme, with tests, pass it to `createBobgoWebhookParser({ verify })`, and register it in `webhook-adapters.ts` in place of the null factory. Confirm the payload shape at the same time: `parse` is assumed too.

## Capabilities

**All false.** `BOBGO_CAPABILITIES` equals `NO_DELIVERY_CAPABILITIES`.

| Capability | Why false |
|---|---|
| onDemand, scheduled | Same-day and later collections are courier-dependent; which service levels we may use is not settled |
| reverseLogistics | TCG returns exist, but not verified through our account |
| liveTracking, trackingWebhooks | No verified location; webhook signing unknown |
| pickupConfirmation, proofOfDelivery, signature, recipientPin | TCG uses OTP or signature, but whether the API returns it is unknown |
| noLeaveAtDoor | No per-shipment control known |
| declaredValueSupport, verifiedTransitCover | Cover passes through each courier, with second-hand exclusions |
| cancellation | The PATCH is assumed |
| idempotentCreate | See above |

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

**API-specific:**

12. **The API reference itself:** the full v2 reference (OpenAPI if there is one), and whether `api.bobgo.co.za/v2` is the current production base URL.
13. **Sandbox:** the sandbox base URL, or whether a sandbox key works against the production host. Is sandbox data ever handed to a real courier?
14. **Auth:** the exact header (`Authorization: Bearer <key>`, or another), key scopes, rotation, and separate sandbox and production keys.
15. **Lookup by our reference:** an endpoint or filter that returns an order by our reference, and what it returns when there is none (404 or an empty list).
16. **Rates:** is `/rates-at-checkout` the right endpoint for server-side booking, or is there a rates endpoint for API merchants? Request fields (address shape, coordinates, parcel dimensions and weight), response fields, price unit (rands or cents, incl. or excl. VAT), currency, and how long a rate holds.
17. **Service levels:** the list of service-level codes, which courier each maps to, and which are door-to-door versus pickup point. We will book only hand-to-hand, door-to-door levels.
18. **Create:** required fields, how the chosen rate or service level is passed, and the response (order id, shipment id, waybill, tracking link).
19. **Statuses:** the full order and shipment status vocabulary, in order, with meanings. Especially `collected`, exceptions and returns.
20. **Proof of delivery:** POD fields in the API (signature, OTP, photo, recipient name), per courier, and whether they come as files or links.
21. **Cancel:** the cancel endpoint and method, the response, and whether a cancel can fail after collection.
22. **Rate limits:** requests per minute, and the error body format (`message` / `error` fields).

## Switching it on

### Sandbox (preview or development only)

1. Get written answers to the API-specific questions above, then correct `api-contract.ts` to match. Move each item from `assumed` to verified in `BOBGO_CONTRACT_SOURCES`, and update the tests.
2. Fill `approvedServiceLevelCodes` with hand-to-hand, door-to-door levels only. Set `lithiumAccepted` only if Bob Go confirms it in writing for those levels.
3. Set `BOBGO_SANDBOX_API_KEY`, then:
   - `DELIVERY_PROVIDERS=…,bobgo,manual`;
   - `DELIVERY_PROVIDER_BOBGO_ENABLED=true`;
   - `DELIVERY_PROVIDER_BOBGO_MODE=sandbox`;
   - `DELIVERY_ALLOW_SANDBOX=true`.
4. Exercise rates, create (twice with the same reference), lookup by reference, read, cancel, and polling.
5. Customers still will not see Bob Go: it claims no capabilities. Set a capability to true only once it is verified in writing and in sandbox, with a test.

### Production (only after all of the following)

1. Founder approval, recorded in the decision register (D-90).
2. A goods-in-transit policy confirmed **in writing** for third-party-owned rented gear carried by the approved Bob Go couriers. Record it in `DELIVERY_POLICY.insurance` with `coveredProviders: ['bobgo']` (D-41).
3. `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents` set by the founder (D-37), no higher than the cover limit and R50,000.
4. Pickup confirmation, proof of delivery, hand-to-hand and idempotent create verified in writing and in sandbox, and set in `BOBGO_CAPABILITIES` with tests. Webhook signing either verified and implemented, or polling relied on.
5. Set `BOBGO_API_KEY` and `DELIVERY_PROVIDER_BOBGO_MODE=production`.
6. Set `DELIVERY_PROVIDER_BOBGO_PRODUCTION_APPROVED=true`.
7. Turn on the `delivery_courier` flag.
