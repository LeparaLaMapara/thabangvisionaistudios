# ADR 0004: Ubunye prepares, the person approves, the server commits

**Status:** accepted (Phase 2, 2026-10-09)

## Context
Before this change, Ubunye's `create_service_booking` tool created a booking and a payment link, and `add_gear_to_cart` reserved gear. The only gate was a sentence in the prompt. The model could quote and book in one turn. The chat history came from the browser, so it could be forged. Text from listings and profiles could steer the model (spec §8.6–8.9).

## Decision
1. **The model can only prepare.**
   - `prepare_gear_booking` and `prepare_service_booking` check availability, the renter's limit and the creator's status.
   - The price comes from the same functions the website charges by. The model's numbers are never used.
   - The proposal is stored in `agent_actions` (migration 074) with a 15-minute expiry.
   - The model gets a proposal id and a summary, never a token.
2. **The person approves on an approval card.**
   - The card loads the proposal from `GET /api/agent-actions/[id]`.
   - It shows the item, period, hire, deposit, total, collection requirement and cancellation policy.
   - Loading the card issues a fresh single-use token. The token is an HMAC over action, person, kind, amount, quote version, expiry and nonce, signed with `AGENT_APPROVAL_SECRET`. Only the nonce's hash is stored.
3. **The server commits** on `POST /api/agent-actions/[id]/commit`, using the token and an explicit approval. It checks the following, in this order:
   - the signature, the person and the expiry;
   - the stored proposal;
   - the price, recomputed (if it moved, the commit is refused);
   - an atomic claim of the proposal: `prepared → committing`, compare-and-set on the nonce hash;
   - only then, the website's own booking step.
4. **No tool commits, approves, pays, refunds or pays out.** A "yes" typed in the chat cannot book anything. The pending proposal is read from the server each turn and put in the prompt, so "yes" refers to it.
5. **Untrusted text is flattened and fenced:** listings, profiles, reviews, retrieved documents, tool outputs and the user's own account block. A newer proposal in the same conversation supersedes the older one.

## Consequences
- **Gear:** approving adds the item to the cart. The customer pays at checkout, which re-checks stock, limits and price. There is no parallel booking engine.
- **Services:** approving creates the service booking and its payment link, as the `/book` form does.
- **Without `AGENT_APPROVAL_SECRET`** (at least 32 characters), Ubunye cannot prepare bookings and points people to the website.
- **Evaluations:** `tests/unit/ubunye-agent-evals.test.ts` (36 scenarios) checks the policy in code. Replaying the conversations against two live AI providers is NOT RUN; it needs provider keys.
