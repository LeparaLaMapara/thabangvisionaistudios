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
   `PUT /api/listings { action: 'confirm_ai_fields' }`). Every field the AI
   can suggest is editable, including the week rate and what's included.
4. **Day rate, replacement value, location.** The owner enters the day rate,
   an optional week rate, what it would cost to replace the item, and the
   suburb and city where it is kept. The week rate is charged for each full
   7 days of a hire (`hireCents`, `lib/core/pricing/rental.ts`), so it may not
   be more than 7 days at the day rate (`weekRateProblem`); an edit that
   lowers the day rate below a seventh of the stored week rate is refused
   until the week rate is lowered or cleared. The renter deposit is worked out on the server from the
   replacement value (`RENTAL_POLICY.depositRateBps`); the browser cannot set
   it. A serial number can be recorded for theft reports; it is not shown on
   the listing page, but see Known gaps (it is still readable via the API).
5. **Owner declarations.** Three ticks, stored in `listing_private.owner_attestations` with
   the Terms version and time set by the server: owns it or has the legal
   right to rent it out; it is in the condition described and works; the
   location is accurate.
6. **Submit.** `POST /api/listings/[id]/submit`. The server loads every fact
   itself and runs `decideSubmission` (`lib/core/listings/review.ts`). It then
   replaces every photo with a metadata-free copy (see Location and photos)
   and changes the status only if the listing's `updated_at` is still the one
   it read: an edit that lands while submission is deciding gets a **409**
   instead of being published unchecked.
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
- the week rate, if set, is not more than 7 days at the day rate;
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
  fewer than `minCompletedRentals` (5) completed hires. Hires where the
  renter is the owner do not count.

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
category, condition, brand, model, week rate, replacement value, what's
included, serial number, location, photos or the cover photo on a
`published` one, takes it back to `draft` (`MATERIAL_FIELDS`). Day rate and
description edits keep it live.

**Cover photo:** `thumbnail_url` is always one of the listing's own gallery
photos. The server picks it from the gallery by `cover_public_id` or URL (else
the first photo) and refuses a cover that is not one of them, so a cover can
never be an image a reviewer was not shown. The review page shows the cover
first, then every photo.

**Suspended owners** cannot edit, confirm AI fields or submit (403). They can
still take a live listing down.

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
- Photos are uploaded from the browser, so the **original upload contains
  whatever the phone wrote, including GPS**. Cloudinary strips metadata from
  transformed deliveries only, and anyone who has a photo's URL or public id
  can rebuild the untransformed original URL (drop the `q_auto/` segment, or
  build `res.cloudinary.com/<cloud>/image/upload/<public_id>`). The public
  SELECT on a published `smart_rentals` row returns `gallery[].public_id` and
  `cover_public_id`, so the public id of every published photo is public.
- So, on **submit**, `cleanListingImages()` (`app/api/listings/_lib/images.ts`)
  re-uploads every photo from its transformed (metadata-free) delivery into
  `thabangvision_usecase/media/listings/clean/` through the storage
  abstraction, and the listing is pointed at those copies (gallery, cover and
  `cover_public_id`). The copy's own original has no EXIF, so rebuilding its
  untransformed URL serves no GPS. Photos from another Cloudinary account are
  copied into ours the same way; a photo not on Cloudinary blocks submission
  (422, re-upload it). If any copy fails, nothing changes and submission
  answers 503. A draft's photos are not public (drafts are hidden by RLS).
- Saved URLs also always go through a `q_auto` transformation (a
  `keep_iptc`/`keep_attribution` transformation is replaced), so even a draft
  URL never serves GPS.
- **Remaining risk (founder decision):**
  - The browser originals are **not deleted**: the server cannot prove which
    account uploaded an asset (anyone can put any public id in a gallery), so
    deleting by public id could delete another owner's photo. They are no
    longer referenced by the listing, but **anyone who already has their URL
    or public id can still fetch them with GPS**. That includes every photo
    of a listing published before this change (its public ids were public);
    those keep their originals until the listing is resubmitted, and even
    then the old originals stay reachable to anyone who recorded them.
  - Closing this fully needs a provider-account change, not done here:
    either an upload preset with an incoming transformation that strips
    metadata at upload, or a cleanup job that deletes originals whose
    ownership is recorded at upload (e.g. a tag or context written by the
    signing endpoint).
  - A listing the 072 backfill moved to `pending_review` can be approved
    without passing through submit if its owner only adds the declarations
    (it already had a replacement value); its photos are then not copied.
    Those photos were public before 072 anyway.

## Applying migration 072 (founder decision)

**Applying 072 takes community listings offline.** Community gear published
before 072 went live with no review, usually with no replacement value, so
with a zero deposit. 072's backfill (`listing_review_backfill_072()`) moves
every community listing that is published but was never submitted or
reviewed under this flow to `pending_review`. It disappears from the site
until:
- the owner adds a replacement value (so a deposit is charged) and the three
  declarations, and confirms any AI-suggested fields; then
- a person approves it in `/admin/listings` (approval re-runs every
  submission check), or the owner's edit takes it back to draft and they
  resubmit.

While offline it does not count towards the owner's established-owner
threshold, so it cannot be used to skip review of their next listing.
Studio gear is not affected. Re-running 072 never takes down a listing that
was submitted or reviewed under this flow.

The backfill also marks the AI-filled fields of AI-drafted community
listings that have no recorded AI flags (drafted before 072) as unconfirmed,
so the owner must check them before submitting.

Before applying in production, decide whether to warn affected owners, and
list the listings that will go offline:

```sql
select r.id, r.title, r.owner_id, r.replacement_value
  from public.smart_rentals r
 where r.owner_type = 'community' and r.is_published = true and r.deleted_at is null;
```

The rollback notes at the end of 072 explain how to put such a listing back
by hand.

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
