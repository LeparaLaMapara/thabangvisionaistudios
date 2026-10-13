# October 2026 release: apply order for production

Production (`zbdsqvpxpsygbuqnuekm`) is at migration 066. This release takes it
to 083. Background and evidence: [2026-10-rehearsal-067-082.md](2026-10-rehearsal-067-082.md).
Nothing here runs without the founder's go.

Run every file as `postgres`, one at a time, and stop at the first error:

```bash
psql "$PROD_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "set lock_timeout='5s'" -c "set statement_timeout='120s'" -f <file>
```

Each migration is one transaction, so a failed file leaves nothing applied.
Each test ends in ROLLBACK. Keep all output.

## 0. Now, on its own: F1

Any signed-in user can read every ID document today. Run this alone, now,
before anything else in the release:

```sql
begin;
set local lock_timeout = '5s';
drop policy if exists "Admins view all verification docs" on storage.objects;
drop policy if exists "Users view own verification docs" on storage.objects;
drop policy if exists "Users upload own verification docs" on storage.objects;
commit;
```

Then treat it as a possible POPIA incident: check the storage logs for reads
of `verifications` objects by anyone other than their owner.

## 1. Before the database: app and env

1. Deploy the release build (it carries the phase 0 code 067 needs, the
   `getBusyCreatorIds` code 077 needs, and the Phase 5, 6 and 8 builds).
   Maintenance mode stays on.
2. Set on Vercel production:
   - `AGENT_APPROVAL_SECRET` (32 or more characters; without it Ubunye cannot approve anything)
   - `CONSENT_IP_HASH_SECRET` (without it consent IPs are hashed with plain SHA-256)
   - `PHONE_CODE_SECRET` (without it phone codes are hashed with the service role key)
   - `SMS_PROVIDER` and its keys, only if phone verification is live
3. Remove `VERCEL_TOKEN` from the production runtime env. The code never reads it.
4. Take a backup: Supabase dashboard backup from today, and
   `pg_dump "$PROD_DATABASE_URL" -Fc -f prod-before-067.dump`.

## 2. Migrations, in this order

| Step | Run | Then |
|---|---|---|
| 1 | `083-prerelease-fixes.sql` | `083-prerelease-fixes.test.sql` |
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
| 18b | `087-customer-engagement.sql` (needs 070) | `087-…test.sql`, `rls-coverage.test.sql`. Set `ENGAGEMENT_SIGNING_SECRET` and the VAPID keys on Vercel first; with `ENGAGEMENT_DRY_RUN=true` the daily run only logs |
| 19 | `notify pgrst, 'reload schema';` | `rls-coverage.test.sql` |

### Why 083 runs first although its number is last

083 holds the fixes the rehearsal found (F1 to F4). It does not depend on 067
to 082, and nothing in 067 to 082 recreates what it drops. Run first:

- 067's test passes (F1 closes the open read of ID documents);
- rls-coverage passes after 077, 079 and 080 (F3 pins `rls_auto_enable`);
- 077 E4 and E10 take effect on prod (F4 drops prod's names for the same
  open order and listing policies);
- creator production submit works as soon as the app is deployed (F2).

Run last, the end state is the same, but those tests fail on the way and the
holes stay open for the whole window. The file keeps the number 083 so no
existing file is renumbered. A local rebuild (`scripts/db/rebuild-local.sh`)
applies it after 082, where it changes nothing.

If 083 stops with "creator(s) have more than one live smart_productions row",
nothing in it was applied: resolve the duplicates, then run it again.

## 3. Smoke test (maintenance bypass)

- sign up: a profile row is created and `net._http_response` gets a 2xx row;
- a gear checkout;
- a creator production submit;
- an admin opening an ID document;
- a normal user cannot open someone else's ID document.

## 4. Rollback

Roll back in reverse order with the block at the bottom of each file,
usually together with the app build that came before it. Never recreate
"Admins view all verification docs". The rehearsal report has the caveats
per migration.

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
