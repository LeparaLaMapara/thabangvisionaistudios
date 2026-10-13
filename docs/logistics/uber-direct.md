# Uber Direct adapter (Phase 4, milestone 4B)

Uber Direct is the primary courier candidate (see `provider-comparison.md`).
The adapter is built and tested against mocked HTTP only. It is **off**:

- it is not listed in `DELIVERY_PROVIDERS`;
- it needs an explicit `DELIVERY_PROVIDER_UBER_DIRECT_ENABLED=true`;
- production mode also needs `DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED=true`.

Even when it is switched on, the core does not offer it to customers today:

- the `delivery_courier` flag is off;
- `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents` is 0;
- no transit-cover policy is verified (`DELIVERY_POLICY.insurance`);
- `idempotentCreate` is false (below), and the risk gate requires it.

## Files

| File | What it holds |
|---|---|
| `lib/delivery/uber-direct/api.ts` | Every Uber-specific detail in one place: URLs, paths, field values, status map, capabilities, timeouts. Each unverified detail is marked `// VERIFY:` |
| `lib/delivery/uber-direct/adapter.ts` | `createUberDirectAdapter` (DeliveryPort), `uberDirectConfigFromEnv`, OAuth token cache |
| `lib/delivery/uber-direct/webhook.ts` | `createUberDirectWebhookParser`, `uberDirectWebhookParser(env)` for the webhook parser registry |
| `lib/delivery/http.ts` | Shared fetch with timeouts, error classification, circuit breaker |
| `lib/delivery/ports.ts` | Registration (`courierFactories`, `gatedCourierFactory`) |

## Environment variables

Credentials are per mode, so a deployment set to sandbox can never pick up live keys.

```env
# Delivery: Uber Direct (off unless all switches below are set)
DELIVERY_PROVIDERS=                                  # e.g. "uber_direct,manual" (priority order)
DELIVERY_PROVIDER_UBER_DIRECT_ENABLED=               # "true" to build the adapter (default: off)
DELIVERY_PROVIDER_UBER_DIRECT_MODE=                  # "sandbox" | "production" (default production)
DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED=   # "true" only after founder approval + verified cover
DELIVERY_ALLOW_SANDBOX=                              # "true" offers sandbox adapters (never on VERCEL_ENV=production)
# Sandbox (test) credentials
UBER_DIRECT_SANDBOX_CLIENT_ID=
UBER_DIRECT_SANDBOX_CLIENT_SECRET=
UBER_DIRECT_SANDBOX_CUSTOMER_ID=
UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY=
# Production credentials
UBER_DIRECT_CLIENT_ID=
UBER_DIRECT_CLIENT_SECRET=
UBER_DIRECT_CUSTOMER_ID=
UBER_DIRECT_WEBHOOK_SIGNING_KEY=
```

Secrets are only ever read from the environment. They are never logged or
returned in an error message. Nothing in the adapter logs request or response
bodies, because those carry names, phone numbers and addresses.

## What the adapter does

| Port method | Uber call | Notes |
|---|---|---|
| auth | `POST https://auth.uber.com/oauth/v2/token` (client credentials, scope `eats.deliveries`) | Token cached per instance until 5 min before `expires_in`. Concurrent calls share one token request |
| `checkServiceability` | none | Local check only: credentials present and usable coordinates. The quote is Uber's real answer |
| `quote` | `POST /v1/customers/{customer_id}/delivery_quotes` | `fee` taken as integer cents. A non-integer or missing fee → `unknown`. A currency other than ZAR → `rejected`. Expiry is at most 15 minutes |
| `createDelivery` | `POST /v1/customers/{customer_id}/deliveries` | See "Create request" below |
| `findByMerchantReference` | none | **Always `unknown`.** No lookup by `external_id` is documented |
| `getDelivery` | `GET …/deliveries/{id}` | Status mapped conservatively (below). Proof kept as references, never image URLs |
| `cancelDelivery` | `POST …/deliveries/{id}/cancel` | `cancelled: true` only when Uber answers `canceled`. Any other 2xx → `unknown`. Fee reported as 0; real fees come from the invoice (`reconcileDelivery`) |
| `getTracking` | `GET …/deliveries/{id}` | Only what Uber reports (ETA, courier location, tracking link). Nothing is invented |

When `findByMerchantReference` answers `unknown`, the core answers
`reconcile_pending` and alerts staff. A person then checks the Uber Direct
dashboard. The core never creates a second job on its own.

