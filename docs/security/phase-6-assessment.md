# Phase 6 security assessment (2026-10-10)

An authorised attack on the platform by four parallel attackers (injection,
money, auth/access control, LLM manipulation), then fixes on branch
`phase-6-security` (from `develop` a96919f). Every finding below was first
reproduced, then fixed with a regression test that fails without the fix
(mutation-checked unless stated), then re-attacked.

## Scope

**Local only.** Target: the production build on `localhost:3000` against a
local Supabase (Docker; database rebuilt from the repo through migration
078, then 079), the harness stub on `:4010` (fake Paystack with signed
webhooks, Nominatim, Cloudinary upload API) and Mailpit. No request went to
production, Paystack, Cloudinary, Google or an AI provider. Webhooks were
signed with the local stub key.

| Area | What was attacked |
|---|---|
| Injection & browser (`INJ-*`) | Stored XSS through every `dangerouslySetInnerHTML`, CSP, SSRF in every server fetch, upload signing, PostgREST filter injection, dependency CVEs, clickjacking, secrets in the client bundle |
| Money (`MONEY-*`) | Paystack webhook signature/replay/dedupe, every `handlePaymentComplete` branch, cart price tampering, refunds, payouts and transfer approval, ledger balance |
| Auth & access control (`AUTH-*`) | Admin checks (all three levels), role change and suspension, RLS on every table, IDOR on every app route, CSRF, cron auth, phone-code brute force, open redirects, user enumeration |
| LLM manipulation (`LLM-*`) | A fully hijacked model (a scripted OpenAI-compatible server on `:4790`) driving Ubunye chat and the agent-action commit flow: prompt leaks, markdown exfiltration, tool loops, self-approval, cross-user data, cost |

## Findings

Status: **FIXED** (exploit no longer works, regression test in place),
**MITIGATED** (risk reduced, residual documented), **ACCEPTED** (with reason).

| ID | Sev | Title | Status | Fix commit | Regression test |
|---|---|---|---|---|---|
| INJ-1 | Critical | Stored XSS: JSON-LD `</script>` breakout on creator pages | FIXED | e95f4b9, 2c9e1ed (DB) | `tests/unit/security-jsonld.test.ts`, `security-onboarding-place.test.ts`, `079…test.sql` D1–D4, journey `s-security` INJ-1 ×2 |
| INJ-2 | High | Authenticated blind SSRF (portfolio analyser) | FIXED | 58d5a4f | `security-safe-fetch.test.ts`, `security-ssrf-routes.test.ts`, journey INJ-2 |
| INJ-3 | Medium | CSP `script-src 'unsafe-inline'` | FIXED | 9d75606 | `security-csp.test.ts`, `tests/e2e/csp.spec.ts` (CSP enforced) |
| INJ-4 | Medium | Admin SSRF (EXIF reader non-blind, production describer) | FIXED | 58d5a4f | `security-ssrf-routes.test.ts` |
| INJ-5 | Medium | Over-permissive Cloudinary upload signing | FIXED | a7bcfb2 | `security-upload-signing.test.ts`, journey INJ-5 |
| INJ-6 | High/Crit | Vulnerable dependencies (next/og RCE, nodemailer, sharp, source-map-js …) | MITIGATED | 62cd54e | `npm audit --omit=dev`: 13 → 1 (nodemailer, needs major 10; R-80) |
| INJ-7 | Low | PostgREST `.or()` filter injection (agent/chat search) | FIXED | 294c641 | `security-postgrest-or.test.ts` |
| MONEY-1 | Medium | Service-booking webhook confirms with no amount check | FIXED | 99a54cf | `security-service-payment.test.ts`, journey MONEY-1/2 |
| MONEY-2 | Low | Same branch revives cancelled + refunded bookings | FIXED | 99a54cf | same |
| MONEY (noid) | Low | Transfer webhooks without `data.id` share one dedupe key (2nd payout dropped) | FIXED | 6db9515 | `security-service-payment.test.ts` (dedupe block) |
| AUTH-1 | High | `ADMIN_EMAILS` break-glass without `email_confirmed_at` | FIXED | 5c67e24 | `security-admin-auth.test.ts`, journey AUTH-1 |
| AUTH-2 | Medium | Demoted admin keeps admin over REST/RPC (stale JWT) | FIXED | 2c9e1ed, 5c67e24 | `079…test.sql` A0–A7, B1–B2; `security-admin-auth.test.ts`; journey AUTH-2 |
| AUTH-3 | Low | Suspension neither ends the session nor applies in RLS | FIXED | 2c9e1ed, 5c67e24 | `079…test.sql` C1–C4; journey AUTH-3 |
| AUTH-4 | Low | CSRF Origin check skipped when Origin is absent | FIXED | 9b508a4 | `security-csrf-cron.test.ts`, journey AUTH-4 |
| AUTH-5 | Low | Cron secret compared with `!==` | FIXED | 9b508a4 | `security-csrf-cron.test.ts` (timing not measurable in a unit test) |
| LLM-1 | Low | Bank account/branch numbers in the Ubunye system prompt | FIXED | a943d69 | `security-llm-prompt-bank.test.ts` |
| LLM-2 | Low | Markdown images in replies loaded (zero-click exfiltration; CSP was the only stop) | FIXED | a4ef732 | `security-chat-markdown.test.ts` |
| LLM-3 | Low | Any http(s) link in replies clickable; `//host` treated as internal | FIXED | a4ef732 | same |
| LLM-4 | Low–Med | No cap on chat body/message size or output tokens | FIXED | d5eb916 | `security-chat-limits.test.ts`, journey LLM-4 |
| LLM-5 | Low | 20 tool calls per step × 4 steps = 80 executions per message | FIXED | d5eb916 | `security-chat-limits.test.ts` |
| LLM-6 | Low | rates / bio-writer count usage read-then-write | FIXED | 5c0c273 | `security-agent-usage.test.ts` |

