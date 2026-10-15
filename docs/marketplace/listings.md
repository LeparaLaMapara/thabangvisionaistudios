# Community equipment listings (spec §8.1–8.2)

How a community owner's gear gets from a photo to a live listing, what the
platform checks on the way, and what it does **not** check.

## Journey

Three steps for the owner (spec §9.3): **photo → review the suggested details
and price → submit**. Verification adds what it must (ID check, validated
payout account) and a person reviews where the rules say so; none of it is
hidden or skipped. Anyone signed in can save a draft before the ID check.

1. **Photo.** `/dashboard/listings` (or `?new=1`, where the welcome choice
   "List my gear" lands) opens on the photo upload. The owner then chooses
   "Suggest details from photo" or "Fill in details myself".
2. **AI suggests details.** `POST /api/listings/suggest` recognises the gear
   in the cover photo (vision, `lib/agents/tools/vision.ts`; the photo is
   sent as its metadata-free delivery, so no GPS reaches the AI), drafts the
   title, description and what's included (the listing describer,
   `lib/agents/agents/listing-describer.ts`, skipped when vision is under
   `MIN_CONFIDENCE`) and suggests a day and week rate
   (`estimateDailyRate`, `lib/core/listings/suggest.ts`, numbers in
   `LISTING_SUGGESTED_RATES`). The **server** creates the draft, so every
   pre-filled field is recorded in `listing_private.ai_fields` as
   `suggested` whatever the browser does (`suggestListing` returns the
   values and the list of suggested fields together). Suggested values are
   **untrusted**. AI calls are tracked (`trackedCompletion`) and share the
   per-user limits of the onboarding identify step and the describer.
   Onboarding (`/api/onboarding/create-rentals`) uses the same functions.
   - **Replacement value is never suggested.** There is no reliable source
     for it, so it stays empty and is required to submit.
   - **Location** is pre-filled from the profile (city, province). It is the
     owner's own data, not an AI value; the owner's declaration covers it.
   - **Condition** is stored in `sub_category` in the dashboard's vocabulary
     (`new`, `like-new`, `good`, `fair`; `normaliseCondition`). Vision's
     `for_parts` maps to no condition. The equipment type goes to
     `metadata.equipment_type`.
3. **Owner reviews and corrects.** Each unconfirmed field shows an "AI
   suggested" marker and is listed with its value. The owner edits it
   (recorded as `owner_edited`), presses "Looks right" (`owner_confirmed`,
   via `PUT /api/listings { action: 'confirm_ai_fields' }`), or presses
   "Confirm all suggestions" (the same action with every pending field).
   Required fields (photo, title, category, day rate, replacement value,
   location) are marked; the optional ones (week rate, what's included,
   serial number, replacement value evidence) are under "More details",
   whose summary says how many suggestions inside still need checking.
   What's included is edited **one item per line** (an item may contain a
   comma, e.g. "Lens caps (front, rear)"); AI lists are cut to what an owner
   could enter (20 items of up to 80 characters, `clampIncludes`).
4. **Day rate, replacement value, location.** The week rate is charged for
   each full 7 days of a hire (`hireCents`, `lib/core/pricing/rental.ts`), so
   it may not be more than 7 days at the day rate (`weekRateProblem`; the
   suggested week rate is 5 days); an edit that lowers the day rate below a
   seventh of the stored week rate is refused until the week rate is lowered
   or cleared. The renter deposit is worked out on the server from the
   replacement value (`RENTAL_POLICY.depositRateBps`); the browser cannot set
   it. A serial number can be recorded for theft reports; it is not shown on
   the listing page, but see Known gaps (it is still readable via the API).
5. **Submit step: pre-check and declarations.** Saving opens the submit
   step, which calls `GET /api/listings/[id]/check` (read-only;
   `precheckSubmission`, the same rules as submit) and shows, before the
   owner presses Submit: owner blocks (ID check, validated payout account
   with the name-match rule, suspension), listing blocks (fields, AI
   suggestions), and whether a person will review it and why. The three
   declarations are ticked here and stored with `PUT /api/listings
   { action: 'attest' }` (all three required, terms version and time set by
   the server, only on a draft or rejected listing, only onto the private
   row version read). They are stored in
   `listing_private.owner_attestations`: owns it or has the legal right to
   rent it out; it is in the condition described and works; the location is
   accurate. After a submission that goes to review, the owner sees why
   (`review_reason_codes`).
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

## Funnel events (spec §9.6)

Recorded with `trackFunnel` (ids and codes only; user id = owner id,
`meta.listingId`):

