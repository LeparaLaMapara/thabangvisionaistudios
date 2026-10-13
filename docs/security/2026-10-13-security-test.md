# Security test, 2026-10-13

Two authorised tests (TASK-070) against the DEV database with throwaway users,
plus read-only checks on production. Test users and their rows were deleted.

1. Website, API, payments and sign-in.
2. Ubunye AI agents and the code added that day (engagement emails, push,
   disputes, reviews, signup webhook).

No critical finding. Every Phase 6 fix (phase-6-assessment.md) still holds.

## Findings and what was done

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| A1 | High | Any signed-in user could insert a dispute on any booking through the REST API (the policy only checked `filed_by`). That blocked the real parties (one live dispute per booking) and held the creator's payout. | Fixed: 088 revokes the client insert; /api/disputes checks the party and writes with the service role |
| W-M1 | Medium | A creator could mark their own crew request `paid`, then `completed`, with no payment | Fixed: `lib/creators/request-status.ts`; nobody sets `paid` by hand |
| W-M2 / A2 / A7 | Medium | Push endpoints could be any https address (server-side request forgery), unbounded per user, insertable straight into the table, and posting someone's endpoint moved their subscription | Fixed: push-service allow list in code and a 088 check, client insert revoked, 10 per person (route and trigger), a subscription moves only with the same browser keys |
| A3 | Medium | One person's slow push endpoints could stall the shared queue | Fixed: sends to a person's browsers in parallel, 4 s timeout, removes a browser after 3 failures |
| W-M3 | Medium | Phone code send and verify counters were read then written (race) | Fixed: atomic `phone_code_store` and `phone_code_try` (088), plus per-number and per-network caps |
| A4 | Medium | Every signup, confirmed or not, cost an AI draft and an owner email | Fixed: only confirmed accounts are drafted and announced (088 calls the webhook again on confirmation), hourly caps on owner notes and AI drafts |
| A5 | Low-Med | The chat accepted `system` and forged tool turns from the browser | Fixed: only user and assistant text is kept |
| A6 | Low | A tab or newline after the first slash got past both notification link checks | Fixed: control characters, spaces and backslashes refused in `safePushUrl` and `sw.js` |
| A8 | Low | Review text had no length limit | Fixed: 2000 characters in the route and a 088 check |
| A9 | Low | `/api/chat-session` made rows without limits | Fixed: rate limit, known agents only, creator id must be a UUID |
| A10 | Low | AI email checks missed bare domains and spelled-out links; any word could be a first name | Fixed: both refused |
| W-L1 | Low-Med | Any URL accepted as dispute evidence and return photos (shown to staff) | Fixed: our Cloudinary links only, at most 10 |
| W-L3 | Low | A seller could move an order from any status | Fixed: one step at a time from paid (`lib/orders/status.ts`) |
| hardening | Low | anon held SELECT on `banking_details` and `subscriptions` (RLS returned nothing) | Fixed: revoked in 088 |
| hardening | Low | pg_net `net.http_*` is executable by anon and authenticated | Not fixable by us: the functions belong to `supabase_admin` and run as PUBLIC; the `postgres` role cannot revoke (tried on dev). PostgREST does not expose the `net` schema, so it is not reachable |
| W-M4 | Medium, dormant | PayFast webhook gaps | TASK-081, before PayFast is switched on |
| W-M5 | Medium, dormant | WhatsApp webhook fails open when unconfigured | TASK-081, before Twilio is configured |
| W-L2 | Low-Med | Quote PDF can be made with any client and prices | TASK-081 |

## What held

Server-side prices and identity in Ubunye tools, the approval token flow,
stored prompt injection in a bio, system prompt extraction, markdown image
exfiltration, unsubscribe signing, webhook secrets, cron auth, CSRF origin
checks, ID document storage isolation, profile role and verification locks,
and money tables (read only for users).
