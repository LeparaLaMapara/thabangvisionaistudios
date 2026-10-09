# Ubunye: the transactional agent (Phase 2)

Ubunye helps people find gear and creators and **prepare** bookings. It never books, pays or refunds on its own. The design is in [ADR 0004](../architecture/adr/0004-agent-prepare-approve-commit.md).

## The flow
1. The customer asks, for example "Can I rent the Sony FX3 Friday to Sunday?"
2. Ubunye checks availability, then calls `prepare_gear_booking`. The server prices it, checks the renter's limit and stores a proposal.
3. The chat shows an **approval card** with:
   - the item and period;
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
  - reloading the card makes the old token invalid.
- **At commit**, the server recomputes the price and refuses if it changed. It also re-checks availability. Proposals are claimed atomically, so a double click books once.
- **Ownership:**
  - A conversation id sent by the browser is used only if it belongs to the person, or for a guest, to their network address.
  - Nobody can load or approve another person's proposal.
- **Guest limit:** the daily guest allowance is counted on the server.
- **Untrusted text:** listing, profile, review, press, production and retrieved text is flattened (`lib/ubunye/sanitise.ts`) and marked as data. Fence markers are stripped so text cannot close the block it sits in.

## Configuration
| Setting | What it does |
|---|---|
| `AGENT_APPROVAL_SECRET` | Server-only secret of at least 32 characters for approval tokens. Without it, Ubunye cannot prepare bookings and points people to the website. Rotating it invalidates outstanding approval cards, which is harmless because they expire in 15 minutes. |
| Migration 074 | The `agent_actions` table. Before it is applied, preparing fails and Ubunye says booking through chat is unavailable. |

## Evaluations
- **Ran: in-memory scenarios.** `tests/unit/ubunye-agent-evals.test.ts` has 36 scenarios covering the spec §8.11 list:
  - pending "yes", changing dates, cancelling;
  - repeated and racing approvals, expired quotes, a wrong total;
  - tampered and foreign tokens, cross-user access;
  - stock gone and hallucinated stock, provider downtime;
  - prompt injection in titles, bios and proposals;
  - signed out, unverified, service area, payment ambiguity.

  They run against the code that enforces the policy, with in-memory adapters.
- **NOT RUN: two live AI providers.** Replaying the same conversations against live models needs provider API keys. The policy holds whatever a model outputs, because no model output reaches a commit. The live run still matters, to check the model uses the prepare tools well.

## Known limits
- Gear approval adds to the cart. The total on the card is for that item alone; checkout shows the final total with the rest of the cart, including any bulk discount.
- Service bookings made through Ubunye use the same pricing as `/book`. The revision policy captured by the services workstream is added on the website form; check that it is also set for Ubunye bookings when the two workstreams are merged.
- The chat keeps only text in the browser's session storage. After a reload the card is gone, but the proposal is not: saying "yes" brings it back.
