# Journey review (Phase 5)

Each journey: the ideal experience in the customer's words, what actually
happens today, the gaps ranked by customer impact, and what changed versus
what needs a founder decision. Principles: [principles.md](principles.md).

**How it was measured (2026-10-10).** The local stack (local Supabase, the
Paystack/Nominatim/Cloudinary stub, a production build on :3000), walked in
Chromium as each customer type, desktop and 393 px, before and after the
changes. Step counts are taps or typed fields a person makes; waits are the
ones the product imposes. Screenshots and the per-page log were kept in the
session scratchpad, not in the repo. The local journeys (`tests/e2e-local`)
were extended where a flow changed.

Ranking: **H** stops the customer or misleads them about money or custody;
**M** makes them hunt, guess or contact us; **L** friction or wording.

---

## 1. First-time renter

> "I found a camera, picked my dates, did the ID check once, paid, and knew
> exactly where and when to collect it and what to bring."

**Today (measured).**
- Sign up: 6 actions (email, Continue, code, Continue, "I agree", "Rent camera
  gear"), lands on /rentals.
- Gear page: shows price, deposit and total with deposit, the 48-hour notice,
  first hire collected in person, and the checklist of what is missing
  (phone, ID). 1 action ("Save to cart for later") once dates are chosen.
- Before paying: confirm phone by SMS (number + code), ID check (ID photo +
  selfie, then a person approves it, "usually within one working day"),
  plus a bank account in your own name if the gear is over the starting
  R2 000 limit (shown on the gear page and in the cart checklist).
- Cart: 3 fields (notes, Terms tick, payment plan where offered), collection
  point and hours shown, total R1 000 for R600 hire + R400 deposit; 1 action
  "Checkout, R1 000"; pay on the provider's page; back to My Rentals with
  "Payment confirmed. What happens next: collect at 99 Smith Street,
  Braamfontein (hours), bring the ID you verified with".
- Messages: "Payment received: R1 000" and "Booking confirmed".

**Gaps (ranked).**
1. **H** The booking page said **"Payment history: No payments"** on a paid
   R1 000 booking (the list was hard-coded empty).
2. **H** The checkout page promised "a message with the collection details";
   the confirmation said only "Bring your ID when you collect".
3. **M** The booking page had no "what happens next"; it showed dates and a
   "Total charged" computed in the browser (no delivery fee, shown even when
   nothing had been charged).
4. **M** The bookings list said "ZAR 600" (the hire only, while R1 000 was
   charged), "Booking #2d0c157a" instead of the item, and raw statuses.
5. **L** The deposit was explained before payment only as "refundable and
   carry no VAT"; how and when it comes back was on /refunds.

**Changed.**
- Payments and refunds on the booking page, from the payment intent, payment
  lines and refund obligations (`lib/rental/money-view.ts`): "Paid on
  10 Oct 2026 R1 000 · Hire R600 · Refundable deposit R400", the deposit
  explained (held until back and inspected, then refunded less any published
  deduction, link to /refunds), "your payment confirmation email is your
  receipt". Never "refunded" before the provider processed it.
- What happens next for every status (`lib/rental/next-step.ts`): "Collect on
  Monday, 19 October · 99 Smith Street, Braamfontein, Johannesburg (hours) ·
  bring the ID you verified with · reminder on the morning of collection".
- Booking confirmed and the collection-day reminder now carry the collection
  point and hours.
- The list names the item, labels the amount "Hire", uses the same status
  words as the booking page.

**Founder decisions.** D-76 (the return cut-off: the counter closes at 18:00
but the policy says "by the end of the end date").

## 2. Returning renter

> "I booked again in a minute, and when my plans changed I cancelled and
> could see my refund on its way."

**Today (measured).** Trusted renter: gear page → "Add to cart" → cart (Terms
already accepted, so 0 ticks) → Checkout → pay: 3 actions plus the provider
page. Delivery opens after the first clean return. Cancel: 1 tap, then a
browser dialog with the exact refund ("Hire refunded R300, Deposit refunded
R400, Total back to you R700"), 1 tap.

**Gaps (ranked).**
1. **H** After cancelling, the page showed **no refund and no message**: the
   server returned "Your booking is cancelled and the refund has been sent to
   the payment provider", and the page threw it away. A refused cancellation
   (gear on its way, booking changed) also failed silently.
2. **M** After a cancellation the card still said "Total charged R700" with
   nothing about the money coming back.

**Changed.** The server's answer is shown as a status message, then the
booking is re-read: "Cancellation refund R700 · Sent to the payment provider.
Banks usually take a few working days." Refusals show the server's reason.
Journey B now checks both.

**Not changed (works).** The pre-cancel dialog already prices the refund on
the server and states the rule.

## 3. Gear owner listing gear

> "I photographed my lens, it went live after a check, and I can see when it
> is hired and when I get paid."

**Today (measured).** "List my gear" at sign-up → Listings: what going live
needs is stated plainly (ID check, validated payout account, review of the
first listings), drafts allowed before the ID check; photo first, AI fallback
when unavailable, submit for review. After a hire: in-app "Earnings scheduled:
R240 ... after the hire is closed" and "Earnings paid".

**Gaps (ranked).**
1. **H** An owner could not see that their gear was hired, by when it is due
   back, or when the payout is due, only a payout notice after the fact. The
   dashboard said "0 bookings".
2. **M** "Earnings scheduled ... after the hire is closed" gave no date and did
   not say a person approves each payout (auto-approval is off, D-19/D-24).
3. **L** The dashboard called every verified account "a verified creator".

**Changed.** Hires and earnings on Listings (`GET /api/listings/earnings`,
`lib/rental/owner-earnings.ts`): each hire's dates, stage, the owner's share,
and the payout in plain words ("Scheduled from 12 Oct, after a final check by
our team", "Approved and being sent to your bank", "Paid on 10 Oct 2026. When
it shows in your account depends on your bank", "On hold: a person on our
team is looking into it"). Nothing about the renter. Dashboard copy no longer
equates an ID check with being a creator.

**Founder decisions.** D-72 (tell owners proactively when their gear is
booked: a new notice).

## 4. Creator offering services

> "I showed my work, got verified, accepted shoots, delivered, and was paid on
> a date I knew."

**Today (measured).** Onboarding without AI works by hand (photos, skills,
bio). Gigs list: accept/decline with consequences stated ("the client is
refunded in full"), "I'm here", deliver with a link, earnings per gig, payout
72 hours after approval.

**Gaps (ranked).**
1. **M** The timeline's current step said what had **not** happened as if it
   had: a new gig read "Next: Creator confirmed. You accepted the booking."
2. **L** The approval window was written as "7 days" in code instead of from
   constants.

**Changed.** The current step now says what is awaited and who acts ("Accept
or decline this booking. If you decline, the client is refunded in full.";
"Your payout is sent 72 hours after approval, as long as no problem has been
raised"), days and hours from `STUDIO.booking`.

## 5. Client booking a creator

> "I chose a photographer, saw the price, paid, knew they had accepted, got my
> photos, asked for one change, approved, and could raise a problem if
> something was wrong."

**Today (measured).** From a creator's "Book": /book form with 5 fields
(type of shoot, hours, date, place, what you need back), confirmation page with
the revision and approval rules and the cancellation policy, pay.

**Gaps (ranked).**
1. **H** After delivery the client had **one button, "Approve delivery"**. The
   booking promised "approve, ask for a revision or raise a problem" and the
   server supported all three; the only offered action pays the creator.
2. **H** The form quoted **"R0/hr × 1hrs, Total R0, Continue, R0"** when a
   creator was pre-selected, and would have quoted the creator's profile rate
   while the server charges the shoot-type rate.
3. **M** The confirmation page said "Creator: We confirm who will shoot it with
   you" to a client who had just chosen one (the client's session cannot read
   another person's profile row); the bookings list showed no creator either.
4. **M** "Next: Creator confirmed. Your creator has accepted the date." while
   the booking was still waiting for the creator.
5. **M** Approve, cancel and reviews failed silently; cancelling gave no rule
   before and no refund outcome after.

**Changed.**
- After delivery: "Approve the work", "Ask for changes (1 left)" (with a box
  for what to change) and "Report a problem", from the server's own rules
  (`lib/bookings/client-actions.ts`); report stays available until the payout
  is due.
- One rate function for the form and the server (`lib/bookings/rates.ts`);
  no price until a type is chosen ("Choose the type of shoot to see the price").
- The creator's public card on /book and the bookings list.
- Honest current step ("Waiting for your creator to accept the date. If they
  cannot take it, you are refunded in full and offered another creator.").
- Every action shows the outcome or the server's reason; cancelling shows the
  policy first and the refund outcome after.

**Founder decisions.** D-69 (creator profile rate vs shoot-type rate),
D-71 (pay link for an unpaid shoot booking), D-75 (a client email when they
cancel).

## 6. Delivery and return

> "My gear arrived when they said, I confirmed it, and the return pickup was
> one tap."

**Today (measured, journey E).** Address checked before quoting (Cape Town
outside the area, unknown addresses refused), delivery fee in the charge,
verified status per leg, "Received" or "Report a problem" per item, return
pickup priced and requested from the booking.

**Gaps (ranked).**
1. **H** A delivered order got the 07:45 **"Your gear is ready for collection
   today"** reminder (the reminder job ignored the fulfilment method), and its
   confirmation talked about collecting.
2. **M** Staff could not record one whole delivery (see journey 10).

**Changed.** Collection reminders skip delivered orders; their confirmation
talks about the delivery. The booking page's next step for a delivery never
sends the renter to the counter.

## 7. Refunds and cancellations

> "I can see what I will get back before I cancel, and then see it arrive."

**Today.** Gear: priced by the server before confirming (cooling-off,
48 h/24 h tiers), one refund obligation, never more than charged (journey B).
Shoots: policy text on the confirmation page.

**Gaps (ranked).** 1. **H** Refunds were invisible after cancelling (journey 2).
2. **M** A shoot cancellation showed no outcome. 3. **L** Refund words differed
between the server message and the notices.

**Changed.** Refunds listed with their stage in the notices' words; the shoot
cancel outcome is shown. Deposit settlement refunds appear the same way
("Deposit returned").

## 8. Payouts

> "I know when my money is sent and why it is held, without asking."

**Today.** Creators: payout 72 h after approval, notices on approval and on
sending. Owners: notices only (journey 3).

**Changed.** Owner payouts visible per hire with the reason class when held.
The creator's timeline states the payout timing from constants.

**Not changed.** Payout approval stays manual (D-19/D-24).

## 9. Support: when things go wrong

> "When something broke I told them from the booking in a minute, and I knew a
> person would look at it."

**Today (measured).** The gear booking page's "Report Issue" form sent
`booking_id`, `description` and types such as "damage"; the API requires
`equipment_booking_id`, `reason` and one of its six types. **Every report from
that page was refused (400)**, and the form only appeared for "on hire" and
"completed". Shoot clients had no report button at all. An empty Disputes page
said only "You have no disputes in this category".

**Changed.** One "Report a problem" dialog for hires and shoots
(`components/disputes/ReportProblemDialog.tsx`, `lib/disputes/report.ts`):
three plain choices, one box with its minimum stated, the API's fields and
types, available from on hire to completed (as the API allows). After sending:
"We have your report. A person on our team looks at every report. Follow it and
add detail under Disputes; we email you when it is resolved." A duplicate is
pointed to the open report. An empty Disputes page says how to report and links
to the bookings. Ubunye: a failed reply no longer uses up a guest's free
message (before: "4 free messages left" after one failed reply) or a signed-in
person's daily message.

**Founder decisions.** D-70 (a response time for reports).

## 10. Staff operations

> "I can run the morning's deliveries and returns without fighting the tool."

**Today (measured).** One manual delivery is: dispatch, reveal pickup and
drop-off, driver assigned, on the way, at the door, handover with photos:
about 7 actions. All counted against the 5-a-minute `sensitive` admin limit
shared with payouts, suspensions and refunds, so staff were stopped halfway
through one delivery (the local journey cleared the limit between taps to
pass).

**Changed.** Progress records (driver states, collection, handover,
inspection, incidents, reschedules, quotes, address reveals) count against the
everyday 30-a-minute limit; money, courier bookings, liability and batch runs
keep the strict limit; unknown actions are strict
(`lib/delivery/staff-rate-tier.ts`). The local journey no longer clears it.

---

## What was deliberately not changed

- **Visual design.** No restyling; only behaviour, copy, states and 44 px
  targets on the buttons touched.
- **Money and policy.** No price, fee, deposit, refund or payout rule changed.
  The pages now show what the existing rules and records say.
- **The shoot-type rates** stay where they were (moved unchanged into a pure
  module); which rate is right is D-69.
- **The ID check** (phone + ID + a person's review) stays before the first
  hire: it is the trust model (C-5, trust tiers), not friction to remove.
- **A pay link for unpaid shoot bookings** (D-71) and **new notice kinds**
  (owner hire booked, client cancellation email; D-72, D-75): new messages
  need a decision on what we commit to send.
- **WhatsApp** stays inactive (`lib/whatsapp`); no channel was switched on.
