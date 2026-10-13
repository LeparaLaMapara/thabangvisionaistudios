# Uber Direct adapter (Phase 4, milestone 4B)

Uber Direct is the courier we chose (2026-10-13, see `provider-comparison.md`).
The owner opened the account; test and live keys are in Vercel (live keys on
Production only). The adapter was checked against **our own Uber sandbox** on
2026-10-13 (results below).

On production (2026-10-13) the policy gates are set but bookings stay **off**:

- set: `DELIVERY_PROVIDERS=manual,uber_direct`,
  `DELIVERY_PROVIDER_UBER_DIRECT_ENABLED=true`,
  `DELIVERY_PROVIDER_UBER_DIRECT_MODE=production`;
- set: the courier limit (D-37) is R35,000, the Sony A7 III, and the owner's own
  policy covers the gear with Uber (D-41, `owner-policy-2026-10-13`);
- **not set**: `DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED`. Without it the
  registry hands the core a refusing adapter with no capabilities, so Uber is
  excluded from every quote and never called; checkout offers our own vehicle;
- **off**: the `delivery_courier` feature flag.

On previews (test keys only) the courier trial lets the whole flow be tried;
see "Switching it on" below.

## Sandbox results (2026-10-13, our account, test keys)

| Call | What Uber answered |
|---|---|
| Token | 200, `expires_in` 2592000 (30 days), scope `eats.deliveries`; same host as live |
| Quote, Braamfontein to Rosebank | 200, `dqt_...`, `fee` 6038 (R60.38) without coordinates, 8855 with them; `currency` "zar"; `expires` +15 min |
| Quote, Braamfontein to Bryanston | 400 `address_undeliverable`: "Max Radius: 6.21 miles, Calculated Distance: 6.74 miles" |
| Create (meet at door, signature + photo, photo at pickup, manifest "Camera equipment") | 200, `del_...`, status `pending`, `live_mode` false, tracking link, signer-name requirement echoed. `undeliverable_action` came back as "" (still to check on a failed delivery) |
| Create again, same `idempotency_key` | 409 `duplicate_delivery`, `metadata.delivery_id` = the first one. Also after a cancel, and also when other fields differ. A new key with the same content makes a new delivery |
| List `?external_id=` | Exactly the deliveries with that external_id; `[]` for an unknown one |
| Get | 200; proof under `pickup/dropoff.verification.{picture,signature}.image_url`, which is "" until the proof exists |
| Cancel | 200, status `canceled` |
| Robot courier (`test_specifications.robo_courier_specification.mode = auto`) | pending, pickup, dropoff, delivered in about 3 minutes; stub proof images; courier location 0,0 |

Changes made from these results: `idempotentCreate` and `cancellation` are
now true; `findByMerchantReference` lists by external_id; a 409 on create
returns the first delivery; an empty `image_url` no longer counts as proof;
trips over 10 km straight-line are not sent to Uber.

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
| cancellation | true | Verified in our sandbox. SA cancellation fees are still unknown: they come from the invoice |
| noLeaveAtDoor | true | PIN, signature and ID exclude leave-at-door; meet-at-door is requested |
| idempotentCreate | true | Verified in our sandbox: a repeated `idempotency_key` is refused with 409 `duplicate_delivery`, and a delivery can be listed by `external_id` |
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

**Verified in our sandbox on 2026-10-13:** the token URL and scope, one host
for test and live, the paths (quote, create, get, cancel, list by
external_id), cents and "zar", the address JSON, the status names pending,
pickup, dropoff, delivered and canceled, the duplicate and lookup behaviour,
and the proof fields.

**Still VERIFY** (marked in `api.ts` / `adapter.ts`):
1. `undeliverable_action: "return"` (the create answer shows ""): check on a failed test delivery.
2. The `pincode` field (not sent yet: the core sends no PIN).
3. The status names `pickup_complete` and `returned` (not seen yet).
4. Webhooks: header names, the event kind `event.delivery_status`, and the payload fields. Needs the webhook set up in the Uber Direct dashboard (below).
5. Cancellation fees in SA.

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

1. Done 2026-10-13: the owner opened Uber Direct; test and live keys are on Vercel.
2. Next: in the Direct dashboard, create a webhook pointing at
   `/api/webhooks/delivery/uber_direct` on the preview (test) and live sites,
   and set its signing key as `UBER_DIRECT_SANDBOX_WEBHOOK_SIGNING_KEY` /
   `UBER_DIRECT_WEBHOOK_SIGNING_KEY`.
3. Get written answers to the questions above.

## Switching it on

### Sandbox (preview or development only), set on Vercel 2026-10-13

1. `UBER_DIRECT_SANDBOX_CLIENT_ID`, `_CLIENT_SECRET`, `_CUSTOMER_ID` (set).
   `_WEBHOOK_SIGNING_KEY`: not yet (needs the webhook in the Uber dashboard).
2. On Preview and Development:
   - `DELIVERY_PROVIDERS=manual,uber_direct`;
   - `DELIVERY_PROVIDER_UBER_DIRECT_ENABLED=true`;
   - `DELIVERY_PROVIDER_UBER_DIRECT_MODE=sandbox`;
   - `DELIVERY_ALLOW_SANDBOX=true`;
   - `DELIVERY_SANDBOX_TRIAL=true`.

   Sandbox is refused when `VERCEL_ENV=production`.
3. `DELIVERY_SANDBOX_TRIAL` (`lib/delivery/sandbox-trial.ts`) lifts, for
   couriers on TEST keys only, the three gates that keep couriers off: the
   `delivery_courier` flag, `automatedDeliveryMaxItemValueCents` = 0 and the
   missing transit cover (it answers "covered" with the reference
   `sandbox-trial-not-insurance`). It returns nothing on `VERCEL_ENV=production`,
   without sandbox providers allowed, or for a courier on live keys, and the
   rental rules (first hire, high value, trust tier) are untouched. Tests:
   `tests/unit/delivery-pricing.test.ts`.
4. Run quotes, create, webhook, cancel and tracking in sandbox. Confirm statuses and proofs arrive as mapped.

### Production (only after all of the following)

1. Founder approval, recorded in the decision register. **Done 2026-10-13.**
2. Cover: the owner confirmed (2026-10-13) that their own policy covers all the gear in transit with a courier and at the renter's. Recorded as `verifiedPolicyRef: 'owner-policy-2026-10-13'`, `coveredProviders: ['uber_direct']`, `maxItemValueCents: 3_500_000`. **Open:** replace the placeholder with the insurer and policy number.
3. Courier limit (D-37): **R35,000** (Sony A7 III), set 2026-10-13. Values come from `docs/operations/replacement-values-2026-10.md`. Uber's own value cap in South Africa is still to be confirmed.
4. Every remaining VERIFY item resolved (idempotency and lookup are done).
5. Set the production credentials and `DELIVERY_PROVIDER_UBER_DIRECT_MODE=production`.
6. Set `DELIVERY_PROVIDER_UBER_DIRECT_PRODUCTION_APPROVED=true`.
7. Turn on the `delivery_courier` flag.
