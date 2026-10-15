# Many roles, honest proof

**Show your face, show your work, set your price. We do the rest.**

Status (2026-10-14): slice 1 (PR #132, migration 090) is on develop. Slice 2,
"People complete" (branch `feature/people-complete`, migration 091), builds
everything below that used to say "designed": equal chance, the three
screens, names, comes with, CV facts, embeddings, proof formats, who/where/
when and the face check. Everything is behind `roles_v1`; with it off every
new page and API route is a 404 (tests: `roles-flag-off`,
`roles-pages-flag-off`). Nothing goes to main until People is complete on
develop. Owner decisions still open: see "Decisions for the owner" at the end.

**Hidden machinery** (the person never sees it): the AI reads what they put in
the box (agent `profile-extract` for a CV, voice note or text; agent
`role-match` for the role), PII is stripped, facts are reviewed by the person,
proof is filed by format (look, listen, thing, trust), the profile is embedded
for matching (competence only), the record grows with every job, and a person
on our team reviews against the guidelines with the face next to the ID
selfie.

## Equal chance (the most important rule)

Everyone gets an equal chance and is judged only on competence and delivery.
No bias by gender, race, age or looks.

- **Blind before booking.** Clients choose on the work, the record and the
  price. Public cards and profiles show the role, the area, the work (or the
  facts for trust roles), what the offer comes with, the price, the record line
  ("N jobs, on time N/N") and work-only reviews with reviewers' initials. The
  label is neutral ("Make-up artist, Soweto, MA-1042"), never a first name,
  because names signal gender and ethnicity.
- **Reveal on a confirmed booking.** The face, the first name and the "Who's
  coming" card (who, where, when) are shown to the client only once a booking
  is confirmed and paid (payment held). The booked person sees the client's
  first name and the job details at the same moment. This is enforced where
  the data is read, not only on screen: the face and name are never sent to an
  unbooked viewer's browser.
- **The face photo is still required** when offering (it is how we verify the
  person and how the client knows who arrives), with the words: "Your photo.
  Clients only see it after they book you, so everyone is chosen for their
  work."
- **Matching and ranking use competence only:** facts, work, record,
  availability and distance. Never the name, photo, gender, age, race or
  language as identity (languages spoken stay a skill a client can filter on).
  The profile document we embed leaves out the name and any self-description
  of gender or ethnicity. Fair "new" slots stay.
- **Work proof shows the work, not the person.** No selfies as proof. Make-up
  proof shows the client's face, which is fine: that is the work. The one
  deliberate exception is on-camera talent (models), where appearance is the
  work, so their digitals are the proof. Review guideline line: "Reject proof
  that is just a selfie of the creator (except models)."

**How it is enforced (slice 2):** browsers can read only the public columns of
`person_roles` (migration 091 column grants: never `user_id`, `answers`, the
reviewer's note). Faces live in `person_faces` and the private
`role-documents` bucket; the server reads a face and a first name only inside
`getRequestForViewer()` when `reveal()` allows it (confirmed booking, the
client asking). `tests/unit/people-blind-access.test.ts` proves the People
cards, profiles and an unconfirmed request carry no identity and never read a
face. Payment for roles is not built, so `role_booking_requests.status =
'confirmed'` is the DEV stand-in for "booked and paid, payment held".

## The vision

ThabangVision is not only photographers and videographers. It is everything it
takes to make a shoot or an event happen:

- **People**: models, make-up artists, hair, stylists, gaffers, sound, editors,
  drivers and more.
- **Things**: gear and vehicles.
- **Places**: studios and locations.

Access matters most. Many talented people have no portfolio and no certificate:
the make-up artist who learnt from her aunt, the driver with a clean van, the
young model nobody has signed yet. They must be able to join.

There must also be a standard and trust. A client booking a stranger needs a
reason to believe the work will be good and the person will show up.

This design does both: anyone can join, and nobody is shown to clients until
there is honest proof.

## One way in for offering

Owner direction, 2026-10-14: there must be exactly one way into the platform
for people who offer something, and finding should stay as simple as it
already is.

**Finding is already solved.** People browse photographers or gear, pick,
book, and the ID check follows at the point of booking or renting. That does
not change. `/people` (approved role profiles) simply joins the other browse
pages. No new search box, no new home hero.

**Offering had three doors** (creator onboarding at `/onboarding`, "list my
gear", and "join as a role"). With `roles_v1` on there is one: **Offer**
(`/offer`).

1. Sign up once (as today). The welcome question keeps "Rent gear" and "Book a
   photographer or videographer" exactly as they are, and replaces "List my
   gear" and "Offer my services" with one choice: **Offer something**.
2. Offer asks one thing: "What do you want to offer?" The person says it in
   their own words ("I do make-up for weddings", "I have a Quantum and drive
   crews", "a Sony camera to rent out") and/or adds one photo.
3. We suggest where it fits (one, or two when unsure). One tap to confirm, or
   pick from the list:
   - a skill or service goes to the profile maker (`/offer/<role>`);
   - gear goes to the existing photo-first listing (`/dashboard/listings?new=1`);
   - a vehicle goes to driver with vehicle (the driver always comes with it).
4. Renters and clients are done after one tap on the welcome screen. Nothing
   extra is asked.

Deep links all land in the same flow: `/join` goes to `/offer`, `/join/<role>`
to `/offer/<role>`, and `/onboarding` to the photographer profile maker, which
carries over what the person already entered. The old separate "Join" nav entry
is gone. With the flag off, every one of these behaves exactly as today
(`/onboarding` shows the old flow; the new pages return 404).

**Why.** Every extra door is a decision the person has to make before they have
done anything, and the people we most want (no portfolio, a cheap phone, little
data) are the ones most likely to give up at a choice they do not understand.
Saying what you do in your own words needs no knowledge of our categories.

### Saved answers keep working

The welcome answer is stored on the account (`user_metadata.intent`). Old
answers map onto the two journeys (`journeyOf()` in `lib/welcome.ts`): rent and
hire are "find", list and supply are "offer", browse stays browse. The new
"offer" answer is valid everywhere the old ones are (`isWelcomeIntent`,
`homeFor`, which sends an un-onboarded "offer" person to `/offer`).

### The AI match (agent `role-match`)

- Candidates are the role slugs in the `roles` table plus the rental
  categories, written `gear:<category>`. The model must answer JSON with at most
  two of those slugs; anything else is dropped (`parseMatchAnswer`).
- Gemma 4 (`gemma-4-31b-it`, free tier, the same model the onboarding vision
  agent uses) reads the words and the photo. If it fails, the registry's fast
  text model reads the words. If there is no AI at all, a keyword match answers
  (`keywordMatch`), so the step always works. The browser also runs the keyword
  match itself when the server cannot answer.
- Every call goes through `trackedCompletion` (cost tracking). Rate limited
  per person (`ROLES_POLICY.matchRateLimit`).
- Only the person's words (emails, phone numbers and links removed, cut to 300
  characters) and the one photo (shrunk to about 768 px in the phone) are sent.
  Nothing personal is logged: not the words, not the photo, not the answer.
- It suggests, it never assigns. For existing accounts with free-text skills
  the Offer step starts with their skills filled in and a suggestion already
  shown; they still tap to confirm.

### Existing accounts: nobody redoes anything

- The ID check is per person and reused for every role (unchanged).
- The profile maker prefills from the profile for everyone: area, a headline
  from the specialisations, the bio (`profilePrefill`).
- A new photographer draft brings the old creator portfolio photos with it, as
  evidence marked "uploaded" (not taken in the app), at most 6
  (`portfolioEvidenceRows`).
- `scripts/roles/backfill-existing.sql` (idempotent) gives every account with
  creator data (onboarding finished, portfolio photos, available for hire, or
  a crew page) a prefilled **draft** for photographer or videographer, with
  their portfolio photos as uploaded evidence. Never approved: review stays
  human. Accounts with only free-text skills get a suggestion, never a draft.
  Gear owners are not touched (gear is a listing, not a role).
- On DEV (2026-10-14) it ran and created 0 drafts: none of the 37 real dev
  accounts has creator data. A rolled-back test with a made-up creator showed
  the draft, the prefill, the price kept inside the band and 2 photos carried
  over. On production (39 accounts, 0 finished creator onboarding, 1 with
  portfolio photos) it would touch about 1 to 3 people. **Not run there.**

## Three separate questions

We never mix these up.

### 1. Who are you?

The existing ID and selfie check (`/dashboard/verification`). The same for
everyone, whatever they do. A profile is never shown to clients before it.

### 2. Are you allowed?

Only what the law asks for that kind of work. Never a document the law does not
require. Each requirement in the database says whether the law or the platform
asks for it (`basis: 'law' | 'platform'`), and the page says "Our rule, not the
law" for platform rules.

| Role | What we ask | Why |
|---|---|---|
| Driver with vehicle | Driving licence for the vehicle | National Road Traffic Act |
| Driver with vehicle | PrDP category P, only if they carry people | The law needs a PrDP to carry people for pay. Gear-only drivers are not asked |
| Driver with vehicle | Valid licence disc | Every vehicle on a public road |
| Driver with vehicle | Roadworthy certificate, only if they carry people | Yearly for vehicles carrying people for pay |
| Driver with vehicle | Insurance that covers paid trips | **Platform rule, not law** (the owner chose it; see Decisions) |
| Drone pilot (coming soon) | SACAA remote pilot licence, operator certificate (own or the operator's), drone registration | Civil Aviation Regulations Part 101 |
| Model | 18 or older | Our launch rule for models; confirmed from the ID check, no other document |
| Photographer or videographer, make-up artist | Nothing beyond the ID check | No legal licence exists for this work |

The PrDP and roadworthy rows apply only when the driver answers "yes" to "Will
you drive people (crew or models), not only gear?"

### 3. Can you do it well?

An evidence ladder, per role. A person climbs it with real proof, never with
paperwork.

| Level | What earns it |
|---|---|
| New | Identity checked |
| Shown | A proof task done in the app (at least 3 photos or videos captured in the app), accepted by a reviewer |
| Vouched | A past client or a proven pro confirms, and a person on our team called them |
| Proven | 3 confirmed ThabangVision jobs |
| Trusted | 10 or more jobs, at least 5 reviews averaging 4.5 stars or more, no disputes |

The numbers live in `ROLES_POLICY.ladder` (lib/constants.ts). The logic is
`evidenceLevel()` in `lib/roles/ladder.ts`, with unit tests.

**The level limits job size**, like the renter trust tiers in
`lib/core/rental/trust.ts`. Biggest single job per level
(`ROLES_POLICY.jobSizeLimitsCents`): New R1 500, Shown R4 000, Vouched
R10 000, Proven R25 000, Trusted R80 000.

**Nobody is blocked.** A person is matched to the work their record supports.
When a job is too big, `canTakeJob()` says what their record supports today and
exactly what unlocks the next level.

## Apple principles, and why

- **Hide the machinery.** Clients see one "Verified" mark (ID checked plus every
  legal check that role needs), the work shown large, and "N jobs done on
  ThabangVision" from a real count. A new person shows "New on ThabangVision",
  never a fake number. Clients never see the word "level". Why: jargon makes
  people feel judged and makes clients doubt; one clear mark is easy to trust.
- **Focus.** Four roles a typical shoot needs, done well, before adding more:
  photographer or videographer, make-up artist, model, driver with vehicle.
  The rest show "coming soon, leave your number", which also tells us where
  demand is.
- **App Store style curation.** Anyone can apply. A person checks the proof
  against **published** guidelines for that role before the profile is visible.
  The guidelines are on the join page, so nobody is surprised. A send-back must
  say how to get there: the review screen refuses a note shorter than 15
  characters, and the person sees it in a "How to get there" box.
- **The proof task is a gift, not a test.** The profile maker walks the person
  through capturing their work in the app (window light, angles, before and
  after). The result is a beautiful profile they could not easily make
  themselves. Capturing in the app is also the proof that the work is theirs.
- **Fixed, clear prices** per role and unit, shown before paying. The maker
  fills in the typical price; the person may move it only inside the role's
  low to high band, so prices stay fair and comparable.
- **Built for the person with the least.** A cheap Android phone, little data,
  WhatsApp-simple words. Photos are made smaller in the phone before upload
  (long edge 1600 px). One small step per screen. 44 px touch targets. "Leave
  your number" needs no account.
- **One template.** Every profile, any role, uses the same page
  (`components/roles/RoleProfile.tsx`).
- **The platform stands behind every booking.** Payment held until delivery;
  replacement or refund if something goes wrong. The promise line is on every
  profile and the price step (`ROLES_POLICY.copy.promise`). Building the money
  flow for these roles is out of scope for now.

## How "captured in the app" is decided

The camera button opens the phone camera (`capture` on the file input). The
server labels a photo `captured_in_app` only when it came from that button and
the photo's own date (EXIF), or else the file time, is within 15 minutes of the
upload (`ROLES_POLICY.captureFreshnessMinutes`, `classifySource()` in
`lib/roles/proof.ts`). Everything else is `uploaded`. It is honest labelling,
not proof on its own: the reviewer still looks, and sees the label on every
thumbnail. GPS is never stored.

## Role catalogue (launch)

All of this is data in the `roles` table, editable without a code change.

| Role | Status | Proof task (in the app) | Price unit, suggested | Safety rules |
|---|---|---|---|---|
| Photographer or videographer | Live | 3 to 6 best photos or clips (upload is fine); one portrait taken now by a window; a kit photo | Per hour, R1 500 (R600 to R3 000) | Existing creator onboarding (`/onboarding`) keeps working beside it |
| Make-up artist | Live | Before and after (same face, same light); three angles; eye close-up; clean kit | Per look, R650 (R350 to R1 500) | Ask the model first; clean kit |
| Model | Live, 18+ | Digitals (front, side, full body front and side, plain wall, daylight); a 10 second walk; past shoots optional | Per hour, R450 (R250 to R1 200) | We never ask for revealing photos and nobody on ThabangVision may |
| Driver with vehicle | Live | Vehicle outside (3 angles); inside and boot | Per day plus per km, R1 800 + R6/km | The driver always comes with the vehicle. Never self-drive |
| Gaffer | Coming soon | Before and after of a space they lit | Per day | |
| Sound recordist | Coming soon | A clip recorded somewhere noisy, cleaned up | Per day | |
| Hairstylist | Coming soon | Before and after | Per look | |
| Wardrobe stylist | Coming soon | Three looks styled on a person | Per day | |
| Editor | Coming soon | Raw and finished | Per hour | |
| Drone pilot | Coming soon | Three aerials | Per day | SACAA documents (above) |
| Location or studio | Coming soon | Wide photos of every room | Per hour | |

## How it works (screens)

- `/welcome` (after sign-up): "What did you come to do?" Rent gear, book a
  photographer or videographer, or **Offer something**, plus "just looking".
- `/offer`: "What do you want to offer?" Own words and/or one photo, the AI
  suggestion with one tap to confirm, or pick yourself (live roles, gear to
  rent out, coming-soon roles that take a phone number).
- `/offer/[role]`: the profile maker: about you (prefilled), what the law needs
  (only where it applies), one screen per proof step, price, send for review.
- `/people/[id]`: the public profile (approved only).
- `/people`: every approved profile, filter by role.
- `/admin/roles`: the review queue. The proof sits next to that role's
  published guidelines. Approve, or ask for changes with a required note.
  Approving needs the ID check done, every applicable legal document in hand
  and the age rule met; it marks those documents and the in-app proof checked
  and works out the level.

Everything new is behind the `roles_v1` flag: with it off, the welcome screen,
`/onboarding` and the nav are exactly as today and the new pages return 404.
The pages are `noindex` during the trial.

## Data

Migration 090 (`lib/migrations/090-roles-and-proof.sql`), rollback in
`scripts/db/rollback/090-roles-and-proof.sql`.

- `roles`: slug, name, `role_group`, description, status (`live` or
  `coming_soon`), `min_age`, `legal_requirements`, `proof_task`, `guidelines`,
  `pricing_unit`, `suggested_price_cents`, `existing_flow_href`, sort.
- `person_roles`: one per person per role. Status, evidence level, headline,
  about, area, price, answers, reviewer note, legal check time, `is_demo`.
- `role_evidence`: kind (photo, video, document, vouch, link, booking), source
  (captured_in_app, uploaded, vouched, assessed, booking), storage reference
  (Cloudinary public id for work; a path in the private `role-documents` bucket
  for documents), capture time, device summary, who checked it.
- `role_interest`: coming-soon phone numbers.

Who may do what (RLS + column grants + a trigger):

- Anyone reads the catalogue, approved profiles and the public work of
  approved profiles. Never legal documents, never drafts.
- A signed-in person reads and writes only their own drafts and evidence. They
  can never set their own status to approved, their level, the reviewer's note
  or the legal check.
- Admins (`is_admin()`) read everything; the review API writes with the
  service role after `requireAdmin()`.

## Phased rollout

1. **Now (this slice, dev only):** catalogue, one Offer flow with the AI match,
   profile maker, review queue, public profile, backfill script, demo data.
   Flag on in dev, absent in production.
2. **Owner review:** the owner walks the demo, decides prices, first roles and
   guidelines wording. A few real people from the network try the maker on
   dev.
3. **Production soft launch:** apply 090 to production, keep `roles_v1` off,
   invite people by link to `/offer/<role>`, review them, then switch the flag
   on.
4. **Booking:** connect these profiles to the booking and payment flow (held
   payment, release on delivery, replacement or refund), count completed jobs
   into the ladder automatically, notify people when they are approved or sent
   back.
5. **More roles:** open coming-soon roles one at a time, where "leave your
   number" shows demand.

## Slice 2: People complete (built on feature/people-complete)

Decided by the owner on 2026-10-14 and built in slice 2 (migration 091).
Where this section and older sections below disagree, this section wins: the
three screens replace the step-by-step profile maker and the separate legal
and proof steps.

### Three screens for the person offering

Everything else is hidden machinery.

1. **Your photo.** The face, camera capture, required. Nothing else on the
   screen.
2. **Show us your work.** One box that accepts anything: photos, a 30-second
   clip, a CV (PDF, Word or a photo of it), a voice note, or a few typed lines.
   The AI works out what it is (work photos: Look; audio: Listen; photos of
   gear or a vehicle: Thing; a CV, voice note or text: facts) and suggests the
   role, one tap to confirm. If a role legally needs one more thing, it is
   asked inline as a single extra photo (licence and PrDP, licence disc, 18+
   ID), only for those roles.
3. **Your price and area.** Prefilled price, area and days available. Then
   "Done. A person will check it within 2 working days."

Then "Here's how clients will see you": the profile preview. The client-facing
profile is three things: work (or facts for trust roles), price, and one record
line. No levels, no jargon. The review guidelines are for admins; the person
gets one "What we look for" link.

### Hidden machinery behind the three screens

- **CV, private: extract, structure, embed.** The original is stored privately
  (the `role-documents` bucket, owner and admin only) and deleted after a set
  retention period. Facts are extracted with the AI abstraction
  (`trackedCompletion`, agent `profile-extract`) into a strict schema: roles
  and skills, years, kinds of jobs, areas, languages, equipment, vehicles,
  credits, certifications. ID numbers, addresses, phone numbers, emails, dates
  of birth and references' contact details are stripped and never stored as
  facts or embedded. The person reviews and edits the facts before anything is
  saved. A voice note or a few typed lines produce the same schema. The CV is
  never shown to anyone.
- **Profile embedding that improves over time.** A profile document built from
  the reviewed facts plus the record (jobs done, on-time rate, rebooked count,
  reviews, vouches, credits from real bookings), never the raw CV, embedded
  with `lib/rag/embeddings` (gemini-embedding-2, 768 dimensions) into a
  pgvector table with the model and dimensions recorded. Re-embedded when the
  facts or the record change. A matching function does similarity search
  filtered by role, availability and area, ranked with the record, with fair
  "new" slots; admin-only at first.
- **Proof formats per role** (`roles.proof_format`): look (photo grid), listen
  (audio player, 30-second clips; sound recordist), thing (guided item photos;
  location or studio), trust (facts plus the record first; driver with
  vehicle).
- **Team signals (data shape only):** `team_signals` keeps co-booking pairs,
  the client's rating per booking and a private "would work with them again",
  so Teams are possible later.
- **Who, where, when (Uber style).** A shared "Who's coming" card: who (photo,
  first name, role, Verified, record), where (the address, only to the booked
  person after booking), when (date, arrival time, how long). Shown only after
  a confirmed booking (see Equal chance). A live arrival time on the day needs
  the mobile app's location (TASK-084) and is a later step.
- **Face check.** Where the ID-check selfie exists, the reviewer sees it next
  to the in-app face photo and marks same or different. No automatic face
  matching.

### Names

- The main menu becomes **People, Rentals, Apps, Help**. "People" replaces
  "Studio": Studio sounded like a place to hire, not people to book. People
  holds everyone bookable: today's photo and video packages plus approved role
  profiles. `/studio` and `/smart-creators` redirect to People so old links and
  search results keep working.
- **Rentals** is things. Studios and locations sit there as a coming-soon
  category.
- The offer door is called **Earn with ThabangVision** everywhere ("Offer your
  skills, your gear or your vehicle."). Copy that lists only "photographer,
  videographer, editor or sound person" becomes inclusive.

### "Comes with": people tied to things, kept simple

One rule: a listing can say what it comes with, and one booking is one price.
No general linking system.

- **Driver with vehicle** is one People offering: booking the driver books the
  car. The profile shows "Comes with: Toyota Quantum, 14 seats" with the
  vehicle photos.
- Same pattern: a photographer "comes with their own camera kit"; later, gear
  "with operator" (drone with pilot, lights with gaffer).
- Data: a small `comes_with` jsonb on `person_roles` (label plus optional
  evidence ids).
- **Self-drive vehicle hire** (no driver) would be a Rentals listing. Later,
  out of scope for the pilot.

### CV retention

The CV or voice-note original stays in the private bucket, readable by the
person and admins only, and is to be deleted after
`ROLES_POLICY.cvRetentionDays` (90 days). The existing daily job
(`/api/cron/daily-maintenance`, step 17b, `lib/roles/retention.ts`) deletes
those files and their evidence rows, plus CV and audio uploads that were
never filed (the person stopped on screen 2). Legal photos and faces are
never touched by it. It logs counts only, is idempotent, and does nothing
while `roles_v1` is off or before migration 091. Only the reviewed, PII-free
facts are kept and embedded.

**Reveal demo (DEV):** `scripts/roles/seed-demo-people.sql` keeps a confirmed
request between a demo client and the demo driver. Staff can open
`/people/requests/de300000-0000-4000-a000-000000000001` and see what the
client sees after confirmation.

## One person, one portfolio, one rate (owner, 2026-10-15)

- A profile groups its work into **albums** (`role_evidence.album`): one
  gallery with album tabs, the work shown large. Still blind: the label is
  role, area and code.
- A person can charge in **their own unit** (`person_roles.pricing_unit`),
  for example per day when the role's default is per hour. Cards and
  profiles show "R1 800 per day".
- **Booking like Rentals:** the client picks the day or days (or hours for an
  hourly person) and sees one total, rate x days or rate x hours, before
  sending. The server works the total out again; the browser's number is
  never trusted.
- The owner's three studio packages become **one photographer portfolio** at
  his day rate (`scripts/roles/owner-portfolio.sql`). A package whose work a
  profile holds (`source_production_id`) is no longer listed on People, and
  its old `/studio/<slug>` address redirects to the profile.

## Teams (later phase, after People is live and we have track records)

- **What:** once we have seen people's skills and delivery over time, the
  platform forms teams for big jobs: music videos, films, productions, big
  events.
- **Consent:** people decide. A member accepts or declines an invitation. A
  team lead (or the members) approves who joins. Nobody is put on a team
  without saying yes.
- **Equal chance stays:** approving and declining are blind too. Members see
  each other's work, roles and record, not faces or names, until the team is
  confirmed. A veto needs a work reason from a short list (availability, skill
  fit, past delivery), and patterns are watched so a team cannot shut people
  out unfairly.
- **How teams are suggested:** the per-profile embeddings plus team signals:
  which roles the job needs (coverage), each person's record, availability and
  distance, budget fit, and "worked well together" (co-bookings clients rated
  well, and members saying they would work together again). Whole teams are
  ranked, not individuals, with fair spots for newer people.
- **Stages:** (1) "My team": proven pros add the people they already work
  with. (2) Suggested team packages, for example a music-video crew. (3) Full
  production teams.
- **Pricing:** decided later. A starting idea: the members' rates plus a
  coordination fee, with the client seeing one price.
- **Data to start collecting now:** co-booking pairs, the client's rating per
  booking, and a private "would work with them again" after each shared job.

## Out of scope now

- Booking and paying for these roles, and the money flow behind the promise.
- Writing completed bookings into `role_evidence` automatically (the job count
  reads confirmed `booking` evidence; today only demo rows have it).
- The vouch flow for the person who vouches (today the person adds a name and
  number, and a reviewer calls).
- Email, WhatsApp or in-app notices on approval or send-back (the person sees
  the result when they open `/offer/<role>`).
- Using the job-size limit at checkout (the function exists and is tested; no
  booking flow calls it yet).
- Vehicles without a driver, ever.
- Search ranking and the sitemap for these pages.

## Demo data (dev only)

`scripts/roles/seed-demo.sql` adds 9 synthetic people across the 4 live roles,
from a brand-new make-up artist with only in-app proof to a trusted
photographer. Every name ends "(demo)", every email is
`roles-demo-N@example.com`, every row has `is_demo = true`, and every image is a
local SVG that says SAMPLE (`public/roles/demo/`). The script refuses to run
unless `roles_v1` is on. `scripts/roles/remove-demo.sql` removes all of it.

## Decisions for the owner

1. **Prices.** The suggested prices and bands in the catalogue table above are
   a first guess. Confirm or change them (they are rows in `roles`, no code
   change). Photographer and videographer share one role and one price today;
   split them if their prices differ too much.
2. **First roles.** Are these the right four? Is "photographer or
   videographer" one role or two?
3. **Guidelines wording.** Read the published guidelines on each
   `/offer/<role>` page ("What our team checks"). They are the standard people
   are judged against.
4. **Insurance for drivers.** Not required by law. Keep it as our rule, or drop
   it at launch?
5. **Models under 18.** The law allows child performers with a permit and a
   parent. We launch 18+ only. Keep it that way?
6. **Job-size limits and ladder numbers** (`ROLES_POLICY`). Founder approval
   needed, like the renter tiers.
7. **Who reviews, and how fast.** The page promises "usually within 2 working
   days".
