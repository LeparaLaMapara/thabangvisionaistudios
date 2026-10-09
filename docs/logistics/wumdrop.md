# WumDrop adapter (Phase 4, milestone 4D: redundancy)

WumDrop is the second courier, kept for redundancy (see `provider-comparison.md`).
It has the strongest verified duplicate protection: a unique `order_reference`
plus a lookup by it. The adapter is built and tested against mocked HTTP only.
It is **off**:

- it is not listed in `DELIVERY_PROVIDERS`;
- it needs an explicit `DELIVERY_PROVIDER_WUMDROP_ENABLED=true`;
- production mode also needs `DELIVERY_PROVIDER_WUMDROP_PRODUCTION_APPROVED=true`.

Even when switched on, the core does not offer it today:

- the `delivery_courier` flag is off;
- the value threshold is 0;
- no cover is verified;
- `pickupConfirmation` and `noLeaveAtDoor` are not verified, and the risk gate requires both.

## Files

| File | What it holds |
|---|---|
| `lib/delivery/wumdrop/api.ts` | Every WumDrop detail in one place: URLs, paths, auth, price field, status map, capabilities. Unverified details are marked `// VERIFY:` |
| `lib/delivery/wumdrop/adapter.ts` | `createWumdropAdapter` (DeliveryPort), `wumdropConfigFromEnv`, `randsToCents` |
| `lib/delivery/wumdrop/webhook.ts` | `createWumdropWebhookParser`, `wumdropWebhookParser(env)`. It fails closed |
| `lib/delivery/http.ts` | Shared fetch with timeouts, classification, circuit breaker |
| `lib/delivery/ports.ts` | Registration (`courierFactories`, `gatedCourierFactory`) |

## Environment variables

```env
# Delivery: WumDrop (off unless all switches below are set)
DELIVERY_PROVIDERS=                               # e.g. "uber_direct,wumdrop,manual"
DELIVERY_PROVIDER_WUMDROP_ENABLED=                # "true" to build the adapter (default: off)
DELIVERY_PROVIDER_WUMDROP_MODE=                   # "sandbox" | "production" (default production)
DELIVERY_PROVIDER_WUMDROP_PRODUCTION_APPROVED=    # "true" only after founder approval + verified cover
WUMDROP_SANDBOX_API_KEY=                          # sandbox key issued on registration
WUMDROP_API_KEY=                                  # production key
```

There is no webhook secret variable. No signing scheme is verified (see below).

## What the adapter does

| Port method | WumDrop call | Notes |
|---|---|---|
| auth | Basic auth, API key as user name, empty password | VERIFY the exact form |
| `checkServiceability` | none | Local check: key present and usable coordinates |
| `quote` | `POST /v1/quotes` (VERIFY) | `price` in rands (VERIFY), converted to integer cents without float drift. Expiry is not documented, so a price is held for at most 15 minutes |
| `createDelivery` | `POST /v1/deliveries` with `order_reference` = our merchant reference | See "Create" below |
| `findByMerchantReference` | `GET /v1/deliveries/ext/{order_reference}` | Found → the job. **404 → definitely none.** Any other failure → `unknown`, never "none" |
| `getDelivery` | `GET /v1/deliveries/{id}` (VERIFY) | Proof of delivery kept as references only. No image URLs or ID numbers |
| `cancelDelivery` | `DELETE /v1/deliveries/{id}` (VERIFY) | An empty 2xx or a `cancelled` status counts as cancelled. Any other 2xx → `unknown`. Fee reported as 0; real fees come from the invoice |
| `getTracking` | `GET /v1/deliveries/{id}` | State and tracking link only. No ETA or location is verified, so none is invented |

**Create:**
- The body carries our merchant reference as `order_reference`, the contact details the driver needs, and a generic parcel label. It never carries a value or brand.
- If WumDrop answers with a 4xx other than 401/403, the adapter looks the job up by `order_reference` **before** treating it as a refusal. The 4xx may be "duplicate reference", meaning an earlier attempt got through.
  - Job found → that job is returned. One courier, never two.
  - 404 → a definite refusal (`rejected`).
  - Lookup fails → `unknown`.
- A 2xx without an id → `unknown`. The core reconciles by reference.

**Status mapping.** Status names are not in our research. Only `delivered` and `cancelled`/`canceled` are mapped. Everything else maps to `unknown`, which the core never applies. Confirm the full list and extend `WUMDROP_STATUS`.

## Resilience

Same rules as Uber Direct, from `lib/delivery/http.ts`.

**How a call's outcome is classified:**

| Outcome | Classified as |
|---|---|
| 401 / 403 | `rejected`, with a configuration message |
| Other 4xx | `rejected`, after the duplicate check on create |
| 408, 409, 425, 429, any 5xx | `unknown` |
| Network error, timeout | `unknown` |

**Timeouts:** reads 8 s, create 15 s, cancel 10 s.

**No retries in the adapter.**

**Circuit breaker:** 5 consecutive unknowns open it, and it stays open for 60 s. It is in memory and per instance. On serverless each warm instance has its own, and a cold start resets it. Use `DELIVERY_PROVIDER_WUMDROP_ENABLED` to turn the provider off for everyone.

## Webhooks: fail closed, poll instead

WumDrop's webhook signing is **not verified**. The research found status and GPS only via third parties, and signing NV.

