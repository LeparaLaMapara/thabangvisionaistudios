# TASK-069: Book a photographer: phone-code account, paid on delivery, shown as a timeline
## Priority: HIGH | Phase: V5 | Depends on: none
## Files allowed: app/(platform)/studio/, app/(platform)/book/, app/api/service-bookings/, components/booking/, lib/constants.ts
## Description
The client picks a package (fixed price, what is included, turnaround), a date
and a place, enters a phone number and a one-time code (that is the account; no
password), and pays. ThabangVision holds the money (merchant of record). Both
sides see one timeline: Booked, Arrived (creator taps "I'm here"), Delivered
(gallery uploaded through ThabangVision), Approved (client taps "Looks good" or
"Something's wrong"; auto-approves after the existing 7-day window), Paid
(creator payout) and Review. A dispute window with a person stepping in, and
refunds by published rules. The studio "Book this package" button opens this
form carrying the package and price; the AI is a helper, not the only door.

## Acceptance criteria
- [ ] Studio package button opens a real form with the package and its price
- [ ] Phone OTP (or Google) at the confirmation step, returning to the booking
- [ ] Timeline visible to client and creator; creator "I'm here" and delivery upload
- [ ] Payout only after approval or the auto-approve window
