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

## Done 2026-09-28
- One timeline for client and creator (lib/bookings/timeline.ts, components/booking/ShootTimeline.tsx):
  Booked, Paid, Creator confirmed, Arrived, Delivered, Approved, Creator paid, Reviewed. "Arrived"
  is never shown done unless the creator checked in.
- Creator "I'm here" (POST /api/service-bookings/[id]/arrived, bookings.arrived_at, migration 063);
  the client is told. Delivery now also tells the client (they have 7 days to approve).
- Phone checks: lib/sms (SMS_PROVIDER=smsgate uses the open-source SMS Gateway for Android;
  "log" otherwise), /api/phone/send + /verify, hashed codes in phone_codes, profiles.phone_verified_at
  guarded by a trigger so users cannot set it. "Confirm this number by SMS" on the profile page.
- Already in place: studio package button opens /book with the package and price (PR #28);
  payout only after approval or the 7 day window (payoutBlocker).
- Not done: phone code as the way to sign in (Supabase phone auth needs its SMS hook configured);
  asking for the phone at the booking confirmation step; creator declining a paid booking.
