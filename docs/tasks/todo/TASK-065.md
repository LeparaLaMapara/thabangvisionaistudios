# TASK-065: Know when someone joins, and let Ubunye greet them
## Priority: HIGH | Phase: V5 | Depends on: the Supabase service-role key fixed on Vercel prod; TASK-066 (Google sign-in)
## Files allowed: lib/agents/, lib/email/, app/api/cron/, app/(admin)/admin/, supabase/migrations/
## Description
On 2026-09-27 the owner found 35 people had signed up (13 in one afternoon on
2026-09-26) without knowing it. None of them was ever contacted, and none got
past the signup screen (see "What signups did" below). Two things are missing:

1. **The owner hears about every signup.** A new account posts one short note
   to the owner (email and, later, WhatsApp): name, email, how they signed up
   (Google or email), and what they have done since (nothing, browsed, added to
   cart, started ID check). A daily digest covers the day if several join.
2. **Ubunye greets each new person, and the owner can see and edit it.** Within
   minutes of signing up, Ubunye drafts a short, personal welcome: who
   ThabangVision is, the two things they can do (hire gear, book a creator),
   the one next step for them (for gear: the ID check, and how long it takes),
   and a real person to reply to. The draft goes to an admin queue; the owner
   can send as is, edit, or let it send automatically after a set time
   (setting, default off until the owner trusts it). Later: a follow-up if they
   stop at a step (for example ID check started but not finished).

Design notes:
- Drafting goes through the AI gateway with its own policy (budget per day,
  no personal data beyond first name and what they did on the site).
- Every message sent is logged (who, when, text, sent by AI or owner) in an
  `outreach_messages` table; one welcome per person, never twice.
- Respect POPIA and `marketing_opt_in`: a welcome and service message is fine;
  anything promotional needs opt-in and an unsubscribe link.
- The signup trigger is a Supabase database webhook or an hourly cron over new
  `auth.users`; both write with the service role, which must work first.

## What signups did (checked 2026-09-27)
- 36 accounts since 2026-03-07; about 32 are real people (the rest are the
  owner's own and test accounts).
- Nobody except the owner has a name, phone or address on their profile,
  started onboarding, added to a cart, booked, or listed gear. One person
  (jezisese) used Ubunye (6 messages). One person was ID-verified (March); one
  ID check has sat in "pending" since 2026-03-15 and was never reviewed.
- 14 Google signups (every one since 2026-08-20) never got a session: Google sign-in completes at
  Google and the account is created, but the site never logs them in (TASK-066).
  Several then made an email account minutes later.
- There is no page analytics (Vercel Web Analytics is off and
  `platform_events` has never been written), so what people looked at after
  signing up is unknown.

## Acceptance criteria
- [ ] The owner gets a note within 5 minutes of any signup, with what the
      person has done so far
- [ ] Ubunye drafts one welcome per new person into an admin queue; owner can
      send, edit or discard; optional auto-send after N hours
- [ ] Every sent message is logged; nobody is welcomed twice
- [ ] The 32 existing people can be welcomed once, from the same queue
- [ ] Tests: one welcome per user, no send without opt-in rules, drafts never
      contain data beyond first name and site activity