All HTTP-level regressions live in `tests/e2e-local/s-security.journey.ts`
(11 tests; part of `npm run test:e2e:local`).

### INJ-1 — stored XSS via JSON-LD (Critical, FIXED)

**Repro.** A verified, hireable creator with
`location = Jozi</script><script>window.__XSS_LOC__=1</script>` (written
through `POST /api/onboarding` city, which was only `.trim()`-checked, or
straight to `profiles` through the REST API from the profile page). The
public page `/studio/category/photography/<slug>` emitted it raw inside
`<script type="application/ld+json">` (`renderJsonLd` = bare
`JSON.stringify`); Chromium ran it with zero CSP violations. Same for
`display_name` and review text.

**Fix.** `renderJsonLd()` escapes `<`, `>`, `&`, U+2028, U+2029 as `\uXXXX`
(identical JSON for a parser; every JSON-LD caller goes through it, and it
is the only `dangerouslySetInnerHTML` in the app). City/province must match
a place-name charset (`lib/security/text.ts`), street/postal/country refuse
markup. Migration 079 `profiles_reject_markup` refuses `<`/`>` in names,
places, address and `crew_slug` for every writer (only a changed value is
checked, so legacy rows stay editable). Defence in depth: INJ-3.

**Re-attack.** Browser: payload still stored (written with the trigger off,
as a legacy row) → `__XSS_LOC__` undefined, JSON-LD parses back to the exact
string. Onboarding with the payload → 400; REST PATCH → refused by 079.

### INJ-2 / INJ-4 — SSRF (High / Medium, FIXED)

**Repro.** Any signed-in user: `POST /api/agents/portfolios`
`{"action":"analyze-portfolio","imageUrls":["http://127.0.0.1:47731/…"]}` →
a local listener logged the GET (50/day). Admin `extract-metadata` returned
the fetched EXIF/GPS (non-blind); `production-describer` fetched blind.

**Fix.** `lib/security/safe-fetch.ts` for every server fetch of a
user-influenced URL: https on the default port, no credentials; DNS is
resolved inside the socket's own lookup and every address must be public
(loopback, RFC 1918, link-local/metadata, CGNAT, multicast, reserved,
documentation, IPv6 ULA/link-local, IPv4-mapped, NAT64, 6to4 refused), so the
checked address is the connected address (no rebinding gap); redirects are
followed by hand and re-checked; size and time caps (`STUDIO.security.fetch`).
`analyze-portfolio` also accepts only our own Cloudinary uploads
(`isOwnImageUrl`) and at most 12 per request. `matchFaces` keeps a plain fetch
for the server-made Supabase signed URLs only.

