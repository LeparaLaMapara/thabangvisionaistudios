# Delivery providers for Gauteng: comparison (Phase 4 §4.3)

Researched 2026-10-09 from public documentation and published terms.

**How far to trust this:**
- The research tool could not open the source pages directly. Every claim comes from search-engine extracts of the cited pages, which were often verbatim.
- Before anything is signed or shipped, a person must open each URL and check it against the live page.
- **NV** means *not verified*: confirm with the provider.
- Several sources are old. The WumDrop FAQ is about 6 years old, and RAM's liability schedule may be over 10 years old.

## Headline

No provider is verified to insure used, rental or third-party camera equipment in transit:

| Provider | Position on cover |
|---|---|
| RAM | Accepts no liability for second-hand goods |
| The Courier Guy | Excludes second-hand goods, and electrical goods not in brand-new original packaging |
| Uber | States it does not carry insurance for package loss, damage or theft |
| WumDrop | R40,000 default cover, from old pages. That is below the R50,000 ceiling, and "very expensive or rare" items are reportedly excluded |

ThabangVision's own goods-in-transit / all-risks policy must be the primary cover, with courier liability at most a secondary layer. **No live courier shipment until an insurer confirms that cover in writing.** This is a founder decision in the decision register (delivery insurance). Until then the code keeps automated courier delivery off, and the insurance adapter answers "not covered".

## Comparison

| Provider | API / sandbox | Gauteng | Quote expiry | Schedule | Webhooks (signing) | Delivery evidence; leave-at-door off? | Returns | Idempotency / lookup by our reference | Insurance |
|---|---|---|---|---|---|---|---|---|---|
| **Uber Direct** | Yes, developer.uber.com; test mode and sandbox; self-serve "select regions" (SA: NV) | Johannesburg, Emfuleni (suburbs NV) | 15 min | Same-day, express under 2 h, up to 30 days ahead | Yes, HMAC-SHA256 | PIN (dropoff), signature, photo, ID, barcode. PIN, signature and ID can't be combined with leave-at-door | Return deliveries (`ret_`) | `idempotency_key`, `external_id` in an official example; behaviour NV | **None** (Uber states no insurance); SA Direct value cap NV |
| **WumDrop** | Yes, wumdrop.readme.io; sandbox key on registration (docs dated) | Johannesburg, Pretoria | NV | Priority (on-demand), Standard (same day) | Status and GPS via third parties; signing NV | Image, signature, or ID plus signature POD; PIN NV; leave-at-door NV | NV | **Yes**: unique `order_reference` (duplicate refused), lookup `/deliveries/ext/:order_reference` | R40,000 default (old source); exclusions apply |
| **Bob Go** (aggregator: TCG, RAM, Skynet, Fastway, WumDrop, Pargo). **Adapter built, off** (`bobgo.md`) | Yes, developer.bobgo.co.za; sandbox. API reference public as a Postman collection (api-docs.bob.co.za); our contract is checked against the sandbox | Courier-dependent | NV | Courier-dependent | Subscribe endpoints; signing NV | Proof-of-delivery endpoint; TCG uses OTP or signature | TCG paperless returns | NV | Passes through each courier's cover; second-hand exclusions |
| **The Courier Guy / Ship Logic** | Ship Logic API | National; same-day express 90 min local | Rates can expire | Same-day tiers | Advertised; signing NV | OTP PIN or signature | NV | NV | R30,000 cap; **excludes second-hand goods and used electricals** |
| **RAM Hand-to-Hand** | No public API (third parties or Bob Go) | Gauteng main centres | NV | Same-day, scheduled | Third parties only | **Face-to-face to the named consignee with ID**, e-POD | NV | NV | **Second-hand goods excluded**; lithium batteries need written consent |
| **Droppa** | Developer portal, approval needed | Gauteng | NV | Immediate, scheduled | NV | NV | NV | NV | NV (30% cancellation fee) |
| **Picup** | Yes, QA sandbox | NV | NV | NV | Generic webhook; signing NV | NV | NV | NV | NV |
| **Pargo** | On request | Pickup points | NV | NV | Optional | Counter handover (breaks hand-to-hand custody) | NV | NV | NV |
| Aramex / Dawn Wing / Fastway | Booking APIs NV | Overnight networks | NV | Next day | Third parties | NV | NV | NV | Owner's risk or low caps |

