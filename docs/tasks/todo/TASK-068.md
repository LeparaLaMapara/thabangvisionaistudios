# TASK-068: ID check at the moment of booking: ID photo + selfie, honest wait time
## Priority: HIGH | Phase: V5 | Depends on: none
## Files allowed: app/(platform)/dashboard/verification/, app/(platform)/rentals/, components/booking/, app/api/verification*, lib/constants.ts, lib/legal/
## Description
Today renting needs a Commissioner-of-Oaths certified ID copy and a manual
approval before a person can even see dates, while the site says verification
is "instant". Change it to: dates and price visible to everyone; the ID check
happens only when a first-time renter books above nothing/limit; it asks for an
ID photo and a selfie (no certified copy); a four-line privacy card first (what
we collect, why, who sees it, how long we keep it); an honest review time
("Checked within 2 working hours, 08:00 to 18:00"); the dates are held while the
check runs and the person returns to the same booking. Later: a liveness/face
match vendor (for example Smile ID) to make it automatic.

## Acceptance criteria
- [ ] No certified-copy requirement anywhere
- [ ] Gear dates and price visible signed out and unverified
- [ ] Verification starts from the booking and returns to it
- [ ] "instant" removed; the stated time comes from one setting
