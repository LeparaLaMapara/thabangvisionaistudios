# Ubunye: the transactional agent (Phase 2)

Ubunye helps people find gear and creators and **prepare** bookings. It never books, pays or refunds on its own. The design is in [ADR 0004](../architecture/adr/0004-agent-prepare-approve-commit.md).

## The flow
1. The customer asks, for example "Can I rent the Sony FX3 Friday to Sunday?"
2. Ubunye checks availability, then calls `prepare_gear_booking`. The server prices it, checks the renter's limit and stores a proposal.
3. The chat shows an **approval card** with:
   - the item or service and period;
   - who and what, looked up by the server: the creator's name (or "assigned by our team"), where, what is delivered and the brief; for gear, the make and quantity;
   - the hire, the refundable deposit and the total;
   - whether it must be collected in person;
   - the cancellation policy.
4. The customer presses **Approve**:
   - **Gear** goes into their cart, and they pay at checkout.
   - **Services** become a booking with a payment link.
   - **Decline** withdraws the proposal.
5. If they type "yes" instead of pressing Approve, Ubunye reminds them to press Approve and can show the card again (`get_pending_proposal`). If they change the dates or hours, a new proposal replaces the old one.

## Rules enforced in code (not only in the prompt)
- The model has no tool that commits, approves, pays, refunds or pays out.
- **Approval tokens:**
  - signed with HMAC-SHA256;
  - bound to the person, proposal, amount and quote version;
  - valid for 15 minutes and usable once;
  - issued only when Approve is pressed. Loading or re-rendering a card is read-only, so a second card for the same proposal cannot break the first. The chat shows one card per proposal.
- **At commit**, the server recomputes the price and refuses if it changed. It also re-checks availability. Proposals are claimed atomically, so a double click books once. The booking step itself is given the approved amount and refuses if its own price differs, which closes the gap between the claim and the booking.
- **Ownership:**
  - A conversation id sent by the browser is used only if it belongs to the person, or for a guest, to their network address.
  - Nobody can load or approve another person's proposal.
- **Guest limit:** each guest gets the agent's allowance (5 messages), counted by their browser. The server also counts per network address, with a higher ceiling (`STUDIO.ai.guestNetworkDailyMessages`, 60 a day), because many people share one address on mobile carriers and office networks. The server ceiling caps cost; it cannot tell people on one address apart. Signed-in people are counted per account.
- **Conversation:** the browser keeps the conversation id the server returns (`x-conversation-id`), so a proposal made in one turn is found in the next even if creating the session up front failed.
- **Untrusted text:** listing, profile, review, press, production and retrieved text is flattened (`lib/ubunye/sanitise.ts`) and marked as data. Fence markers are stripped so text cannot close the block it sits in.

## Configuration
| Setting | What it does |
|---|---|
| `AGENT_APPROVAL_SECRET` | Server-only secret of at least 32 characters for approval tokens. Without it, Ubunye cannot prepare bookings and points people to the website. Rotating it invalidates outstanding approval cards, which is harmless because they expire in 15 minutes. |
| Migration 074 | The `agent_actions` table. Before it is applied, preparing fails and Ubunye says booking through chat is unavailable. |

## Evaluations
- **Ran: in-memory scenarios.** `tests/unit/ubunye-agent-evals.test.ts` has 42 scenarios covering the spec §8.11 list:
  - pending "yes", changing dates, cancelling;
  - repeated and racing approvals, expired quotes, a wrong total;
  - tampered and foreign tokens, cross-user access;
  - stock gone and hallucinated stock, provider downtime;
  - prompt injection in titles, bios and proposals;
  - signed out, unverified, service area, payment ambiguity.

  They run against the code that enforces the policy, with in-memory adapters.
- **NOT RUN: two live AI providers.** Replaying the same conversations against live models needs provider API keys. The policy holds whatever a model outputs, because no model output reaches a commit. The live run still matters, to check the model uses the prepare tools well.

## When a commit is interrupted
- If the booking step throws part-way (a timeout, say), the proposal is marked failed and the person is told to check their cart and bookings before asking again. The message does not claim nothing happened, because the step may have finished.
- If the booking succeeded but recording the result failed, the person still sees the success. The proposal stays in `committing`, which no token can claim again, so it can never book twice.
- **Operator check:** rows in `agent_actions` stuck in `committing` for more than an hour need a look. Match them to the person's cart or bookings (`result` is empty), then set the state by hand. Nothing does this automatically, because only a person can tell whether the booking went through.

## Known limits
- Gear approval adds to the cart. The total on the card is for that item alone; checkout shows the final total with the rest of the cart, including any bulk discount.
- Service bookings made through Ubunye use the same pricing as `/book` and record the same agreed terms (revision allowance and policy, cancellation policy, shoot date when an ISO date is given).
- The chat keeps only text in the browser's session storage. After a reload the card is gone, but the proposal is not: saying "yes" brings it back.
