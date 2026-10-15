# TASK-086: Student verification that halves rental deposits
## Priority: LOW | Status: planned (not built) | Added 2026-10-15

## Why
The press article "Making film equipment accessible to students"
(/press/making-film-equipment-accessible-to-students) describes a student
verification programme that halves equipment rental deposits for verified
students. Nothing of it exists in code. The owner chose not to build it now
(2026-10-15); the article carries a dated "planned, not live yet" note
(PRESS_NOTES in lib/constants.ts) until it ships.

## What it would be
- A student uploads proof of registration (a current student card or a
  registration letter from a South African university, college or film
  school) from their dashboard.
- A person reviews it, like the ID check. AI may read the document to help
  the reviewer, never to approve on its own.
- While the proof is valid (until the end of that academic year), the
  student pays half the usual deposit (RENTAL_POLICY.depositRateBps) on gear.
  Hire prices do not change.
- The trust-tier limits (RENTAL_POLICY.trustTierLimitsCents) are not raised:
  a smaller deposit with the same limit keeps the risk where it is.

## Open questions for the owner
- Which institutions count, and is a learner at a short course a student?
- Does half the deposit apply to every item, or only up to a value?
- Who carries the extra risk on damage beyond a halved deposit?

## Files it would touch
lib/constants.ts (a STUDENT policy block), lib/cart/pricing.ts
(depositPerUnit), app/api/cart/checkout, a review queue in /admin, a
migration for the proof and its expiry, the gear page and checkout copy,
/faq, and the press note (remove it when live).

## Done when
- A verified student sees the halved deposit on the gear page, in the cart
  and on the receipt, and checkout charges exactly that.
- The press note is removed and the FAQ explains the programme.
