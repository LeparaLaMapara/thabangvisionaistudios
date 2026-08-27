# THABANGVISION DIRECTION — What we are building toward

**Status: direction, not committed roadmap.** This records where the company is
going and why, in the founder's framing. `docs/strategy.md` covers the platform
and its autonomy roadmap. This document covers what the company becomes. Where
something here is a proposal rather than a decision, it says so.

Captured 2026-08-27 from a founder briefing.

---

## The first principle

> "Your work should speak for you. That's how you get in. Not because I know
> you, not because you're black, not because you're a certain person."

South Africa's creative industry runs on who you know. You get the job because
someone vouched for you, because you were in the WhatsApp group, because your
face fit. Talent that is not already connected does not get seen.

The platform exists to break that. The mechanism is simple and it is the whole
point: **the work is the application.** No CV screen, no interview, no
introduction, no knowing anybody. You put up what you have made, a client sees
it, they book you.

That is not a feature. It is the reason the thing exists, and every design
decision should be checked against it. If a change makes it more likely that
someone gets hired because of who they know, it is wrong, however good it looks.

This is why the platform must never require a social handle to be taken
seriously, and why the ranking of creators has to answer to the work rather
than to seniority, follower count, or how long someone has been on the platform.

---

## Two tracks

The business has two halves and they scale in completely different directions.
Treating them as one thing is what causes confusion.

```
TRACK 1 — GEAR      rent it  →  own it  →  build it
TRACK 2 — PEOPLE    show it  →  sell it  →  assemble it
```

---

## Track 1 — Gear: rent it, own it, build it

Today ThabangVision rents equipment. That is the beginning, not the business.

The direction is vertical integration, from first principles, all the way down
to manufacturing:

```
NOW        Rent gear we own, plus community-owned stock
NEXT       Own more of what we rent. Understand demand from real data.
THEN       Build the software: the algorithms, the pipelines, the tooling
LATER      Build the hardware: sensors, cameras, lenses
GOAL       The whole stack. Hardware and software. Cheap, and efficient.
```

The founder's words: *"the everything of everything."*

Why this is coherent rather than grandiose:

- **Renting teaches you what to build.** Every booking is a signal about what
  professionals in this market actually need, what breaks, what they cannot
  afford, and what they keep asking for and cannot get. No manufacturer in the
  northern hemisphere has that data for South Africa.
- **The constraint is the product.** The gap in this market is not more
  expensive gear. It is capable gear at a price a South African crew can
  actually reach. "Cheap and efficient" is the specification, not a compromise.
- **The software is the wedge.** Sensors and optics are hard and capital
  hungry. Algorithms, firmware and pipelines are not, and they are where most
  of the perceived quality of modern cameras now comes from.

`docs/strategy.md` currently lists gear manufacturers as partners to sponsor
recommendations and license a demand index to. That is a near-term revenue idea
and it is fine. It should not be mistaken for the destination. The destination
is to be one of them.

---

## Track 2 — People: the two markets nobody separates

This is the insight that unlocks the crew problem, and it came out of a real
event: **a sound engineer wrote in asking how to onboard, and the platform had
nowhere to put him.**

The realisation is that "creative talent" is not one market. It is two, and they
need different surfaces.

### Market A — Work that sells as a product

Photos. Video. Sound. Art.

An ordinary person, with no industry knowledge, understands these. They can look
at a photograph and decide they want one. The work *is* the thing being bought.
You can put it on a page with a price and someone will buy it, the same way they
buy a rental.

> "They know photos. They know videos. They know sound. Those are the three
> things that make sense to them."

This is what the Studio page is for, and it is why the Studio page should look
like a shop: items, prices, scroll, choose. It was rebuilt on 2026-08-27 to work
exactly that way.

### Market B — Specialist skill that sells into a production

Gaffers. Sound engineers. Grips. Focus pullers. Colourists. Editors. ADs.

Nobody wakes up wanting to buy a gaffer. A gaffer is needed at a specific moment
in a specific kind of project: someone is shooting a film and needs a crew. It
is a specialised skill sold into a specialised phase.

> "That's when you have those type of things. Like, maybe people are shooting a
> movie."

The buyer is different (a production company, not a consumer), the moment is
different (pre-production, not impulse), and the unit is different (a team, not
an item).

**So the answer to "how do specialists surface their work" is that they should
not be listed as products at all.** Putting a sound engineer on a grid of
photographs will always fail, because the grid is asking a question he cannot
answer.

### What Market B needs instead: team assembly

> "Production companies can come and build the team of people."

The surface for specialists is not a shop, it is a **crew call**. A production
says what it is making, when, where and at what budget, and gets back a team it
can book in one go.

