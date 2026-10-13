# TASK-072: Gear check at pickup and return that both sides trust
## Priority: MEDIUM | Added by the owner on 2026-10-13
## Files allowed: app/api/rentals/[id]/*, app/(admin)/admin/rentals/*, app/dashboard/rentals/*, a new migration

## Why
Renters and owners argue about damage because nobody can prove what the gear
looked like at pickup. Every rental needs a check out and a check in that both
people agree to on the spot.

## Today
- `POST /api/rentals/[id]/checkout-condition` and `/return` exist, admin only.
- One condition grade per booking (new ... for_parts), a free list of photo
  URLs and notes, stored in `rental_bookings.condition_at_checkout`,
  `checkout_photos`, `condition_at_return`, `return_photos`, plus `handover` jsonb (062, 070).
- The dispute page reads them.

## Gaps
- No per-item checklist (body, lens, batteries, cards, caps, cables).
- No serial number check, so a swapped body cannot be caught.
- The renter never signs the condition; it is staff's word only.
- Owner pickup (080) has no check at all if no staff member is there.
- No side-by-side "out vs in" view.

## Plan
1. Per-listing checklist: items, serial numbers and required photo angles,
   filled in once when the gear is listed.
2. Phone-first check screen for whoever hands over (staff or owner): tick each
   item, take the required photos (camera only, timestamped, location kept),
   note marks.
3. Renter confirms on their own phone (one tap, or a short code read aloud).
   Both sides get a PDF/record by email.
4. Return uses the same list; the screen shows the pickup photo next to the
   return photo per angle.
5. Any "new mark" opens a dispute with the evidence attached (TASK-055).
6. Later: AI compares the photo pairs and flags likely new damage for a
   human to confirm. Never decides money on its own.

## Do not touch
Deposits, refunds and payouts logic; only link to it.