| Stage | Where | Meta |
|---|---|---|
| `listing_started` | a draft is created (`insertDraft`, `app/api/listings/_lib/drafts.ts`) | `source`: `dashboard`, `ai` or `onboarding` |
| `listing_draft_complete` | submit is pressed on a draft/rejected listing whose own part is done: every required field, the declarations and every AI suggestion (`listingFieldsComplete`), whether or not the owner's ID or payout account still block it | |
| `listing_submitted` | submit succeeded | `reviewed` (true when it went to a person), `codes` (review reasons) |
| `listing_published` | auto-publish on submit, or admin approve (`/api/admin/listings/review`) | `source`: `auto` or `admin` |

"Draft complete" is measured at the Submit press (not on every save) so it
means "the owner tried to go live with a finished listing". A second press
records it again; funnel reports count distinct listings.

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
description, category, condition, brand, model, day rate, week rate,
replacement value, what's included, serial number, location, photos or the
cover photo on a `published` one, takes it back to `draft`
(`MATERIAL_FIELDS`). The owner is told in plain words which change did it
and that submitting again puts it back live after review.

**What's included on an edit:** a list sent back equal to the stored one
once normalised (items trimmed, blanks and repeats dropped, order kept) is
not a change: the stored list is kept exactly as stored, the listing stays
live and an AI marker on it stays as it was. The 80-character and 20-item
limits apply to what the owner adds; items already stored pass as they are,
and a list no longer than the stored one is accepted, so a list saved before
these limits never blocks an edit.

**Concurrent edits:** an edit writes the private row only if it is still the
version the request read (`listing_private.updated_at`, read back as
`private_updated_at`), then the listing only if its status and `updated_at`
are unchanged. Of two edits that overlap, one is saved whole and the other
gets **409** having changed nothing; if the listing write loses, the private
row is put back only while it still holds that request's own write.
"Confirm AI fields" is conditional on the private version in the same way.

**Cover photo:** `thumbnail_url` is always one of the listing's own gallery
photos. The server picks it from the gallery by `cover_public_id` or URL (else
the first photo) and refuses a cover that is not one of them, so a cover can
never be an image a reviewer was not shown. The review page shows the cover
first, then every photo.

**Suspended owners** cannot edit, confirm AI fields or submit (403). They can
still take a live listing down. On an edit the check fails closed: after
`checkNotSuspended` (which answers "not suspended" if its own read fails),
the route re-reads `profiles.is_suspended` with the service role and answers
**503** if that read fails. A suspension whose expiry has passed does not
block.

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
  untransformed URL serves no GPS. Only photos delivered from **our own
  account** are copied: the URL must be `https://res.cloudinary.com/<our
  cloud>/image/upload/...` (`ownsUrl` plus an anchored path). Anything else,
  including another account's photo or a fetch delivery such as
  `/<cloud>/image/fetch/https://elsewhere/image/upload/x.jpg`, blocks
  submission (422, re-upload it), so the clean folder only ever holds copies
  of our own uploads. If any copy fails, nothing changes and submission
  answers 503. A draft's photos are not public (drafts are hidden by RLS).
- On **save** (create and edit) a new photo must also be from our account
  (`isOwnImageUrl`, 400 on `gallery`); photos already on the listing may stay,
  so an older listing remains editable. Onboarding drafts drop a photo that
  is not from our account (the owner adds photos later).
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
every community listing that is published but has **no `listing_private`
row** (never created, edited, submitted or reviewed under this flow) to
`pending_review`. It disappears from the site until:
- the owner adds a replacement value (so a deposit is charged) and the three
  declarations, and confirms any AI-suggested fields; then
- a person approves it in `/admin/listings` (approval re-runs every
  submission check), or the owner's edit takes it back to draft and they
  resubmit.

While offline it does not count towards the owner's established-owner
threshold, so it cannot be used to skip review of their next listing.
Studio gear is not affected. Re-running 072 never takes down a listing that
went live under this flow: submission and approval both require the owner
declarations, which are stored in `listing_private`, so such a listing always
has a private row. The test is the row, not the `submitted_at` /
`reviewed_at` stamps, because the review record is written after the
decision and can fail. (`submitted_at` is written before the status change
and a failure stops the submission with 503; the review record is retried
once and otherwise reported to the admin as a warning.) A community row
inserted published by hand or through the raw admin rental create
(`POST /api/admin/rentals`), with no private row, would still be taken
offline by a re-run.

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
    service role (`app/api/listings/_lib/server.ts`): `savePrivate()` for
    stamps that must land (submission, review), `savePrivateIfUnchanged()`
    for owner edits and AI confirmations (only onto the version read). Each
    write stamps `updated_at` with random microseconds so it identifies that
    write.
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
