# TASK-058: Minimum booking lead time for equipment hire
## Priority: HIGH | Phase: V4 | Depends on: none
## Files allowed: lib/constants.ts, app/api/cart/checkout/route.ts, app/(platform)/book/BookingForm.tsx, app/(marketing)/legal/page.tsx, tests/unit/
## Description
Gear can currently be booked for tomorrow, or today. `validateDateRange` only
blocks past dates and caps at 30 days. The founder wants roughly two days'
notice so stock can be prepared and collected.

BLOCKED ON A DECISION, asked 2026-08-27 and not yet answered:
  1. Two calendar days, or 48 hours? Friday for Sunday 09:00 is two calendar
     days but about 44 hours.
  2. Gear only, or shoots as well? The ask was "especially for gear".

The booking form already defaults its date picker to tomorrow, so shoots have
one day of notice by accident, enforced only in the browser.
## Acceptance criteria
- [ ] `STUDIO.rental.minLeadTimeDays` (or Hours) in lib/constants.ts, single source
- [ ] Enforced server-side in validateDateRange so it cannot be bypassed
- [ ] The date picker minimum reads the SAME constant — never API-only, or the
      customer fills in the form and is refused at the end
- [ ] Stated in Terms, since it is a condition of hire
- [ ] Unit tests at the boundary: exactly at the limit, one short, one over
- [ ] npm run build passes, npm run test passes