Sources (as cited by the research; check each before relying on it):
- Uber Direct developer docs: get-started, authentication, FAQ, proof-of-delivery, pincode and webhooks guides.
- Uber SA Courier and Connect pages and terms.
- wumdrop.readme.io; za.wumdrop.com FAQ and pricing.
- developer.bobgo.co.za; bobgo.co.za insurance and terms.
- shiplogic.com/api-docs; thecourierguy.co.za terms.
- ram.co.za FAQ (risk, services), liability schedule and standard terms.
- admin.droppa.co.za developers portal; integrate.picup.co.za; helpdesk.pargo.co.za.

## Recommendation (milestone 4B)

Judged against the spec's priority order (legal → verified cover → custody → coverage → availability → reliability → speed → price):

**Primary: Uber Direct.** Of all the options, its API documents the most custody controls:
- pickup verification;
- PIN, signature and ID at dropoff;
- leave-at-door excluded when those are required;
- HMAC-signed webhooks;
- return deliveries;
- a sandbox.

**Secondary for redundancy: WumDrop.** It has the strongest verified duplicate protection: a unique `order_reference` with lookup.

**Fallback route: Bob Go.** It reaches WumDrop, RAM and TCG for scheduled, non-urgent moves.

Adapter status (2026-10-10):

| Provider | Adapter | Switched on | Claims | Doc |
|---|---|---|---|---|
| Uber Direct | Built, mocked HTTP only | No | Verified features only; `idempotentCreate` false | `uber-direct.md` |
| WumDrop | Built, mocked HTTP only | No | Verified features only; `pickupConfirmation`, `noLeaveAtDoor` false | `wumdrop.md` |
| Bob Go | Contract checked against Bob Go's reference and **sandbox** (quote, create, lookup, cancel); a second create books a second shipment | Sandbox only | **Nothing** (every capability false); quotes refused until approved service levels are set; webhooks closed | `bobgo.md` |

**Do not use:**
- Pargo, because handover at a counter breaks custody.
- The overnight networks, which don't suit same-day rentals.
- TCG or RAM as insurers of used gear.

**Before any live shipment, confirm with Uber Direct:**
- SA merchant terms that allow used, high-value rental electronics;
- the SA per-delivery value cap;
- lithium-battery rules;
- how `idempotency_key` and `external_id` behave, and whether a delivery can be looked up by `external_id`;
- SA cancellation and return fees;
- that SA API onboarding is open;
- that PIN verification works in SA.

## Questions to send shortlisted providers

**All providers:**
1. Full current SA terms for API shipments: merchant agreement, liability schedule, prohibited and restricted items, with effective dates.
2. Goods-in-transit cover: policy wording, insurer, per-item and per-load limits, excess, exclusions, claims procedure, time-bar and evidence required.
3. Are used, second-hand or rental items owned by a third party (the gear owner, not the sender) accepted and covered? Is original packaging required?
4. Cameras, lenses and lithium-ion batteries, installed and loose: limits and packaging rules?
5. Maximum declared value per item and per delivery? Single items of R50,000?
6. Idempotency key or unique merchant reference on create: how long is it kept, what happens to a duplicate, and can we look a shipment up by our reference?
7. Can leave-at-door be disabled per shipment, enforced in the driver app? PIN, signature, photo and ID at pickup and dropoff, returned through the API or webhooks?
8. Webhook signing (algorithm, header, secret rotation), retry policy, full list of events, live location and ETA.
9. Cancellation windows and fees after a driver is assigned or has collected; failed-delivery and return-to-sender fees.
10. Gauteng coverage, same-day cut-offs, SLAs.
11. Sandbox, onboarding time, credit checks, published rand rates.

**ThabangVision's insurer or broker:** does the goods-in-transit / all-risks cover apply to third-party-owned gear rented through the platform, while it is carried by crowd-sourced couriers (Uber, WumDrop), up to R50,000 per item, including lithium batteries?
