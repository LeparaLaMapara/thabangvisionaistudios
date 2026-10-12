# Database

ThabangVision's data lives in Supabase Postgres. This folder describes it as
the repo builds it.

| Document | What it covers |
|---|---|
| [schema.md](schema.md) | Every table and view in `public`: purpose, domain, key columns, keys and checks, the migration that created it, money in cents or rands |
| [auth-and-roles.md](auth-and-roles.md) | Sign-in methods, the `auth.users` → `profiles` trigger, database roles, admins, where the service role is used, every SECURITY DEFINER function and who may execute it, sessions |
| [access-control.md](access-control.md) | RLS / policy / grant matrix for every table, and every flagged item (fixed by 077 or still open) |
| [../operations/database-isolation.md](../operations/database-isolation.md) | Why production is shared with other apps, and the step-by-step plans to separate them (BLOCKED) |

The facts in `schema.md`, `access-control.md` and the function list were
generated from a local database rebuilt from this repo at migration 077, on
2026-10-10. Production has migrations up to 066 and may have drifted (audit
finding D4); check before relying on a detail there.

## The migrations and their order

There is no automatic runner. Migrations are SQL files applied by hand, in
this order:

1. `supabase/migrations/20260311000000_base_schema.sql`: the original tables.
2. `lib/migrations/NNN-*.sql` in name order (`LC_ALL=C`). Where two files
   share a number (001, 022, 032, 033) both run, in name order. 034 does not
   exist.
   - **Skip `001-pgvector-openai.sql`**: it is the 1536-dimension
     alternative to `001-pgvector-gemini.sql`; only one may run.
   - **Skip every `*.test.sql`**: those are tests.
3. **Before 029**, the four April migrations that exist only in
   `supabase/migrations/`: `20260411000001_user_suspension.sql`,
   `20260411000002_gear_return.sql`, `20260411000003_onboarding.sql`,
   `20260411000004_disputes.sql`. 029 alters `onboarding_progress`, which the
   third one creates; later migrations use suspension, return and dispute
   columns.

The other files in `supabase/migrations/` (`2026031*`, `2026032*`) are older
copies of `lib/migrations` 001–026 and are **not** applied.

`scripts/db/rebuild-local.sh <url> --list` prints the exact order.

## Rebuilding a local database

Needs Docker and the Supabase CLI (see
[tests/e2e-local/README.md](../../tests/e2e-local/README.md) §1).

