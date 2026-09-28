# TASK-070: Full security check: break it before someone else does
## Priority: HIGH | Phase: V5 | Parked by the owner on 2026-09-28, to follow the product clarity work
## Files allowed: read-only audit first; fixes each in their own PR, nonprod (develop) first

## Why
Money, ID photos and gear worth thousands pass through the site. The owner asked for a
complete check: vulnerabilities, ways to exploit them, and what a capable AI agent
could do from outside (or through Ubunye) to manipulate bookings, payments or data.

## Scope
1. **Access control:** every API route's who-can-do-what (IDOR on bookings, handover,
   take-back, mark-paid, welcomes, payouts, verifications); admin checks; row level
   security on every table in production (pg_policies), including new tables 060 to 065.
2. **Money paths:** checkout amounts (client never trusted), webhook signatures (Paystack,
   Yoco), replay, refund routing ("manual:" references), payout guard, commission maths,
   cooling-off refunds, deposit settlement, double booking under races.
3. **Identity:** ID check bypass, phone code brute force and rate limits, trust-ladder
   bypass (value limits, collection-only), account takeover (auth flows, redirects,
   Google sign-in allow list), session handling.
4. **AI and agents:** prompt injection against Ubunye (tools that create bookings or
   carts, my_bookings data exposure, system prompt leakage), the welcome drafter, the
   signup webhook, and hostile agents automating sign-ups, carts or scraping.
5. **Secrets and config:** keys in the repo and history, Vercel env per target (prod
   had test Paystack keys; preview had wrong Supabase keys), Supabase Vault, the tokens
   in .claude/settings.local.json that the owner is rotating.
6. **Platform:** CSP and headers, origin checks, file uploads (Cloudinary signing,
   verification uploads), dependency advisories, rate limits (in-memory limiter resets on
   cold start).

## Method
Threat model first, then automated scans (dependency audit, secret scan, Supabase
advisors), then manual attempts against the dev database and nonprod only, never
production data. Each finding: severity, proof, fix, test that stops it coming back.

## Acceptance criteria
- [ ] Written report with every finding ranked and a proof for each
- [ ] Critical and high findings fixed and re-tested on nonprod, then released
- [ ] Tests or CI checks added so the fixed holes stay closed