```
PRODUCTION SAYS          Music video, 2 days, Johannesburg, March 12-13
                         Budget R Y

PLATFORM RETURNS         A crew, not a catalogue:
                           Gaffer          available, N years, credits
                           Sound recordist available, owns kit
                           Focus puller    available
                           Grip            available

                         Book the team. One booking, one payment.
```

The anti-bias principle carries straight over. The crew comes back because the
people in it are available, priced right and have the credits, not because the
producer already had their number.

---

## The specialist gap, concretely

Proposal, not yet decided. Recorded because the problem is real and verified in
the code.

Today a creator's portfolio is exactly this:

```ts
PortfolioProject {
  title
  project_type
  photos: PortfolioPhoto[]
  video: PortfolioVideo | null
}
```

Photos and a video. **There is no field for what you did.** No role, no credit,
no contribution.

That is fine for a photographer, whose work is the artefact. It fails for
everyone in Market B, because a gaffer's work lives *inside someone else's
film*. Their output is not a thing they can hand over. It is a quality of a
thing somebody else owns.

What this caused: `createCreatorProduction()` builds a listing by collecting
every photo from every portfolio project and taking the first as the thumbnail.
A sound engineer has no photos, so he gets `thumbnail_url: null`. Until
2026-08-27 the Studio card returned `null` when there was no image, so **he
would have signed up, been approved, and silently not appeared on the page.**
That specific hole is now closed (a placeholder renders instead), but the
underlying model is unchanged.

Three changes would fix it properly:

1. **Credits as a first-class record**, alongside portfolio projects:
   production title, year, format, *my role*, who it was for, and an optional
   link or still. One structure covers every Market B discipline. It is also
   how the industry already works, so it needs no explaining.
2. **Proof that does not have to be visual.** Audio reels that play inline. A
   lighting plot. A link. Cards must stop requiring a thumbnail.
3. **A role taxonomy separate from shoot types.** The six production categories
   are all *kinds of shoot*. None of them is a job. A sound engineer needs to be
   findable as a sound engineer, not filed under "Video Production".

### The differentiator hiding in this

Technical crew usually own kit. A sound engineer arrives with their own mixer
and microphones.

ThabangVision already runs a rentals marketplace that supports community-owned
stock. So a specialist could list **themselves and their kit as one bookable
unit**: "book this person, with this sound package, per day."

Nothing else in this market appears to do crew-plus-their-gear as a single
booking, and most of the infrastructure for it already exists on the rentals
side. This is the point where Track 1 and Track 2 stop being separate businesses.

---

## Honest current state

Checked against production on 2026-08-27, so this does not drift into wishful
thinking:

```
Gear             25 live listings, all photographed, R20 to R4 500 per day
Studio           3 published projects, all photography
Crew             13 accounts, 0 with any specialisation filled,
                 1 crew-listed profile and it is the founder's
```

The crew side has **no users yet**. The sound engineer who wrote in would be the
first.

**This is why none of the Market B work should be built yet.** Building a
credits system, a role taxonomy and audio uploads for a feature with zero users
is three weeks of guessing.

The next action is not code. It is to onboard that sound engineer by hand, ask
him to send whatever he would normally send a producer who asks "what have you
done?", and let the shape of what arrives define the schema.

---

---

## The engine: what turns a marketplace into one

A marketplace forgets. An engine remembers.

That is the whole difference, and it is the thread running through everything
below. Every transaction on the platform today happens and then evaporates. An
engine turns each one into a record, and records into capability. If the aim is
to end up manufacturing, this is how the right to do that gets earned: not by
deciding to build a camera, but by being the only people who know what South
African productions actually need and what actually breaks here.

Seven things. Ordered by what compounds soonest, not by what is most exciting.

### 1. Record the demand you cannot serve — BUILT 2026-08-27

The platform had perfect data on what it sold and none on what it could not.
Someone searched for a drone on the 12th, it was booked, they left, nothing was
written down.

The unsold half is the more valuable one. It is the list of what to buy next,
which dates are worth more, what to train people for, and eventually what is
worth building. Three signals are now captured: a search that returns nothing, a
checkout refused on availability, and gear asked for that is not carried.

Written best-effort and never awaited, because research must never be able to
fail a checkout.

### 2. Utilisation, per item — CHECKPOINT: 30 completed bookings

What fraction of days each item earns. Tells you what to buy more of, what to
sell, what is mispriced, and at the far end what people actually use rather than
what they say they want. It is a query, not a project, and it is meaningless
before there are enough bookings for a rate to mean anything.

### 3. Make "a production" a real object — the keystone

