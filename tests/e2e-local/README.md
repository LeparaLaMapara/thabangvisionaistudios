# Local end-to-end journeys

Real user journeys (accounts, studio rentals, the owner marketplace, creatives,
own-vehicle delivery, admin, Ubunye) run against a **fully local** stack. Money
and state are checked in the database (psql) and in the payment stub's own log,
not only in the UI.

Nothing here talks to production, Paystack, Cloudinary, Google or an AI
provider. These specs are not part of `npm run test:e2e` (that suite's
`testDir` is `tests/e2e`; these files end in `.journey.ts` and have their own
config).

| File | Journey |
|---|---|
| `a-accounts.journey.ts` | sign up/in with the email code and link, Terms on /welcome, password reset + sign-in, generic errors, `next` and open redirects, phone code |
| `b-studio-rental.journey.ts` | browse, eligibility, cart and dates, cancel on the payment page, pay, webhook replay, paid without webhook, renter cancel + refund, collection rules |
| `c-marketplace.journey.ts` | owner listing (photo, AI fallback, submit), owner cannot self-publish, admin review, hire, handover, return, owner payout |
| `d-creatives.journey.ts` | creator onboarding without AI, private portfolio, verification, service booking, delivery, approval, 72-hour payout |
| `e-delivery.journey.ts` | address checks, delivery fee in the charge, delivery ops, handover, renter acceptance, return pickup, cancellations and refunds |
| `h-owner-pickup.journey.ts` | Phase 8: owners save a private pickup address and opt listings in; a studio + two-owner order gets one outbound and one return leg per origin; privacy (renter sees the suburb, owners their own items, staff only by an audited reveal); owner handover with a photo at their door; return to each owner, confirmed (receipt and condition) or reported as a problem; one earn journal per leg and origin |
| `f-admin.journey.ts` | admin pages and APIs, non-admin refused |
| `g-ubunye.journey.ts` | chat with no AI reachable, guest limits |
| `s-security.journey.ts` | Phase 6 security regressions at the HTTP level: JSON-LD XSS, SSRF, upload signing, service-payment webhook amount/state, admin break-glass, demotion/suspension revoke sessions, CSRF without Origin, oversized chat (docs/security/phase-6-assessment.md) |
| `seed-suite-user.journey.ts` | creates the account `tests/e2e/full-journey.spec.ts` signs in with |

## 1. Local Supabase

```bash
supabase init            # in an empty folder outside the repo, e.g. ~/tv-local
supabase start           # needs Docker; prints API URL, DB URL, anon and service keys
supabase status          # Mailpit (all auth emails) is on http://127.0.0.1:54324
```

The local config's email templates carry only the sign-in **link**, not the
6-digit code (the same is true of the hosted project until risk R-33 is done).
The specs read the email from Mailpit and, when it has no code, mint one
through the local Auth admin API (`helpers/auth.ts emailCode`).

## 2. Schema

One command, from the repo root, against the empty local database:

```bash
scripts/db/rebuild-local.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
scripts/db/run-sql-tests.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres   # optional: every *.test.sql
```

The script applies the canonical order (`--list` prints it; see
[docs/database/README.md](../../docs/database/README.md)): the base schema,
`lib/migrations` in name order with the four April files from
`supabase/migrations/` before 029, through the latest migration, then asks
PostgREST to reload its schema. It refuses any host that is not local.

No local shims are needed any more. Migration 077 fixed the two findings the
harness used to patch around: the signup trigger (`handle_new_user` inserted
`profiles.email`, which 048 drops, so every sign-up failed) and the
`booking_payments.status` CHECK (it refused the `succeeded` that
`confirm_rental_payment` writes, which rolled back every gear payment
confirmation).

To start again: `supabase db reset` in the local Supabase folder, then run the
script again.

## 3. Admin account

Admins are ordinary accounts promoted by hand, as the founder does:

```sql
update profiles set role = 'admin' where id = '<user id>';
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where id = '<user id>';
```

The specs do this themselves (`helpers/auth.ts makeAdmin`). The admin must sign in again after the change.

## 4. Environment, stub, app

```bash
cp tests/e2e-local/harness/local.env.example ~/tv-local.env   # fill the two keys from `supabase status`
source ~/tv-local.env

# Fake Paystack (checkout page, signed webhooks, verify, refunds, transfers),
# Nominatim (Sandton for any address, Cape Town when asked, nothing for "nowhere")
# and the Cloudinary upload API. GET http://localhost:4010/__log shows everything.
nohup node tests/e2e-local/harness/stub.mjs > /tmp/stub.log 2>&1 &

npm run build
NODE_OPTIONS="--require $PWD/tests/e2e-local/harness/preload.cjs" nohup npx next start -p 3000 > /tmp/app.log 2>&1 &
```

`preload.cjs` reroutes the **app server's** calls to `api.paystack.co`,
`nominatim.openstreetmap.org` and `api.cloudinary.com` to the stub. In the test
browser, `helpers/pay.ts` and `helpers/storage.ts` route
`checkout.paystack.com`, `api.cloudinary.com` and `res.cloudinary.com` to it.

Stop the app by PID only (`ps -eo pid,cmd | grep -E 'next-server|next start'`),
never `pkill -f`.

Another port: build with `NEXT_PUBLIC_APP_URL=http://localhost:3100`, start
with `next start -p 3100`, run the stub with `STUB_PORT=4110
APP_URL=http://localhost:3100` and the specs with
`BASE_URL=http://localhost:3100 STUB_URL=http://localhost:4110` (the
payment helpers and journey A follow `BASE_URL`).

## 5. Run

```bash
source ~/tv-local.env
export PW_CHROMIUM_PATH=/path/to/chromium   # optional: a preinstalled Chromium
export APP_LOG=/tmp/app.log                 # phone codes are read from here
npm run test:e2e:local                      # all journeys, one worker, no retries
npm run test:e2e:local -- b-studio-rental   # one journey
```

Each run makes new accounts and gear (unique names), so runs can be repeated
on the same database.

## What the harness does that a person would not

- **A Referer on direct API calls.** Journeys call app APIs with
  `page.request`, which sends no Origin; a browser always sends one, and
  `proxy.ts` refuses a cookie-authenticated mutation with neither Origin nor
  a same-site Referer (security AUTH-4). The config and `newContext` add a
  same-site Referer (not an Origin: Mailpit refuses a foreign Origin).
- **CSP bypass in the test browser.** The site's CSP allows Supabase only at
  `https://*.supabase.co`; the local API is `http://127.0.0.1:54321`.
- **ID documents are not uploaded** (no Storage locally): the submission is
  recorded with `submit_verification_for_user`, exactly as the upload route
  does after a successful upload, and an admin approves it in the admin UI.
- **Time moves in the database** for the 48-hour owner payout delay, the
  72-hour creator payout delay and a renter's past clean return.
- **Rate-limit windows are cleared** where a person would take longer than a
  test (several checkouts in a minute), and the guest Ubunye daily ceiling
  per network address (every run comes from 127.0.0.1). Staff delivery
  updates are not cleared: a whole delivery fits inside the admin limits.
- **The provider side is simulated** by the stub: refunds become `processed`
  and transfer webhooks are sent when a spec asks (`/__refunds/settle`,
  `/__transfers/notify`).

## Not covered locally

Google sign-in, real AI answers (only graceful failure is checked), document
upload to Supabase Storage, real courier providers, and email delivery
(the app's own emails need Gmail credentials; Supabase auth emails go to Mailpit).