**Re-attack.** Same request → 400, listener: no hit.

### INJ-3 — CSP `'unsafe-inline'` (Medium, FIXED)

Every page route is rendered per request (the build lists all 219 routes as
dynamic, `ƒ`; only manifest/robots/sitemap are static), so per-request
nonces work. `proxy.ts` makes a 128-bit nonce per request and sets
`script-src 'self' 'nonce-…' 'strict-dynamic'` (+ the Paystack/Vercel hosts,
ignored by strict-dynamic browsers; `'unsafe-eval'` only in `next dev`) on
the request (Next.js stamps its scripts with it) and on the response.
`next.config.ts` sends only a fallback policy that cannot touch scripts (R4). `style-src` keeps
`'unsafe-inline'` (style attributes cannot run script).

**Verified** in Chromium with the CSP enforced: 18 pages boot the Next.js
runtime with zero `script-src` violations; an injected parser-inserted
inline script is refused (`tests/e2e/csp.spec.ts`).

**Caveat (D-77).** If a page is ever prerendered (static/ISR output served
from cache), its HTML has no nonce and its scripts are blocked. Keep pages
dynamic, or switch that page to hashes. `CLAUDE.md`'s "next.config.ts sets
CSP" line is now out of date: new external services go in
`lib/security/csp.ts` (founder to update `CLAUDE.md`).

### INJ-5 — upload signing (Medium, FIXED)

**Repro.** `/api/cloudinary/sign` signed any `paramsToSign`: a user could
upload to any `public_id`/`folder` (overwrite another user's photo, or write
into the reserved `listings/clean` folder that marks a photo as EXIF-free)
and `resource_type=raw`.

**Fix.** `lib/storage/upload-policy.ts`: a non-admin upload always lands in
`thabangvision_usecase/users/<user id>/…`; admins may name a folder (safe
charset). Kind is image (default) or video (mp4, portfolio videos: a
documented deviation from image-only); anything else is 400. Only `folder`,
`timestamp` and `allowed_formats` are ever signed (images: jpg, jpeg, png,
webp, heic, heif, avif, gif; no SVG), so Cloudinary refuses any added
`public_id`, `overwrite`, preset or callback. The four browser uploaders post
exactly what was signed.

### INJ-6 — dependencies (High/Critical, MITIGATED)

