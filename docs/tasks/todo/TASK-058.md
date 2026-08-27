# TASK-058: Minimum booking lead time — SHOOTS OUTSTANDING
## Priority: MEDIUM | Phase: V4 | Depends on: none
## Files allowed: lib/constants.ts, lib/bookings/validate.ts, app/(platform)/book/BookingForm.tsx, app/(marketing)/legal/page.tsx, tests/unit/
## Description
GEAR IS DONE (2026-08-27). `STUDIO.rental.minLeadTimeHours = 48`, enforced in
the checkout API and in the date picker from the same module
(`lib/rental/leadTime.ts`), stated in Terms, 17 unit tests.

Answer given: 48 HOURS, not two calendar days. Because hires are booked by the
day, the rule compares against the START of the first hire day, so notice is
never below 48 and works out at two to three days depending on the hour of
booking.

STILL OPEN: does the same apply to production shoots? The question was asked as
two parts and only the first was answered. The original framing was "especially
for gear", so gear was treated as definite and shoots left alone.

Two things worth knowing when deciding:
  - The shoot booking form defaults its date picker to tomorrow, but that is
    enforced only in the browser. `lib/bookings/validate.ts` does not check the
    date at all, so any future date can be posted directly.
  - The existing shoot cancellation policy already treats 48 hours as the
    meaningful threshold ("full refund over 48 hours"), so 48 would be
    consistent with the policy already in the Terms.
## Acceptance criteria
- [ ] Decide whether shoots need notice, and how much
- [ ] If yes: a `STUDIO.booking.minLeadTimeHours` constant, enforced in
      lib/bookings/validate.ts (server) and read by the form's picker
- [ ] Regardless of the answer: close the browser-only hole, so the shoot form's
      minimum is enforced somewhere the customer cannot edit
- [ ] Terms updated if the rule changes
- [ ] Unit tests at the boundary
