# Acceptance tests

Each ID maps to the phase that must prove it. "Phase 0 evidence" points to where the test lives.

## Financial and security (spec §11)

| ID | Test | Phase | Phase 0 evidence |
|---|---|---|---|
| T01 | Correct rental total | 0 (core) / 1 (checkout) | `tests/unit/pricing-core.test.ts` |
| T02 | Correct 25% deposit | 0 / 1 | `pricing-core.test.ts` |
| T03 | Correct owner/platform split | 0 / 1 | `pricing-core.test.ts` |
| T04 | Correct rounding across multi-item carts | 0 / 1 | `pricing-core.test.ts`, cart split helper |
| T05 | Tampered browser amount rejected | 0 (subscriptions) / 1 (rentals) | `subscription-checkout.test.ts` |
| T06–T17 | Booking/webhook/refund/transfer idempotency and reconciliation | 1 | — |
| T18 | User cannot set their own verification status | 0 | `lib/migrations/067-lock-sensitive-columns.test.sql` (dev) |
| T19 | User cannot change their verified banking identity | 0 | `067-…test.sql` |
| T20–T23 | AI approval and confirmation tokens | 2 | — |
| T24–T26 | Disputed or overdue gear stays unavailable; collection rules | 1 | — |
| T27 | Owner cannot read another owner's sensitive records | 0 (RLS) / 2 | `067-…test.sql` (cross-user) |
| T28–T30 | Notification dedupe, provider outage, reconciliation | 1 | — |

## Phase 0 mandatory gates (founder correction §I)

| Gate | Evidence |
|---|---|
| Privileged-field INSERT rejected | `067-…test.sql` |
| Privileged-field UPDATE rejected | `067-…test.sql` |
| Ownership reassignment rejected | `067-…test.sql` |
| Legitimate profile updates succeed | `067-…test.sql` |
| Legitimate privileged verification succeeds | `067-…test.sql` |
| Sensitive storage overwrite rejected | `067-…test.sql` |
| Cross-user storage access rejected | `067-…test.sql` |
| Client subscription-price override rejected | `subscription-checkout.test.ts` |
| Payment amount mismatch does not activate a subscription | `subscription-checkout.test.ts` |
| A duplicate payment confirmation does not fulfil twice | `subscription-checkout.test.ts` |
| Required consent cannot be bypassed | `068-consent-records.test.sql`, `consent.test.ts`, checkout consent check |
| Existing accounts keep working | `067-…test.sql` (existing rows), full vitest suite |
| Production credentials are not used in tests | `tests/unit/no-prod-credentials.test.ts` |
| Migrations 067 and 068 work together | Applied together on dev, both test scripts run (`docs/security/phase-0-db-evidence.md`) |

## Delivery (spec Phase 4)
Tests D01–D30 are owned by Phase 4. Phase 0 adds no delivery code.
