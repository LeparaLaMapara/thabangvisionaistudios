# October 2026 release: apply order for production

Production (`zbdsqvpxpsygbuqnuekm`) is at migration 066, plus the F1 hotfix
of 2026-10-13 (section 0). This release takes it to 087. Background and
evidence: [2026-10-rehearsal-067-082.md](2026-10-rehearsal-067-082.md).
Nothing here runs without the founder's go.

Run every file as `postgres`, one at a time, and stop at the first error:

```bash
psql "$PROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "set lock_timeout='5s'" -c "set statement_timeout='120s'" -f <file>
```

Each migration is one transaction, so a failed file leaves nothing applied.
Each test ends in ROLLBACK. Keep all output.

## 0. F1: already done on production (2026-10-13)

Any signed-in user could read every ID document. This block was run on its
own on production on 2026-10-13: the policy "Admins view all verification
docs" is gone, and production records it as the migration
`hotfix_close_verification_docs_leak`. Do not run it again by hand. 083 (step
1 below) repeats the same drops with `if exists`, so it is harmless there.
For the record, what was run:

```sql
begin;
set local lock_timeout = '5s';
drop policy if exists "Admins view all verification docs" on storage.objects;
drop policy if exists "Users view own verification docs" on storage.objects;
drop policy if exists "Users upload own verification docs" on storage.objects;
commit;
```

It is still a possible POPIA incident: check the storage logs for reads of
`verifications` objects by anyone other than their owner.

## 1. Env first, then the deploy, then the database at once

Vercel applies env changes only to deployments made after them. So set the
env BEFORE the deploy, or the release build runs without it.

