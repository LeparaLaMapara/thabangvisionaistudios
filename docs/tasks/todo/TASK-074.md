# TASK-074: Crew call: form teams and offer them to production companies
## Priority: MEDIUM (long term) | Added by the owner on 2026-10-13
## Files allowed: new lib/crew/*, app/crew/*, app/(admin)/admin/crew/*, a new migration
## See: docs/direction.md "What Market B needs instead: team assembly", TASK-046

## Why
Productions hire a team, not a person. The platform should return a crew that
is available, priced right and close, and let a production book it in one go.

## Signals for matching
- Skills and roles (gaffer, sound, focus puller, editor, colourist ...).
- Proven work: finished bookings, reviews, delivered on time.
- Who has worked well together before (repeat pairings).
- Distance to the shoot and travel cost.
- Availability calendar; owns gear (can bring kit).
- Rate inside the budget.

## Plan
1. Crew call form: what, when, where, budget, roles needed.
2. Match: rules first (role, free dates, distance, budget); rank by proven
   work and past pairings. A human (production or admin) confirms. No black box.
3. Each person accepts or declines their seat; open seats re-fill.
4. One booking, one payment, split payouts per person (uses existing payout
   path; no new money logic without owner approval).
5. Later: creators form standing teams themselves ("Studio X crew") with a
   shared profile.

## Fairness
Same anti-bias rule as direction.md: people come back because they fit, not
because the producer already had their number. Give new creators a fair share
of first offers.
