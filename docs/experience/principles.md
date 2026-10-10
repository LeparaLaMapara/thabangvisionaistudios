# Customer principles

How ThabangVision designs for the people who use it. Start from what the
customer experiences and work back to the technology. These are operating
rules for anyone changing a page, a message, an API answer or an ops tool.

Our customers: renters (first time and returning), gear owners, creators
offering services, clients booking a creator, and our own staff, who use the
admin tools.

The journey-by-journey review is in [journey-review.md](journey-review.md).

---

## 1. Start with the customer's sentence

Before building or changing a flow, write in one line what the customer would
say if it went perfectly ("I picked dates, paid, and knew exactly where to
collect"). Then build back from that line.

**What this means here:** every journey in `journey-review.md` opens with that
sentence. A change that does not move a journey closer to its sentence waits.

**We will not:** start from a table, an endpoint or a provider's feature and
then look for a customer to give it to.

## 2. Always say what happens next

After every step that involves money or custody (pay, cancel, hand over,
return, refund, payout, report a problem), the customer sees what happens
next, who acts, when, and whether they need to do anything. Often the answer
is "nothing: we will tell you".

**What this means here:** the gear booking page has a "What happens next" box
for every status (`lib/rental/next-step.ts`). The shoot timeline's current
step says what we are waiting for (`lib/bookings/timeline.ts`, `next`). The
answer the server already writes after a cancellation is shown, not dropped.

**We will not:** leave a customer on a page that only says "pending", or show
a step as done before it has happened ("your creator has accepted" while we
are still waiting for them).

## 3. One truth, one set of words

A status reads the same on the list, the booking page, the email, the in-app
notice and Ubunye. Money comes from the records that hold it, not from what a
page assumes.

**What this means here:** gear status words live in
`lib/rental/status-words.ts`, refund stages in `lib/rental/money-view.ts`,
using the same words as the notices in `lib/rental/notify.ts` ("sent to the
payment provider", "refunded by the payment provider", "a person on our team
is completing it").

**We will not:** show "No payments" on a paid booking, raw codes such as
`return_pending`, or "refunded" before the payment provider has processed the
refund.

## 4. Every problem has a next step, and never blame

When something goes wrong, the customer sees what happened in plain words,
that nothing was lost (when that is true), and one thing they can do: try
again, report it, or wait for a named person. Failures are ours to explain.

**What this means here:** "Report a problem" works from every gear booking
that is on hire or later and from every shoot that can still be disputed. A
failed refund says a person is completing it. A failed Ubunye reply puts the
text back and does not use up a free message.

**We will not:** fail silently (`catch {}` with no message), end a flow on a
dead end, or word an error as the customer's fault.

## 5. Decide less: opinionated defaults

Ask for a field only when we cannot know the answer. Prefill what we know;
pick the sensible default; offer one obvious next action.

**What this means here:** dates travel in the URL from the gear page to the
cart; the Terms box shows only until accepted once; the problem report has
three plain choices and one box; the booking form shows no price until a shoot
type is chosen instead of quoting R0.

**We will not:** add a field, a choice or a confirmation that does not change
what happens, or ask twice for something we already hold.

## 6. Never promise what we cannot guarantee

Prices, fees, deposits, holds, payout timing and refund timing come from
constants or the database, and say only what we control: when WE send money,
never when the bank shows it.

**What this means here:** amounts come from `STUDIO`, `RENTAL_POLICY` and the
payment records; the collection point and hours from `STUDIO.fulfilment` and
`STUDIO.hours`. Deposits are explained before payment and on the booking:
held until the gear is back and inspected, then refunded less any published
deduction.

**We will not:** invent insurance, delivery times, response times, ratings,
packages or guarantees. A promise the business has not made is recorded as a
founder decision instead of written into copy.

## 7. Tell people before they have to look

The customer should not have to hunt in a dashboard to learn that something
changed. Messages carry the facts the page promised.

**What this means here:** the booking confirmation and the collection-day
reminder carry the collection point and hours (the checkout page promises
"a message with the collection details"). A delivered order is never told its
gear is "ready for collection". Owners see each hire of their gear and when
its payout is due.

**We will not:** send a message that only says "something happened, log in to
see", or a message whose facts contradict the page.

## 8. The customer pays the price they were shown

The price on the page that asks for money is the price charged, worked out by
the same function on both sides.

**What this means here:** the shoot booking form and the server use one rate
function (`lib/bookings/rates.ts`). Where two prices are shown for the same
thing today (a creator's own hourly rate on their card versus the shoot-type
rate charged), the conflict is logged for the founder (D-69), not hidden.

**We will not:** show an estimate that the next page replaces, or a quote of
zero.

## 9. Staff are customers too

Ops tools are designed for the person doing the job under time pressure: the
fewest taps, limits that stop abuse but not work, queues that say what to do.

**What this means here:** recording a delivery's progress no longer hits the
5-a-minute limit meant for payouts and refunds (`lib/delivery/staff-rate-tier.ts`).

**We will not:** make staff wait out a timer, or use a workaround (clearing a
limit in a test) to hide a limit that blocks real work.

## 10. Respect people's details

Each customer type sees what they need and nothing about the others.

**What this means here:** owners see dates, stages and their share of each
hire, never the renter's name, contact or address. Clients see their creator's
public card only.

**We will not:** expose one user's data to another to make a screen look
fuller.
