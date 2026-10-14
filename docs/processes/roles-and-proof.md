# Many roles, honest proof

Status: first slice built on non-production (TASK-085, migration 090, flag `roles_v1`).
Owner decisions still open: see "Decisions for the owner" at the end.

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

- `/join`: "What do you do?" Role cards from the database. Coming-soon roles
  take a phone number (`role_interest`).
- `/join/[role]`: signed out, it explains the steps and the published
  guidelines, then "Start" (sign in). Signed in, the profile maker:
  about you, what the law needs (only where it applies), one screen per proof
  step, price, send for review.
- `/people/[id]`: the public profile (approved only).
- `/people`: every approved profile, filter by role.
- `/admin/roles`: the review queue. The proof sits next to that role's
  published guidelines. Approve, or ask for changes with a required note.
  Approving needs the ID check done, every applicable legal document in hand
  and the age rule met; it marks those documents and the in-app proof checked
  and works out the level.

The nav entry "Join" shows only when the `roles_v1` flag is on. The pages are
reachable by URL either way, and are `noindex` during the trial.

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

1. **Now (this slice, dev only):** catalogue, profile maker, review queue,
   public profile, demo data. Flag on in dev, absent in production.
2. **Owner review:** the owner walks the demo, decides prices, first roles and
   guidelines wording. A few real people from the network try the maker on
   dev.
3. **Production soft launch:** apply 090 to production, keep `roles_v1` off,
   invite people by link to `/join/<role>`, review them, then switch the flag
   on.
4. **Booking:** connect these profiles to the booking and payment flow (held
   payment, release on delivery, replacement or refund), count completed jobs
   into the ladder automatically, notify people when they are approved or sent
   back.
5. **More roles:** open coming-soon roles one at a time, where "leave your
   number" shows demand.

## Out of scope now

- Booking and paying for these roles, and the money flow behind the promise.
- Writing completed bookings into `role_evidence` automatically (the job count
  reads confirmed `booking` evidence; today only demo rows have it).
- The vouch flow for the person who vouches (today the person adds a name and
  number, and a reviewer calls).
- Email, WhatsApp or in-app notices on approval or send-back (the person sees
  the result when they open `/join/<role>`).
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
   `/join/<role>` page ("What our team checks"). They are the standard people
   are judged against.
4. **Insurance for drivers.** Not required by law. Keep it as our rule, or drop
   it at launch?
5. **Models under 18.** The law allows child performers with a permit and a
   parent. We launch 18+ only. Keep it that way?
6. **Job-size limits and ladder numbers** (`ROLES_POLICY`). Founder approval
   needed, like the renter tiers.
7. **Who reviews, and how fast.** The page promises "usually within 2 working
   days".