`npm audit --omit=dev`: **13 (1 critical, 3 high, 1 moderate, 8 low) → 1
high**. next 16.3.3 → **16.3.8** (latest 16.3 patch; 16.4.0 was 4 days old),
eslint-config-next 16.1.6 → 16.3.8, sharp 0.35.4 → 0.35.5, source-map-js
1.2.1 → 1.2.2, dompurify 3.4.14 → 3.4.16, fflate 0.8.2 → 0.8.3, ai 6.0.153 →
6.0.214 and @ai-sdk/* to the first releases on provider-utils 4.0.33
(anthropic 3.0.89, google 3.0.86, openai 3.0.77, react 3.0.216; the latest
were published the day before and were not taken), nodemailer 9.0.5 → 9.1.1.
**Remaining:** nodemailer ≤ 10.0.8 (addressparser DoS, DNS-cache TLS
servername, nested-recipient DoS). Fixed only in 10.x, a breaking major
(changelog: Node ≥ 20, TypeScript rewrite); recorded as R-80, not forced.
Dev-only audit findings (vitest mocker, undici, braces …) are out of scope.

### INJ-7 — PostgREST `.or()` injection (Low, FIXED)

`sanitizeFilterTerm()`/`filterIlikePattern()` (`lib/search/types.ts`) replace
`, . ( ) " ' * \ :` and control characters before a term is spliced into a
filter string: agent search tools, the search provider, the studio gear
lookup and the admin import.

### MONEY-1 / MONEY-2 — service-booking webhook (Medium / Low, FIXED)

**Repro.** Signed `charge.success` for R1 against `BK-…` total R5 000 →
booking `paid/paid`; the same against a `cancelled/refunded` R10 000 booking
→ `paid/paid` (revived). Requires a valid signature (held up), so this is
defence in depth against a leaked key or a misbehaving provider.

**Fix.** `confirmServiceBookingPayment()` (`lib/payments/fulfil.ts`): booking
found by reference (lookup error → throw for retry; unknown → no-op), the
metadata booking id must match, currency ZAR, amount equal to
`bookings.total` (whole rands) compared in integer cents; then a
compare-and-set from `pending` + `unpaid`. Zero rows: already paid → no-op;
cancelled/refunded/declined → unchanged, logged + platform event for a
person. Notifications only when a row changed. PayFast's own branch gets the
same guards.

**Re-attack.** Both bookings unchanged (`pending/unpaid`,
`cancelled/refunded`).

**Dedupe ("noid").** Without `data.id`, the dedupe key now uses the object's
reference (transfer reference / transfer code / transaction reference)
instead of a shared `noid`, so a second payout's `transfer.success` is no
longer dropped. Keys for events with an id are unchanged.

### AUTH-1 — break-glass admin (High, FIXED)

**Repro.** A session under the `ADMIN_EMAILS` address with
`email_confirmed_at` null → `GET /api/admin/users` 200.

**Fix.** `isAdmin()` level 3 checks the authenticated session's own user
record (fresh from the Auth server, not the passed-in email) and requires
`email_confirmed_at`. The list itself is unchanged; levels 1 and 2 unchanged;
`lib/greetings/welcome.ts` reads the list but grants nothing.

**Re-attack.** Confirmed → 200 (no lockout); unconfirmed → 403 (GET and the
role PATCH).

### AUTH-2 / AUTH-3 — role change and suspension (Medium / Low, FIXED)

**Repro.** Promote, sign in, demote, reuse the old token → `rpc/is_admin`
true and `admin_list_verifications` returns everyone's verification data.
Suspended user: `/api/auth/me` 200, own REST reads 200, `cart_items` INSERT
passes RLS.

**Fix.**
- Migration 079 `is_admin()`: `profiles.role = 'admin'` is the authority (a
  suspended account is never admin). The JWT `app_metadata` claim is honoured
  only for a profile whose role has never been changed since 079
  (`profiles.role_changed_at` null, stamped by trigger, not user-writable), so
  an admin made by hand in app_metadata before 079 is not locked out, while
  every role change through the app makes the profile authoritative. The
  app's `requireAdmin` reads app_metadata FRESH from the Auth server, so it
  never had the staleness problem; its three levels are unchanged. Existing
  SQL tests 067/072/077 still pass unchanged.
- `admin_revoke_user_sessions(uuid)` (service role only) deletes the user's
  `auth.sessions` (refresh tokens cascade). GoTrue then answers 403
  `session_not_found` for the old access token and refuses refresh (verified
  on GoTrue v2.197). The role and suspend routes call it through
  `lib/auth/sessions.ts` and report `sessions_revoked`.
- Suspended (unexpired) accounts cannot insert/update `cart_items`,
  `banking_details` or `reviews` through RLS (`current_user_is_suspended()`).

**Re-attack.** After demotion: `rpc/is_admin` false,
`admin_list_verifications` refused, `/auth/v1/user` 403, refresh refused.
After suspension: `/api/auth/me` 401, REST cart insert refused.

**Residual.** Between a demotion/suspension and the old access token's
expiry (JWT lifetime, default 1 h), direct REST calls still verify the JWT;
what they can reach is limited by the new `is_admin()` and the suspended-write
policies. Other tables' own-row writes (notifications read flag, onboarding
progress, portfolio analysis) were not restricted (low value).

### AUTH-4 / AUTH-5 (Low, FIXED)

`csrfRejection()` in `proxy.ts`: any Origin (including `null`) must be ours;
with no Origin, a request carrying a Supabase session cookie needs a
same-site Referer; webhooks and cron exempt. The Vercel preview allowance is
now exactly this deployment's hosts (`VERCEL_URL`, `VERCEL_BRANCH_URL`,
`VERCEL_PROJECT_PRODUCTION_URL`), not any `*.vercel.app` containing
"thabangvision" (registrable by anyone). The e2e-local harness now sends a
Referer on its direct API calls as a browser would. Cron: `secretsEqual()`
(SHA-256 both sides + `timingSafeEqual`).

**Re-attack.** Cookie, no Origin/Referer → 403; same-site Origin → 200.

### LLM-1 … LLM-6 (Low, FIXED)

- **LLM-1** The system prompt no longer carries the account/branch numbers; it
  sends people to `/pay` and tells the model never to type bank details.
  Re-attack (`EVIL:LEAK_SYS`): neither number in the prompt the model saw.
- **LLM-2/3** `components/ubunye/chatMarkdown.tsx` + `lib/ubunye/chat-links.ts`:
  images are never loaded (alt text shown); links only to same-site paths
  (not `//host`), our https site, the `STUDIO.social` hosts and
  `STUDIO.security.chat.linkHosts` (now empty), the studio's own WhatsApp
  number (R1), `tel:` and `mailto:` our addresses; anything else is plain text. Re-attack in Chromium
  with CSP bypassed (`EVIL:EXFIL_MD`): reply rendered, no `<img>`, no link and
  no request to the attacker host; raw HTML inert.
- **LLM-4/5** `lib/agents/request-limits.ts` (`STUDIO.security.chat`): body
  ≤ 256 KB (413, checked by Content-Length before routing and by bytes read),
  newest message ≤ 4 000 chars, last 40 messages kept, `maxOutputTokens` 1 500
  per step, 8 tool executions per message (shared budget; later calls return
  a "limit reached" result). Re-attack: 2 MB message → 413; `EVIL:LOOP`
  (80 calls requested) → 8 executed; the model received `max_tokens: 1500`.
- **LLM-6** `/api/agents/rates` and `/api/agents/bio-writer` reserve a slot with
  078 `ubunye_reserve_message` before any work and release it when nothing
  was produced. The counter is still shared with chat, as before.

## Independent review follow-up (2026-10-10)

An independent review of the branch confirmed the fixes above and found six
more items, all fixed or accepted on the same branch:

| # | Sev | Item | Status | Fix commit | Test |
|---|---|---|---|---|---|
| R1 | Low | LLM-3 incomplete: `[x](/&#9;/evil.com)` / `</\t/evil.com>` gave a path classed internal that browsers turn into `//evil.com`; the allowlist let a hijacked model link its own Paystack page or WhatsApp number | FIXED | 1a3e6b7 | `security-chat-markdown.test.ts` +7 (6 fail reverted) |
| R2 | Low | 079: an app_metadata-only admin whose profile already said `user` was "demoted" with no role change, so `role_changed_at` stayed null and the old JWT kept admin for up to 1 h | FIXED | 627bbc2 | `079…test.sql` E1/E2 (E1 fails with the old function), journey "AUTH-2 (review)" |
| R3 | Low | Regression: admin uploads of .mov/.webm/.tiff/.bmp refused by the new signing policy; pickers offered `image/*` (incl. SVG) | FIXED | 01cb6de | `security-upload-signing.test.ts` +3 |
| R4 | Low | Regression: the proxy matcher skipped every `*.png/.svg/...` path, so `/studio/x.png` rendered the 404 with no CSP | FIXED | 22b2d77 | `security-csp.test.ts`, `tests/e2e/csp.spec.ts` +2 |
| R5 | Info | `/_global-error` is prerendered without a nonce, so its inline scripts are blocked | ACCEPTED | — | — |
| R6 | Info | CSRF origin list must keep the founder's hosts working | VERIFIED | 22b2d77 | `security-csrf-cron.test.ts` +4 |

- **R1.** A link is internal only if it contains no whitespace/control
  characters and `new URL(href, probe).origin` is the probe's origin.
  react-markdown already percent-encodes such characters (`/%09/evil.com`,
  same-origin); the function no longer relies on it. `checkout.paystack.com`
  is no longer linkable from model text (payments go through `/pay` or the
  server-issued prepared-action card); `wa.me` only for
  `STUDIO.whatsapp.number`.
- **R2.** `admin_revoke_user_sessions()` (called on every role change and
  suspension) also stamps `role_changed_at` through a transaction-local switch
  the trigger honours only for the platform roles. 079 is applied nowhere yet,
  so it was amended in place.
- **R3.** `STUDIO.security.uploads.adminImageFormats` (+ tif, tiff, bmp) and
  `adminVideoFormats` (mp4, mov, webm, m4v) for admins; users unchanged; never
  SVG or raw. Every Cloudinary file picker uses `uploadAccept()` /
  `dropzoneAccept()` built from the same lists (MIME types keep the phone
  camera working with `capture`).
- **R4.** The matcher skips only `/_next/static`, `/_next/image` and the real
  files in `public/` (add a pattern when a file is added there). A static
  fallback CSP (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'`)
  is sent on every response by `next.config.ts`; browsers enforce every CSP
  header, so it holds nothing about scripts, styles, connections or images.
  On proxied responses only the proxy's policy is sent (checked with curl).
- **R5 accepted.** `global-error` must be a client component, where route
  segment config (`dynamic = 'force-dynamic'`) does not apply, and the app
  uses Next's built-in one. It is only served as HTML for a server error in the
  root layout; that version's only control is "Reload", a plain `<form>` GET
  that works without JavaScript ("Back" is shown only for client-side errors,
  which render inside the already-running, nonce'd client). So the page works
  with its scripts blocked; the cost is console CSP errors on a page that is
  already an error.
- **R6.** `allowedOrigins()`: `NEXT_PUBLIC_APP_URL` and its www/apex twin
  (production `www.thabangvision.com` + apex; on Preview the nonprod alias
  `thabangvision-nonprod.vercel.app`), `VERCEL_URL` (per deployment),
  `VERCEL_BRANCH_URL` (the git-develop alias), `VERCEL_PROJECT_PRODUCTION_URL`.
  Any other host the site is served on must be one of these, or POSTs from it
  are refused with 403 "Invalid origin."

## Verification (final build, after the review follow-up)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 1 842 passed, 4 skipped (158 files; 13 new security test files) |
| eslint on every changed file | no new errors (3 pre-existing in the same files before and after) |
| `npm run build` with the CI placeholder env + `sec.sh` | build OK; no secrets, no business values, no SDK imports in `app/` |
| Database from empty: `rebuild-local.sh` + `run-sql-tests.sh` | 86 files applied through 079; 16/16 test files pass (079: 20 checks) |
| `npm run test:e2e:local` (local stack, final build) | 63/63 passed (52 existing + 11 in `s-security.journey.ts`) |
| `tests/e2e` incl. a11y and the new `csp.spec.ts`, CSP enforced, CI env | 162 passed, 14 skipped, 8 failed: the same 8 that fail on earlier builds in this env (login against the dummy Supabase, a Gemini route that answers 404, the guest counter text on the Ubunye page, a public-pages timeout); +14 from `csp.spec.ts` |
| `npm audit --omit=dev` | 1 high (nodemailer, R-80); full audit 13 (dev-only tooling) |

**Final re-run of every reproduction against the final build** (database
rebuilt from empty): INJ-1 payload stored → not executed, JSON-LD intact;
INJ-2 → 400, listener not hit; INJ-5 → folder forced into the user's
namespace, only `allowed_formats/folder/timestamp` signed, raw → 400;
MONEY-1/2 → `pending/unpaid` and `cancelled/refunded` unchanged; AUTH-1 →
confirmed 200, unconfirmed 403 (GET and role PATCH); AUTH-2 → `is_admin`
true before, false with the old token after demotion,
`admin_list_verifications` 400, `/auth/v1/user` 403; AUTH-3 →
`/api/auth/me` 401, REST cart insert 403; AUTH-4 → 403; LLM-4 → 413;
LLM-1 → no bank numbers in the prompt the model saw, `max_tokens` 1 500 sent;
LLM-5 → 8 of 80 requested tool calls executed; LLM-2/3 (Chromium, CSP
bypassed) → no `<img>`, no link and no request to the attacker host; LLM-6 →
15 parallel requests: 5 answered (burst limit), daily count exactly 5.

## What held up

**Injection.** No secrets in `.next/static` (only the anon key) and no client
source maps; public `/api/search` strips PostgREST/LIKE metacharacters; email
templates escape user content and subjects are header-encoded;
react-markdown without rehype-raw (raw HTML inert); chat links already
blocked `javascript:`; the OG route renders a PNG and fetches no user URL;
onboarding names charset-validated; `isOwnImageUrl()` on onboarding and
listings; `cloudinaryParts()` pins `res.cloudinary.com` and refuses
`/image/fetch/`; robots/sitemap; X-Frame-Options DENY + `frame-ancestors 'none'`.

**Money.** Webhook signatures (HMAC-SHA512 + timingSafeEqual; wrong key,
zero-padded, empty → 401); replay dedupe; gear `decideCharge` (amount,
currency, user mismatch → hold); cart checkout refuses client prices
(server pricing, idempotency key); transfer approval needs exact
reference + amount + recipient; refunds capped and claimed by CAS;
service refunds and payouts (CAS claims, 72 h rule, reconcile before resend);
unknown references are no-ops; service pricing server-side; ledger balanced
throughout.

**Auth.** Profile privilege escalation, banking writes, cross-user REST reads,
client-invented orders/bookings/listings/subscriptions/payments/reviews/flags,
service-role-only money RPCs, `admin_*` RPCs gated by `is_admin()`, every
app-route IDOR checked, all webhooks signature-verified, cron auth, phone-code
brute force (5 attempts, 10 min), open redirects (`safeNextPath`), maintenance
bypass, no user enumeration.

**LLM (with a fully hijacked model).** Guests cannot use the booking agent;
money and bookings never commit from the model (HMAC commit token the model
never sees; no token / tampered / wrong user / swapped payload / expired /
replay all refused); prepared actions bound to the session user; cross-user
isolation; server ignores model numbers (quantity, trust-tier limits, prices
requoted); catalogue prompt injection neutralised and fenced; no keys or other
users' PII in the prompt; the 078 daily cap held exactly; raw HTML not
parsed; CSP allowlists; the local provider chain never reached a cloud
provider.

## NOT RUN

- **Real-model jailbreak quality**: providers unreachable; only a hijacked
  model was used (immaterial to the hard controls above).
- **Supabase Storage** (verification bucket): not running locally.
- **Google OAuth** sign-in.
- **Real provider payload shapes** (Paystack, Yoco, Cloudinary): stub shapes
  only; the "noid" fix assumes a reference is present when an id is not.
- **Cloud metadata IP** (169.254.169.254): does not resolve in the sandbox;
  SSRF was proven against a 127.0.0.1 listener and the range is refused by
  `safeFetch` (unit-tested).
- Concurrency races at load (double confirm, parallel payouts, parallel
  checkout): reviewed statically (CAS/locks); 078 has its own concurrency test.
- File-upload content tests (SVG-with-script, polyglots, EXIF on served
  images); SVG is now refused at signing (`allowed_formats`).
- The unconfirmed-email variant of AUTH-1 against hosted Supabase with
  confirmations on (simulated locally by nulling `email_confirmed_at`).
- A full run of the new HTTP journey against the OLD build (each exploit was
  reproduced on the old build by hand, and unit/SQL tests were
  mutation-checked).

## For the founder

- **R-80 / D-79** nodemailer 10.x upgrade (the last production audit item).
- **D-80, D-81** defaults taken (database admin authority, upload policy): review.
- **D-77** the nonce CSP requires pages to stay dynamic; update `CLAUDE.md`'s
  CSP line to point at `lib/security/csp.ts`.
- **D-78** admin break-glass policy: keep `ADMIN_EMAILS` as a level-3 grant
  (now confirmed-email only) or restrict it to the database-fault case only;
  and **2FA for admin accounts** (Supabase MFA, enforce `aal2` in
  `requireAdmin` and `is_admin()`), not built.
- R-81 the residual window of an old access token after demotion/suspension
  (shorten the JWT lifetime in Supabase Auth settings if it matters).