- `wumdropWebhookParser(env)`, exported for the parser registry, therefore refuses **every** request. Nothing unsigned is stored or applied (D11).
- Status comes from polling: `getDelivery` for known jobs and `findByMerchantReference` for uncertain creates.
- Once WumDrop confirms a signing scheme in writing, configure it in code with `createWumdropWebhookParser({ scheme: { algorithm: 'hmac-sha256-hex', header, secret } })`. If their scheme is different, add it there with tests.
- `parse` keeps only ids, our reference, status and time.

## Capabilities chosen, and why

| Capability | Value | Why |
|---|---|---|
| onDemand | true | Priority service |
| scheduled | false | Standard is same day; booking a chosen future window is NV |
| reverseLogistics | false | Returns NV |
| liveTracking | false | GPS only via third parties |
| trackingWebhooks | false | Signing NV; we poll instead |
| pickupConfirmation | false | NV |
| proofOfDelivery | true | Image, signature, or ID plus signature POD |
| signature | true | POD includes signature |
| recipientPin | false | NV |
| declaredValueSupport | false | NV |
| cancellation | false | DELETE is implemented but NV |
| noLeaveAtDoor | false | NV |
| idempotentCreate | **true** | Unique `order_reference` is refused twice, and there is a lookup by it. Covered by the contract test |
| verifiedTransitCover | **false** | The R40,000 default cover comes from old pages, is below R50,000, and has exclusions. A liability limit is not cover |

## Verified vs VERIFY

**Verified:**
- the API exists, with a sandbox key on registration;
- Johannesburg and Pretoria coverage;
- Priority and Standard services;
- POD by image, signature, or ID plus signature;
- unique `order_reference`, with a duplicate refused;
- lookup at `/deliveries/ext/:order_reference`.

The docs are dated, so re-check all of the above.

**VERIFY** (marked in `api.ts` / `adapter.ts`):
1. The API host, and whether sandbox uses a separate host or only a sandbox key.
2. The Basic auth form.
3. The `/v1` prefix on every path.
4. That create is `POST /v1/deliveries`, and its field names other than `order_reference`.
5. The response shape (`id`, `status`, `order_reference`, `tracking_url`, `updated_at`).
6. The HTTP status and body of a duplicate `order_reference` refusal. The adapter does not depend on it, because it looks the job up on any 4xx.
7. The quote endpoint, its fields, the price field, its unit, and the quote expiry.
8. That `GET /v1/deliveries/{id}` exists and what proof fields it returns.
9. That cancel is `DELETE /v1/deliveries/{id}`, its response, and its fees.
10. The status names.
11. Webhook signing, if any.

## Questions to confirm with WumDrop before enabling

From `provider-comparison.md`:

1. **Terms:** current SA API terms, liability schedule, and prohibited and restricted items, with effective dates.
2. **Cover:** the current goods-in-transit cover, with the limit, excess, exclusions and claims procedure. Is the R40,000 default still current? Are "very expensive or rare" items excluded?
3. **Rental gear:** are used or rental items owned by a third party accepted? Cameras, lenses and lithium batteries?
4. **References:** how long is an `order_reference` kept unique, and what exactly is returned for a duplicate?
5. **Hand-over:** can leave-at-door be disabled per delivery? Is there pickup confirmation (scan, photo or PIN)? Is there a recipient PIN?
6. **Webhooks:** signing algorithm, header, secret rotation, retry policy and event list.
7. **Cancellation:** cancellation windows and fees after a driver is assigned or has collected; failed-delivery and return fees.
8. **Scheduling:** scheduling a future window, return collections, Gauteng cut-offs and SLAs.
9. **Quotes:** quote expiry and published rand rates.

## Onboarding

1. Register at wumdrop.readme.io, get a sandbox key, and request a production account.
2. Work through the VERIFY list in sandbox, and correct `api.ts` where it differs.
3. Get written answers to the questions above, especially hand-over controls and cover.

## Switching it on

### Sandbox (preview or development only)

1. Set `WUMDROP_SANDBOX_API_KEY`.
2. Set:
   - `DELIVERY_PROVIDERS=…,wumdrop,manual`;
   - `DELIVERY_PROVIDER_WUMDROP_ENABLED=true`;
   - `DELIVERY_PROVIDER_WUMDROP_MODE=sandbox`;
   - `DELIVERY_ALLOW_SANDBOX=true`.

   Sandbox is refused when `VERCEL_ENV=production`.
3. Exercise quote, create (twice with the same reference, to confirm the duplicate refusal), lookup by reference, get, cancel, and polling.
4. Customers will not see WumDrop until `pickupConfirmation` and `noLeaveAtDoor` are verified and the policy gates pass. The gates are the `delivery_courier` flag, the value threshold and cover.

### Production (only after all of the following)

1. Founder approval, recorded in the decision register.
2. A goods-in-transit policy confirmed **in writing** for third-party-owned rented gear carried by WumDrop. Record it in `DELIVERY_POLICY.insurance` with `coveredProviders: ['wumdrop']`.
3. Founder sets `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents` (D-37). It can be no higher than the cover limit and R50,000.
4. Hand-to-hand and pickup confirmation verified in writing; only then set `noLeaveAtDoor` and `pickupConfirmation` to true in `api.ts`, with tests. Webhook signing either verified and configured, or polling scheduled.
5. Set `WUMDROP_API_KEY` and `DELIVERY_PROVIDER_WUMDROP_MODE=production`.
6. Set `DELIVERY_PROVIDER_WUMDROP_PRODUCTION_APPROVED=true`.
7. Turn on the `delivery_courier` flag.