**Create request:**
- `external_id`, `idempotency_key` and `manifest_reference` are all set to our merchant reference.
- `quote_id` is the provider quote id.
- Hand-to-hand delivery:
  - `deliverable_action = deliverable_action_meet_at_door` whenever `requirements.noLeaveAtDoor` is set. The policy always sets it.
  - Dropoff needs a signature (`signature_requirement`, with signer name) and a photo.
  - A `pincode` is added when the core supplies a recipient PIN.
  - Pickup needs a photo.
  - `undeliverable_action = return`. The adapter never sends leave-at-door.
- Drivers see only the generic label (`DELIVERY_POLICY.driverLabel`), never brand, model or value.
- `manifest_total_value` is sent only if the core passes a declared value. It does not today, because `declaredValueSupport` is false.

**Status mapping** (anything else maps to `unknown`, which the core never applies):

| Uber | Ours |
|---|---|
| pending | pending |
| pickup | courier_assigned |
| pickup_complete | collected |
| dropoff | in_transit |
| delivered | delivered |
| canceled | cancelled |
| returned | return_to_sender |

## Resilience (spec §4.15)

**How a call's outcome is classified** (`lib/delivery/http.ts`):

| Outcome | Classified as |
|---|---|
| 2xx | ok |
| 401 / 403 | `rejected`, with a "check the provider configuration" message. A refused token is dropped from the cache |
| Other 4xx | `rejected` |
| 408, 409, 425, 429, any 5xx | `unknown` |
| Network error, timeout | `unknown` |
| 2xx with no delivery id | `unknown` |

409 counts as `unknown` because it can mean "already created".

**Timeouts:** token 8 s, reads 8 s, create 15 s, cancel 10 s.

**No retries in the adapter.** A create is never repeated. The core reconciles first.

**Circuit breaker:**
- It opens after 5 consecutive `unknown` outcomes, then lets one trial call through after 60 s.
- While it is open, calls return `unknown` without touching the network.
- Refusals do not trip it.
- It is in memory, per server instance. On serverless each warm instance has its own breaker, and a cold start resets it. It is a load-shedding aid, not a global switch. Use `DELIVERY_PROVIDER_UBER_DIRECT_ENABLED` to turn the provider off for everyone.

## Webhooks

`uberDirectWebhookParser(env)` is exported for the webhook parser registry. The
route calls `receiveDeliveryWebhook({ rawBody, headers, parser, deps })`.

**verify:**
- Computes HMAC-SHA256 over the **raw** body with the signing key for the current mode (hex).
- Reads the signature from `x-uber-signature` or `x-postmates-signature`.
- Compares in constant time.
- No key configured → every request is refused.

**parse:**
- Reads only `event.delivery_status` events. Courier location updates and other kinds are ignored.
- An event whose `live_mode` does not match our mode is ignored. A test event can never move a production shipment.
- Keeps:
  - the event id;
  - the delivery id and our `external_id`;
  - the status and time;
  - the tracking link;
  - the courier's **first name** only;
  - proof references such as `uber_direct:del_x:dropoff:signature`.
- Drops addresses, phone numbers, signer names, image URLs and locations.

## Capabilities chosen, and why

| Capability | Value | Why |
|---|---|---|
| onDemand | true | Same-day and express are documented |
| scheduled | true | Bookings up to 30 days ahead are documented |
| reverseLogistics | true | Return deliveries are documented. Our return leg is an ordinary pickup at the renter's address |
| liveTracking | false | Courier location fields are not in our research |
| trackingWebhooks | true | HMAC-SHA256 signed webhooks are documented |
| pickupConfirmation | true | Pickup verification is documented |
| proofOfDelivery | true | PIN, signature and photo are documented |
| signature | true | Documented |
| recipientPin | false | Documented, but whether it works in SA is unconfirmed |
| declaredValueSupport | false | The SA value cap is not verified |
| cancellation | false | The endpoint is implemented but not in our verified research, and SA fees are unknown |
| noLeaveAtDoor | true | PIN, signature and ID exclude leave-at-door; meet-at-door is requested |
| idempotentCreate | **false** | `idempotency_key`/`external_id` behaviour is NV, and there is no lookup by our reference. **The gate excludes Uber until this is confirmed** |
| verifiedTransitCover | **false** | Uber states it carries no insurance |

## Verified vs VERIFY

**Verified** (from `provider-comparison.md`):
- OAuth client credentials;
- test mode and sandbox;
- 15-minute quote expiry;
- same-day, express and scheduled (up to 30 days ahead);
- HMAC-SHA256 webhooks;
- pickup verification;
- PIN, signature, photo, ID and barcode at dropoff;
- PIN, signature and ID are not combinable with leave-at-door;
- return deliveries;
- `idempotency_key` and `external_id` exist in an official example;
- no insurance.