```bash
supabase db reset                     # in the local Supabase folder: an empty Supabase
scripts/db/rebuild-local.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
scripts/db/run-sql-tests.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`rebuild-local.sh` stops at the first failing file, takes `--through NNN` to
stop after a migration, refuses to run over an existing schema unless given
`--allow-existing`, and asks PostgREST to reload its schema at the end.
`run-sql-tests.sh` runs every `lib/migrations/*.test.sql` (each in one
transaction ending in ROLLBACK), then the shell tests `scripts/db/*.test.sh`
(`local-guard.test.sh`: the host guard; `077-reapply.test.sh`: re-applies 077
over foreign tables and functions, odd signup bodies and a differently named
CHECK, then restores the 077 state), and prints PASS/FAIL per file, with an
optional name filter (`… 077`).

**Both scripts refuse any host that is not `localhost`, `127.0.0.1` or
`::1`**, and any URL or `PGHOST` that lists several hosts
(`scripts/db/local-guard.sh`). They are not a way to reach dev or
production.

On 2026-10-10 a rebuild from empty applied 84 files and all 13 test files
passed: 229 SQL checks (067: 70, 068: 11, 070: 28, 071: 2, 072: 28, 073: 10,
074: 4, 075: 3, 076: 32, 077: 33, rls-coverage: 8) plus 8 re-apply and 12
host-guard checks. The 50 local end-to-end journeys (`tests/e2e-local`)
passed on that database with no shims.

## Applying migrations to dev or production by hand

Production has 001–066 applied; **067–080 are applied nowhere yet**. Apply
them to DEV first, in order, each followed by its test, and record the output
in the evidence documents ([phase-0](../security/phase-0-db-evidence.md),
[phase-1](../security/phase-1-db-evidence.md)). Production only after the
founder approves, in the same order, after the matching app code is deployed
where a migration says so.

```bash
export DEV_DATABASE_URL=...        # from the Supabase dashboard of the DEV project; never production's
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/<file>.sql
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/<file>.test.sql
```

(or paste each file into the SQL editor of the project). Every test ends in
ROLLBACK and creates its own throwaway users and rows.

**083 runs first on production.** `083-prerelease-fixes.sql` (then its
test) holds the fixes the October rehearsal found on a copy of production:
a hand-made storage policy that let any signed-in user read every ID
document, 035's `smart_productions.submitted_at` and indexes, the
`rls_auto_enable()` search path, and production's names for the policies
077 E4/E10 drop. On production run it before step 1 below; on DEV run it
whenever (it is a no-op apart from 035's objects). Locally it runs after 082
in name order and changes nothing. Full production order:
[docs/release/2026-10-apply-order.md](../release/2026-10-apply-order.md).

| Step | Migration | Then run | Notes |
|---|---|---|---|
| 1 | `067-lock-sensitive-columns.sql` | `067-…test.sql` | Deploy the app code first (phase-0 §7) |
| 2 | `068-consent-records.sql` | `068-…test.sql` | |
| 3 | `069-subscription-expected-price.sql` | — | |
| 4 | `070-gear-pipeline.sql` | `070-…test.sql`, then `DATABASE_URL=… scripts/db/070-concurrency.sh` | The concurrency script commits and deletes its own fixtures |
| 5 | `071-provider-neutral-payments.sql` | `071-…test.sql` | |
| 6 | `072-listing-review.sql` | `072-…test.sql` | Needs 077 (or the claims fix in it) for the test's empty-claims check; run 072's test again after step 11 if it fails only there |
| 7 | `073-service-fulfilment.sql` | `073-…test.sql` | |
| 8 | `074-agent-actions.sql` | `074-…test.sql` | |
| 9 | `075-public-profiles-mask-unverified-portfolio.sql` | `075-…test.sql` | |
| 10 | `076-delivery.sql` | `076-…test.sql` | |
| 11 | `077-database-integrity.sql` | `077-…test.sql`, then `rls-coverage.test.sql` | **Deploy the app first** (the build with `getBusyCreatorIds`, see "Deploy order for 077"). Run `scripts/db/precheck-077.sql` first (below). Keep the NOTICE output: it lists rewritten payment rows, dropped CHECKs, authenticated grants revoked, objects left untouched, and non-creators marked available for hire |
| 12 | `078-ubunye-usage-reserve.sql` | `078-…test.sql`, then `scripts/db/078-concurrency.test.sh` (local only) | Atomic Ubunye message slots (D-68). Apply with the Phase 5 build: without it that build answers signed-in messages without counting them (logged); the older build keeps working with it |
| 13 | `079-security-phase-6.sql` | `079-…test.sql`, then `rls-coverage.test.sql` | Phase 6 security (docs/security/phase-6-assessment.md): `is_admin()` trusts `profiles.role` over a stale JWT, `admin_revoke_user_sessions()`, suspended accounts cannot write cart/banking/reviews, no `<`/`>` in names and places. Independent of the app build (the Phase 6 build calls `admin_revoke_user_sessions`; without 079 the role/suspend routes still work and report `sessions_revoked: false`). On a hosted project, check the test's B2 passes: the function needs DELETE on `auth.sessions` as its owner |
| 14 | `080-owner-pickup.sql` | `080-…test.sql`, then `rls-coverage.test.sql` | Phase 8: collection from the owner's address (owner_pickup addresses, `origin_owner_id` on quotes and legs, one live leg per order + leg + origin, `listing_private.owner_pickup`, owner notification types). **Apply with (or before) the Phase 8 build**: that build reads `origin_owner_id`. Older builds keep working on an 080 database (every leg is the studio). Do not re-run 076 after 080 once an owner leg exists (076 would put back the one-leg-per-order index, the per-order cancelled-order sweep and the table-wide `delivery_quotes` grant); re-run 080 after any re-run of 076. The Phase 8 build also calls 080's `delivery_save_owner_pickup` and `delivery_remove_owner_pickup` |
| 15 | — | `notify pgrst, 'reload schema';` | 077–080 do this themselves |

Any time later: `rls-coverage.test.sql` after every new migration.

### Before applying 077 to dev or production

Run the read-only pre-checks and keep the output with the evidence:

```bash
psql "$DEV_DATABASE_URL" -X -f scripts/db/precheck-077.sql > precheck-077.out
```

[`scripts/db/precheck-077.sql`](../../scripts/db/precheck-077.sql) writes
nothing (a READ ONLY transaction, rolled back). Each query says which result
means **STOP**. It covers: the current `handle_new_user` body and whether 077
will keep, replace or create it; triggers on `auth.users`; SECURITY DEFINER
functions with an empty or missing `search_path` or another owner; tables in
`public` that are not on 077's ThabangVision list; every CHECK on
`booking_payments` (by table, not by name) and the status values in use;
write policies anon can reach that depend on nothing; `public_profiles`'
columns against 075's; and long-running transactions.

What 077 does with what it finds:

- `handle_new_user` is replaced only if it is missing or is the broken 006
  body (inserts `profiles.email`). Production's and DEV's bodies are kept.
- Grants (E5) and function hygiene (E6) touch only ThabangVision's own
  tables and functions (explicit lists at the top of 077), and only
  functions owned by the role applying it. Anything else is named in a
  NOTICE and left alone.
- Every CHECK on `booking_payments` that mentions `status` is dropped,
  whatever its name, before the new one is added.

**If 077 times out.** It sets `lock_timeout = 5s` and
`statement_timeout = 120s`, so on a busy database it may stop with
"canceling statement due to lock timeout" (or "statement timeout"). Nothing
is applied in that case: the whole file is one transaction. Check query 8 of
the pre-checks for long transactions, then apply again off-peak. Do not raise
the timeouts on production without the integration owner.

**Deploy order for 077: APP FIRST, then 077.** Deploy the app build that
contains `getBusyCreatorIds()` (`lib/supabase/queries/crew.ts`, used by
`lib/agents/tools/search.ts` and `booking.ts`) before applying 077 to that
environment. That build calls `busy_creator_ids()` and falls back to the old
direct read of `crew_requests` while the function does not exist, so it is
correct on both sides of the migration. The OLD build reads `crew_requests`
directly with the visitor's session; after 077 (E2) that read silently
returns no rows, so Ubunye would show every busy creator as available.
`creatorReviews.ts` (the stored reviewer name first) also ships in that
build and works before and after 077.

### After 077: people the old approval made "available for hire"

Before 077, approving any ID check turned on `available_for_hire` and gave a
crew slug to anyone with a display name, renters included. 077 stops that
for new approvals and removes those people from `public_profiles`, but does
**not** change their rows: the booking routes check `profiles` directly
(verified, available, not suspended), so they can still be booked by id. The
apply prints how many there are. Switching them off is a business decision
(D-65); when approved:

```sql
-- Review the list first.
select id, display_name, crew_slug, verification_reviewed_at from public.profiles p
 where p.available_for_hire and not public.profile_is_creator(p);
-- Then, in one transaction:
update public.profiles p set available_for_hire = false
 where p.available_for_hire and not public.profile_is_creator(p);
```

## Regenerating these documents

The generated sections came from these queries against a fresh local
rebuild (scripts kept out of the repo; the queries are what matter):

```sql
-- tables, views, RLS state, comments
select c.relname, c.relkind, c.relrowsecurity, c.reloptions, obj_description(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p','v','m');
-- columns
select table_name, column_name, data_type, udt_name, is_nullable, column_default
  from information_schema.columns where table_schema = 'public';
-- keys and checks
select conrelid::regclass, conname, contype, pg_get_constraintdef(oid), confrelid::regclass
  from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p','f','u','c');
-- policies and grants
select * from pg_policies where schemaname = 'public';
select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC');
select table_name, grantee, privilege_type, column_name from information_schema.column_privileges
 where table_schema = 'public' and grantee in ('anon','authenticated');
-- functions
select p.oid::regprocedure, p.prosecdef, p.proconfig, p.prorettype::regtype,
       has_function_privilege('anon', p.oid, 'execute'),
       has_function_privilege('authenticated', p.oid, 'execute'),
       has_function_privilege('service_role', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
```

"Created by" is the first file, in the canonical order, with a
`create table` / `create view` for the name.