Bookings today are per item. A shoot is not items, it is a container: dates,
location, crew, gear, budget, deliverables.

Make it first-class and four things fall out at once. Gear and crew bookings
hang off the same object, so team assembly stops being a separate feature. The
platform learns what a real shoot in South Africa costs. Ubunye stops answering
questions and starts planning shoots. And self-funded work uses the same object
as client work.

Most of the rest of this list gets easier once it exists.

### 4. Train people rather than waiting for them — CHECKPOINT: crew arrive first

The platform asks "are you real?" and never asks "are you getting better?" An
engine has a ladder: apprentice, assistant, operator. Finish a module, unlock
cheaper gear. Do three assisted jobs, get listed.

This solves the cold-start problem from the other end. You do not wait for
experienced crew to appear, you make them. It is also the most literal form of
the first principle, because the ladder is climbed by doing rather than by
knowing somebody.

### 5. Shoot your own things

Every production on the platform is client work. Add a slot where ThabangVision
is the client. Idle gear gets used, new crew get a first credit, and output
becomes a library the company owns rather than a service delivered and
forgotten. "We shoot our own movies" has to be something the system supports,
not something done on the side.

### 6. Keep the failure data — it is engineering data — CHECKPOINT: 50 inspections

The return and inspection pipeline already records condition, photos and damage.
Today that is deposit-dispute evidence. It is also the start of a reliability
database: what breaks, how often, under dust, heat, bad roads and load-shedding.

A decade of that on real African shoots is something no manufacturer elsewhere
has, and it is the honest answer to "why would you be able to build a camera?"
Because you would know what fails here and they would not. It costs nothing
extra; it is already being collected and thrown away.

### 7. Power as a first-class constraint

Load-shedding is a real planning input for every South African shoot and no
international tool models it. A production planner that knows about power is
hard to copy from outside the country.

---

## Checkpoints: the roadmap the platform watches for itself

A plan in a document is a plan somebody has to remember to re-read. Every
capability above is obviously right eventually and obviously wrong now, and the
only thing separating those two states is a number nobody is watching.

So the condition lives beside the capability in code
(`lib/growth/checkpoints.ts`), and the invariants cron checks the platform's own
numbers against it. Filters on Studio are not "later", they are "at fifteen
projects across three types". Team assembly is not "phase two", it is "when
eight crew have filled in a specialisation".

| Capability | Fires at |
|---|---|
| Studio filters by type | 15+ projects across 3+ types |
| Wire up global search | 40+ listings, or 25+ distinct unmet searches |
| Credits and non-visual portfolios | 5+ crew with a specialisation |
| Crew calls / team assembly | 8+ crew with a specialisation |
| Owner joins go live | first community-owned listing |
| Utilisation reporting | 30+ completed bookings |
| Reliability database | 50+ inspected returns |

Two levels, deliberately separate. A capability that is purely additive and
cannot break what exists may flip its own flag. Anything that changes how the
platform charges, contracts or presents itself is a decision, and the checkpoint
only says it is time.

**Nothing auto-activates today, and that is the honest answer rather than an
oversight.** Every gated capability on the list changes how the platform
presents itself, so every one of them wants a human. The mechanism exists for
the first one that genuinely does not.

Crossing a line is news; being past it is not. Findings de-duplicate by
fingerprint through the existing `ops_findings` table, so a checkpoint announces
itself once.

Verified against production on the day it was built: at 25 listings, 3
projects, 1 type, 0 crew, 0 community listings and 0 completed bookings,
**nothing fires**. A test asserts exactly that, so a threshold accidentally set
below where the platform already stands fails the build rather than sending a
false alarm.

## What we are deliberately not doing yet

- Building credits, role taxonomy or audio portfolios. No users yet. See above.
- Filters on Studio. Three projects, all one type. A filter would have one
  option in it.
- Categories as the way into Studio. Removed 2026-08-27: five of the six were
  empty.
- Any manufacturing work. That is a destination, not a backlog item. What
  serves it today is renting gear and paying attention to what the data says.

---

## Open questions

- What is the smallest thing that makes a production company try the platform
  once? A single crew call would be worth more than any amount of profile
  tooling.
- Does the 15% commission model survive team bookings, where the platform is
  assembling four people rather than passing on one?
- At what point does owning stock beat brokering it? The rental data should
  answer this, and it is worth deciding in advance what number would trigger it.
- Which comes first on the hardware path: software that improves gear that
  already exists, or hardware of our own? The first is cheaper and reversible.

---

## See also

- `docs/strategy.md` — the platform, revenue model, and autonomy roadmap
- `docs/architecture.md` — how the system is built today