1. Set on Vercel production (each `openssl rand -hex 32`, different from
   Preview):
   - `AGENT_APPROVAL_SECRET` (32 or more characters; without it Ubunye cannot approve anything)
   - `CONSENT_IP_HASH_SECRET` (without it consent IPs are hashed with plain SHA-256)
   - `PHONE_CODE_SECRET` (without it phone codes are hashed with the service role key)
   - `ENGAGEMENT_SIGNING_SECRET` (32 or more characters; without it no
     engagement email is sent, as no unsubscribe link can be made), and
     `ENGAGEMENT_DRY_RUN=true` for the first runs (087)
   - `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value),
     `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`: a production key pair
     (`npx web-push generate-vapid-keys`) for push (087)
   - `SIGNUP_WEBHOOK_SECRET` and `CRON_SECRET`, if not set already
   - `SMS_PROVIDER` and its keys, only if phone verification is live
2. Remove `VERCEL_TOKEN` from the production runtime env. The code never reads it.
3. Take a backup: Supabase dashboard backup from today, and
   `pg_dump "$PROD_DATABASE_URL" -Fc -f prod-before-067.dump`.
4. Deploy: merging `develop` into `main` IS the production deploy (Vercel
   builds `main` on its own). The build carries the phase 0 code 067 needs,
   the `getBusyCreatorIds` code 077 needs, and the Phase 5, 6 and 8 builds.
   Maintenance mode stays on.
5. Run section 2 straight after the deploy is Ready, in one sitting. The app
   is ahead of the database until then.

**Pick the time around the crons** (`vercel.json`, UTC): 00:00 daily
maintenance, 03:00 invariants, 05:45 rental pipeline, 06:00 hourly checks
(and Monday 06:00 weekly reports), 12:00 AI budget checks. That is 02:00,
05:00, 07:45, 08:00 and 14:00 in South Africa. No cron may run while the
migrations are half applied: start just after one (for example 00:15 UTC)
and finish before the next, or stop and wait for it to pass.

## 2. Migrations, in this order

| Step | Run | Then |
|---|---|---|
| 1 | `083-prerelease-fixes.sql` | `083-prerelease-fixes.test.sql` (its F1 part changes nothing now: done by the hotfix) |
| 2 | `067-lock-sensitive-columns.sql` | `067-…test.sql` |
| 3 | `068-consent-records.sql` | `068-…test.sql` |
| 4 | `069-subscription-expected-price.sql` | |
| 5 | `070-gear-pipeline.sql` | `070-…test.sql` (never `070-concurrency.sh` on prod) |
| 6 | `071-provider-neutral-payments.sql` | `071-…test.sql` |
| 7 | `072-listing-review.sql` | `072-…test.sql` (fails only at the empty claims check until 077; run it again in step 12) |
| 8 | `073-service-fulfilment.sql` | `073-…test.sql` |
| 9 | `074-agent-actions.sql` | `074-…test.sql` |
| 10 | `075-public-profiles-mask-unverified-portfolio.sql` | `075-…test.sql` |
| 11 | `076-delivery.sql` | `076-…test.sql` |
| 12 | `scripts/db/precheck-077.sql` (keep the output), then `077-database-integrity.sql` | `077-…test.sql`, `rls-coverage.test.sql`, `072-…test.sql` again |
| 13 | `078-ubunye-usage-reserve.sql` | `078-…test.sql` |
| 14 | `079-security-phase-6.sql` | `079-…test.sql`, `rls-coverage.test.sql` |
| 15 | `080-owner-pickup.sql` | `080-…test.sql`, `rls-coverage.test.sql` |
| 16 | `081-creative-tools-flag.sql` | |
| 17 | `082-verification-notifications.sql` | `082-…test.sql` (082 comes with the admin control room branch) |
| 18 | `084-embeddings-768.sql` | `084-…test.sql`, then POST `/api/admin/reindex` once `RAG_ENABLED=true` |
| 19 | `085-disputes-and-reviews-wiring.sql` | `085-…test.sql`. Apply with (or before) the build that writes `bookings.status_before_dispute` and `reviews.booking_id` (branch fix/audit-a-disputes-wiring); stops with a message if a booking already has two live disputes |
| 19b | `087-customer-engagement.sql` (needs 070) | `087-…test.sql`, `rls-coverage.test.sql`. Set `ENGAGEMENT_SIGNING_SECRET` and the VAPID keys on Vercel first; with `ENGAGEMENT_DRY_RUN=true` the daily run only logs |
| 20 | `notify pgrst, 'reload schema';` | `rls-coverage.test.sql` |

### Why 083 runs first although its number is last

083 holds the fixes the rehearsal found (F1 to F4). It does not depend on 067
to 082, and nothing in 067 to 082 recreates what it drops. Run first:

- 067's test passes (F1 closes the open read of ID documents);
- rls-coverage passes after 077, 079 and 080 (F3 pins `rls_auto_enable`);
- 077 E4 and E10 take effect on prod (F4 drops prod's names for the same
  open order and listing policies);
- F2 adds 035's `submitted_at` and indexes. Since #73 the code no longer
  reads or writes `submitted_at`, so F2 is only schema catch-up; it stays
  because it is harmless.

Run last, the end state is the same, but those tests fail on the way and the
holes stay open for the whole window. The file keeps the number 083 so no
existing file is renumbered. A local rebuild (`scripts/db/rebuild-local.sh`)
applies it after 082, where it changes nothing.

If 083 stops with "creator(s) have more than one live smart_productions row",
nothing in it was applied: resolve the duplicates, then run it again.

## 2b. After the release: 086 (database performance)

A separate step, any time after step 19 has run and been checked; it is not
needed for the launch. Same founder go as the rest.

| Step | Run | Then |
|---|---|---|
| 20 | `086-db-performance.sql` | `086-db-performance.test.sql`, `rls-coverage.test.sql` |

What it does (details in the file header): every ThabangVision policy calls
`auth.uid()`, `auth.jwt()`, `is_admin()` and `current_user_is_suspended()`
once per query instead of once per row, except `profiles`' three read
policies, which must stay as they are; the four no-op "Service role full
access" policies go; the chat and welcome admin reads use `is_admin()`, so a
suspended admin no longer reads every chat; 14 indexes are added and the
exact duplicates (and three covered indexes) dropped; `prune_log_retention()`
is created for the daily maintenance job.

- Expect NOTICE lines "no policy … here (the other database's name),
  skipped": the file lists both production's and dev's policy names.
- It stops (and applies nothing) if any rewritten policy would differ from
  the old one apart from the `(select …)` wrappers, or if a policy calling
  those functions per row is left. Send the output back rather than editing
  the file on the spot.
- Rehearsed on DEV 2026-10-13 with production's 25 differently named
  policies recreated in the same rolled-back transaction, then applied to DEV
  twice (the second run changes nothing).
- App: the build with daily maintenance step 17 (`lib/cron/retention.ts`)
  may go before or after. Before 086 that step logs one error per table and
  deletes nothing. Day counts: `STUDIO.retention` in `lib/constants.ts`.
- Rollback: the block at the bottom of the file.

## 2c. Security fixes: 088

From the security tests of 2026-10-13 (docs/security/2026-10-13-security-test.md).
Apply with (or before) the build that calls `phone_code_store` and
`phone_code_try`: that build cannot send or check phone codes without 088.

| Step | Run | Then |
|---|---|---|
| 21 | `088-security-fixes.sql` | `088-security-fixes.test.sql`, `087-customer-engagement.test.sql`, `rls-coverage.test.sql` |

pg_net's `net.http_*` stays executable by anon and authenticated: the
functions belong to `supabase_admin` and the `postgres` role cannot revoke
them. The `net` schema is not exposed by PostgREST.

## 2d. Drop-off PIN: 089

Apply BEFORE the build that reads `delivery_shipments.recipient_pin` (it
selects the column for every shipment, so without 089 delivery pages fail).

| Step | Run | Then |
|---|---|---|
| 22 | `089-delivery-recipient-pin.sql` | `089-delivery-recipient-pin.test.sql`, `rls-coverage.test.sql` |

## 3. Smoke test (maintenance bypass)

- sign up: a profile row is created and `net._http_response` gets a 2xx row;
- a gear checkout;
- a creator production submit;
- an admin opening an ID document;
- a normal user cannot open someone else's ID document.

## 4. Rollback: mostly fix forward

Once 067 is applied, rolling back the app alone is NOT safe:

- the old build's ID submit calls `submit_verification_request`, which 067
  revokes, so ID checks break;
- after 077 the old build shows busy creators as available (it lacks
  `getBusyCreatorIds`).

So promote the previous deployment only together with the database rollback
of the same migrations, and only where that rollback is still possible.
These can only be fixed forward:

- 070 once real bookings exist (its rollback drops the payment, ledger and
  payout tables);
- 076 once any delivery was dispatched;
- 068, 071, 073 and 074: their rollback blocks drop tables, so the rows
  written since (consents, payments, service history, agent actions) are lost;
- 082 has no rollback block (nor do 081 and 084, which are harmless to leave).

Otherwise roll back in reverse order with the block at the bottom of each
file. Never recreate "Admins view all verification docs". The rehearsal
report has the caveats per migration. For a wider problem: keep maintenance
on and restore from the backup or `prod-before-067.dump`.

## Follow ups that are not part of this release

- `Orders: buyer update` and `Orders: seller update` stay, because
  `app/api/orders/[id]/route.ts` still updates orders with the user's
  session. Move that route to the service role, then drop both policies.
- The signup webhook's last call on prod (2026-10-03) timed out. Diagnosed
  2026-10-13 (feature/customer-engagement): the URL and secret are right (the
  welcome was drafted 6.5 seconds after that signup, as for every signup since
  09-30), but pg_net gives up after its default 5 seconds while the route
  drafted with AI and sent the owner email before answering. The work finished;
  only the log said "timed out". Fixed in code: the route now answers 202 at
  once and works in `after()`. No migration needed.
- DEV drift: apply 083 on dev too (035's column and indexes are missing
  there as well). Separately, dev has `_tv_exec(text)`, a SECURITY DEFINER
  function that runs any SQL, and `submit_verification_request` is still
  executable by signed-in users there (re-run 067's revoke block on dev).
  Neither must reach prod.