**VERIFY** (each is marked in `api.ts` / `adapter.ts`):
1. The token URL, and that scope `eats.deliveries` works for Direct in SA.
2. The API host, and whether sandbox uses a separate host or only test credentials.
3. The exact paths for quotes, create, get and cancel.
4. That `fee` is in cents and `currency_type`/`currency` reads `ZAR`.
5. The address JSON shape (`street_address`, `city`, `state`, `zip_code`, `country: "ZA"`).
6. The field names `deliverable_action`, `undeliverable_action`, `pickup_verification`, `dropoff_verification.signature_requirement`, `picture` and `pincode`.
7. The status names (table above).
8. The webhook header names, the event kind `event.delivery_status`, and the payload fields (`delivery_id`, `data.external_id`, `live_mode`, `created`).
9. **How `idempotency_key` / `external_id` behave on a repeated create, and whether a delivery can be listed or looked up by `external_id`.** This decides `idempotentCreate`.
10. The proof fields in the delivery object (`pickup.verification`, `dropoff.verification`).
11. Cancellation fees in the cancel response, if any.

## Questions to confirm with Uber before enabling

From `provider-comparison.md`:

1. **Terms:** do SA merchant terms allow used, high-value rental electronics owned by a third party?
2. **Value cap:** what is the SA per-delivery value cap? Are single items of R50,000 allowed?
3. **Lithium:** what are the rules for lithium-ion batteries, installed and loose?
4. **Idempotency:** how do `idempotency_key` and `external_id` behave (retention, duplicate response)? Can a delivery be looked up by `external_id`?
5. **Fees:** what are the SA cancellation and return fees, and when do they apply?
6. **Onboarding:** is SA self-serve API onboarding open, and for which regions?
7. **PIN:** does PIN verification work in SA?
8. **Leave-at-door:** can it be disabled per delivery and enforced in the driver app?
9. **Webhooks:** signing details, key rotation, retry policy and the full event list.
10. **Coverage:** Gauteng suburbs and same-day cut-offs.

## Onboarding

1. Create a developer account at developer.uber.com and request Direct access for South Africa.
2. Create a sandbox (test) app and note its client id, secret and customer id.
3. In the Direct dashboard, create a webhook pointing at the delivery webhook route (built by the routes workstream) and copy its signing key.
4. Work through the VERIFY list in sandbox, and correct `api.ts` where it differs.
5. Get written answers to the questions above.

## Switching it on

### Sandbox (preview or development only)

1. Set `UBER_DIRECT_SANDBOX_CLIENT_ID`, `_CLIENT_SECRET`, `_CUSTOMER_ID` and `_WEBHOOK_SIGNING_KEY`.
2. Set:
   - `DELIVERY_PROVIDERS=uber_direct,manual`;
   - `DELIVERY_PROVIDER_UBER_DIRECT_ENABLED=true`;
   - `DELIVERY_PROVIDER_UBER_DIRECT_MODE=sandbox`;
   - `DELIVERY_ALLOW_SANDBOX=true`.

   Sandbox is refused when `VERCEL_ENV=production`.
3. Customers will still not see Uber until the policy gates pass. To exercise it end to end in a **non-production** environment you also need:
   - the `delivery_courier` flag;
   - a non-zero `automatedDeliveryMaxItemValueCents`;
   - a test insurance entry;
   - `idempotentCreate` confirmed (item 9).

   Each of these is a founder decision. Do not change them on production for a test.
4. Run quotes, create, webhook, cancel and tracking in sandbox. Confirm statuses and proofs arrive as mapped.

### Production (only after all of the following)

1. Founder approval, recorded in the decision register.
2. A goods-in-transit / all-risks policy confirmed **in writing**, covering third-party-owned rented camera gear carried by Uber couriers. Record it in `DELIVERY_POLICY.insurance`: `verifiedPolicyRef`, `coveredProviders: ['uber_direct']` and `maxItemValueCents`.
3. Founder sets `DELIVERY_POLICY.automatedDeliveryMaxItemValueCents` (D-37). It can be no higher than the cover limit, the Uber value cap and R50,000.
4. Every VERIFY item resolved, and `idempotentCreate` set to true **only** if a duplicate is refused or a lookup by our reference exists. Implement `findByMerchantReference` with that lookup first, and update the contract test.
5. Set the production credentials and `DELIVERY_PROVIDER_UBER_DIRECT_MODE=production`.
6. Set `DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED=true`.
7. Turn on the `delivery_courier` flag.
