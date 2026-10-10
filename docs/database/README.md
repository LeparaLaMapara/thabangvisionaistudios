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
transaction ending in ROLLBACK) and prints PASS/FAIL per file, with an
optional name filter (`… 077`).

**Both scripts refuse any host that is not `localhost`, `127.0.0.1` or
`::1`** (`scripts/db/local-guard.sh`). They are not a way to reach dev or
production.

On 2026-10-10 a rebuild from empty applied 84 files and all 11 test files
passed (226 checks): 067 (70), 068 (11), 070 (28), 071 (2), 072 (28), 073
(10), 074 (4), 075 (3), 076 (32), 077 (30), rls-coverage (8). The 50 local
end-to-end journeys (`tests/e2e-local`) passed on that database with no
shims.

## Applying migrations to dev or production by hand

Production has 001–066 applied; **067–077 are applied nowhere yet**. Apply
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
| 11 | `077-database-integrity.sql` | `077-…test.sql`, then `rls-coverage.test.sql` | Snapshot first (below). Keep the NOTICE output: it lists rewritten payment rows, authenticated grants revoked, and non-creators marked available for hire |
| 12 | — | `notify pgrst, 'reload schema';` | 077 does this itself |

Any time later: `rls-coverage.test.sql` after every new migration.

### Before applying 077 to dev or production

077 is written to be a no-op where production already differs (it drops
policies by the base schema's names, revokes only grants no policy uses, and
creates the signup trigger only if it is missing). Still, take this read-only
snapshot first and keep it with the evidence:

```sql
-- 1. Other apps' tables in public. 077 skips apps, kb_*, blog_* by name; add any
--    other non-ThabangVision table here to _tv077_foreign at the top of 077.
select tablename from pg_tables where schemaname = 'public' order by 1;

-- 2. Policies and grants 077 touches.
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
 where schemaname = 'public'
   and tablename in ('profiles','crew_requests','orders','listings','content_embeddings',
                     'onboarding_progress','portfolio_analysis','reviews') order by 1, 2;
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated') order by 2, 1, 3;

-- 3. The signup trigger and its function.
select tgname, tgfoid::regprocedure from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
select pg_get_functiondef('public.handle_new_user'::regproc);

-- 4. Payment rows that will be rewritten, and the current CHECK.
select status, count(*) from public.booking_payments group by 1;
select pg_get_constraintdef(oid) from pg_constraint where conname = 'booking_payments_status_check';

-- 5. Who public_profiles lists today and will list after 077.
select count(*) as listed_now from public.public_profiles;
select count(*) as non_creators_available_for_hire
  from public.profiles p
 where p.available_for_hire and p.onboarding_completed_at is null
   and coalesce(cardinality(p.specializations), 0) = 0
   and nullif(btrim(coalesce(p.crew_bio, '')), '') is null
   and not coalesce(p.crew_featured, false)
   and jsonb_array_length(coalesce(p.portfolio_projects, '[]'::jsonb)) = 0;
```

Deploy order for 077: none required. The one app change that goes with it
(`lib/supabase/queries/creatorReviews.ts` prefers the name stored on the
review) works before and after.

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
