# Community equipment listings (spec §8.1–8.2)

How a community owner's gear gets from a photo to a live listing, what the
platform checks on the way, and what it does **not** check.

## Journey

1. **Photo.** The owner uploads photos (Cloudinary, from the browser).
2. **AI suggests details.** Onboarding (`/api/onboarding/create-rentals`)
   guesses brand, model, category, title, description, what's included and a
   day/week rate. Every guessed field is recorded in `listing_private.ai_fields`
   as `suggested`. Suggested values are **untrusted**.
3. **Owner reviews and corrects.** In `/dashboard/listings` each unconfirmed
   field shows an "AI suggested" marker. The owner either edits it (recorded
   as `owner_edited`) or presses "Correct" (`owner_confirmed`, via
   `PUT /api/listings { action: 'confirm_ai_fields' }`).
4. **Day rate, replacement value, location.** The owner enters the day rate,
   what it would cost to replace the item, and the suburb and city where it
   is kept. The renter deposit is worked out on the server from the
   replacement value (`RENTAL_POLICY.depositRateBps`); the browser cannot set
   it. A serial number can be recorded for theft reports; it is not shown on
   the listing page, but see Known gaps (it is still readable via the API).
5. **Owner declarations.** Three ticks, stored in `listing_private.owner_attestations` with
   the Terms version and time set by the server: owns it or has the legal
   right to rent it out; it is in the condition described and works; the
   location is accurate.
6. **Submit.** `POST /api/listings/[id]/submit`. The server loads every fact
   itself and runs `decideSubmission` (`lib/core/listings/review.ts`).
7. **Admin review where required.** `/admin/listings` (API:
   `/api/admin/listings/review`). Approve re-runs the submission checks;
   reject and take-down need a note, which the owner sees and is notified of.
8. **Published.** `listing_status = 'published'`; the database sets
   `is_published = true` (migration 072). Public pages still read
   `is_published`.

## Rules

**Can submit** only when all hold:
- owner's ID check is `verified`;
- owner has a payout bank account with `banking_details.is_verified = true`
  (saved details alone are not enough);
- owner is not suspended;
- title, category, day rate > 0, replacement value > 0 and location are set;
- the three declarations are given against the current Terms version;
- no AI-suggested field is still unconfirmed;
- the listing is a `draft` or `rejected`.

**A person must review** (`needsAdminReview`) when any of these is true:
- it would be the owner's first live listing;
- replacement value is above `LISTING_POLICY.reviewValueThresholdCents`
  (currently the high-value collection threshold, R50,000) or missing;
- the owner has an open dispute (see below), is suspended, or has a rejected or
  suspended listing;
- it is a resubmission after a rejection;
- the owner is not yet *established*: fewer than
  `LISTING_POLICY.establishedOwner.minPublishedListings` (3) live listings or
  fewer than `minCompletedRentals` (5) completed hires.

Otherwise the listing goes live on submit. An owner who is not verified is
never published automatically, and an admin approval re-checks the owner.

**Statuses** (`listing_status`): `draft`, `pending_review`, `published`,
`rejected`, `suspended`.

| From | To | Who |
|---|---|---|
| draft | pending_review / published | owner (submit decides which) |
| rejected | pending_review | owner (resubmit) |
| pending_review, published | draft | owner (withdraw / take down) |
| pending_review | published | admin |
| pending_review | rejected | admin, note required |
| any but suspended | suspended | admin, note required |
| suspended | draft | admin (reinstate; must be submitted again) |

**Edits:** any change to a `pending_review` listing, or a change to title,
category, brand, model, replacement value, serial number, location or photos
on a `published` one, takes it back to `draft`. Day rate and description edits
keep it live.

**Database guard (072):** `is_published` is derived from `listing_status`. A
community row cannot be made public by setting `is_published` directly, and
only the server (service role) or SQL editor can change `listing_status`;
review fields are in `listing_private`, which clients cannot write. The studio admin "publish" toggle still works for studio
rows; for community rows use the review page.

## Location and photos

- The location shown is only what the owner types (suburb and city). Map
  coordinates are refused as a location.
- No code path reads EXIF from listing photos. Listing metadata never stores
  GPS/EXIF keys (they are stripped on save).
- Stored photo URLs go through a Cloudinary transformation (`q_auto`), which
  strips EXIF (including GPS) from what renters download. **The original
  upload still contains whatever the phone wrote** and is reachable by anyone
  who knows its untransformed URL. Stripping at upload (an upload preset with
  an incoming transformation) would close this; not done here.

## Where the data lives

- `smart_rentals.listing_status` is public on purpose: it drives
  `is_published`, and says nothing private.
- Everything about the review and the owner's statements is in
  **`listing_private`** (one row per listing, `rental_id` primary key):
  `review_notes`, `reviewed_by`, `reviewed_at`, `submitted_at`, `ai_fields`,
  `owner_attestations`, `replacement_value_evidence`.
  - RLS: the owner can read their own rows (through the SECURITY DEFINER
    helper `caller_owns_rental()`, so drafts work even though
    `smart_rentals` hides them from the owner); admins (`is_admin()`) can
    read all; `anon` has no access.
  - No client role can insert, update or delete. The server writes with the
    service role (`savePrivate()` in `app/api/listings/_lib/server.ts`).
  - The owner's dashboard gets the private fields except `reviewed_by`.
- If saving the private row fails when a draft is created (owner form or
  onboarding), the draft is removed, so AI-suggested values can never look
  owner-confirmed.

## /admin/rentals and community listings

The generic rental editor (`PUT /api/admin/rentals`) refuses, with **409**
`use_listing_review`, any change that would publish or unpublish a community
listing or set its `listing_status`. Those decisions go through
`/admin/listings`, which re-checks the owner and records who decided. Other
edits to community rows, and the publish toggle for studio gear, work as
before.

## Open disputes

`needsAdminReview` counts an owner's open disputes as the number of distinct
hires of their gear that either have `equipment_bookings.status =
'disputed'` or have a `disputes` row with status `open`, `investigating` or
`escalated` (joined by `equipment_booking_id`, in two steps because that
column has no foreign key). If any of these lookups errors, or returns fewer
rows than it counted, loading the owner's facts fails: submission answers
503 and approval is refused. Nothing is decided on partial facts.

## What is NOT verified

Say only what is actually checked. Nothing in this flow verifies that:
- the owner owns the gear or may lawfully rent it out (a declaration);
- the gear exists, matches the photos, works, or is in the stated condition
  (a declaration; a reviewer looks at photos only);
- the replacement value is accurate (optional evidence link or note, not
  checked against a price source);
- the serial number is genuine or not reported stolen;
- the location is where the gear is.

Do not describe listings as "vetted", "inspected" or "verified gear". Accurate
wording: the owner's identity has been checked, their payout account is
validated, and (where shown) a person reviewed the listing before it went live.

## Known gaps

- **`serial_number` is still public (follow-up, not this change).** It has
  been on `smart_rentals` since migration 062, and the public SELECT policy
  returns every column of a published row, so anyone with the anon key can
  read it. `getRentalBySlug()` (`lib/supabase/queries/smartRentals.ts`)
  selects `*`, so revoking the column would break the public detail page.
  Fix: give `getRentalBySlug()` (and any other public `select('*')` on
  `smart_rentals`) an explicit column list, then `REVOKE SELECT
  (serial_number)` from `anon`/`authenticated`.
- The established-owner thresholds (3 live listings, 5 completed hires) are a
  conservative placeholder pending a founder decision.
