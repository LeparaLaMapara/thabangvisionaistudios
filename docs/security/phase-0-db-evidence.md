# Phase 0 — database lockdown evidence (migration 067)

**Status: Dev DB applied: NOT RUN.** On 2026-10-08 the integration owner
prepared to apply 067 to DEV (`bprargrqppufeuewryze`) through the Supabase
connector. The apply call was **cancelled before it executed**, so it was treated
as a decision not to change even the dev database in this run. No DEV or PROD
database was modified. Nothing here counts as verified on a Supabase project
until the founder (or an approved session) applies 067, 068 and 069 to DEV and
runs both test scripts.

Pre-apply state read from DEV (read-only, 2026-10-08) and matching PROD:
- `anon` and `authenticated` hold table-level INSERT/UPDATE/DELETE on `profiles`,
  `banking_details`, `reviews`, `subscriptions`, `subscription_plans`. Only RLS
  protects them.
- Storage policies on `verifications`: SELECT/INSERT/**UPDATE** (own folder). The
  bucket is private.
- `handle_new_user` inserts only `(id)` (DEV skips Multiversity users), so the
  INSERT-defaults rule in 067 cannot block sign-up.
- Privileged-column defaults match 067's allowed INSERT values exactly: `role='user'`,
  `is_verified=false`, `verification_status='unverified'`,
  `verification_attempts=0`, `verification_fraud_flags='[]'`, `no_show_count=0`,
  `is_suspended=false`, `crew_featured=false`.
- `subscriptions_status_check` = `active|cancelled|past_due|trialing|paused`, with
  no `pending`. Migration 069 fixes this.

The test SQL also ran, with all checks passing, on a throwaway **local**
PostgreSQL 16 with a Supabase stub (see the rehearsal notes below). That is
supporting evidence only, not a substitute for the DEV run.

**Run order on DEV:** `067-lock-sensitive-columns.sql`, then `068-consent-records.sql`,
then `069-subscription-expected-price.sql`. Then run
`067-lock-sensitive-columns.test.sql` and `068-consent-records.test.sql` (both
end in ROLLBACK).

**Prod: no migration.** The founder applies 067 to production after review, and
after the matching app code is deployed (see "Deploy order").

| Item | Value |
|---|---|
| Migration | `lib/migrations/067-lock-sensitive-columns.sql` |
| Test script | `lib/migrations/067-lock-sensitive-columns.test.sql` |
| Target project | DEV only (`bprargrqppufeuewryze`) — never production |
| Applied by / date | _TODO_ |
| Test run by / date | _TODO_ |
| Result | _TODO: "ALL 067 CHECKS PASSED" or the first FAIL line_ |

## 1. What 067 changes

- **Column privileges.** `INSERT`/`UPDATE` revoked from `anon`, `authenticated` (and `PUBLIC`) on `profiles`, `banking_details`, `reviews`; granted back only on an allow-list:
  - `profiles` UPDATE (and INSERT with `id`): `first_name, last_name, display_name, bio, avatar_url, avatar_public_id, skills, social_links, location, phone, street_address, city, province, postal_code, country, address_lat, address_lng, address_place_id, available_for_hire, hourly_rate, specializations, crew_bio, years_experience, portfolio_projects, onboarding_completed_at, popia_consent_at, popia_consent_version, marketing_opt_in, updated_at`.
  - `banking_details`: nothing. The banking route writes with the service role.
  - `reviews`: UPDATE `rating, comment` only; no client INSERT.
- **Triggers** (`profiles_guard_sensitive_columns`, `banking_guard_sensitive_columns`, `reviews_guard_ownership`). These reject untrusted changes to privileged, ownership and verified-name columns, and untrusted INSERTs whose privileged fields aren't at their defaults. SQLSTATE `42501`, with a hint of `tv_privileged_column`, `tv_ownership_column` or `tv_name_locked`.
- **Trusted callers** = `current_user in ('postgres','service_role','supabase_admin')`. That covers the service role and the `SECURITY DEFINER` RPCs owned by postgres.
- **`security_audit_log`.** Trusted changes to privileged columns are written here by AFTER triggers, with redacted values. RLS is on with no client policies. `service_role` gets SELECT and INSERT only.
- **Rejected attempts aren't logged in the database**, because they roll back. API routes log them to `platform_events` as `event_type = 'security_write_denied'`, with no personal data.
- **Policies.** The `reviews` and `banking_details` UPDATE policies gain `WITH CHECK`. The storage policy "Users can update own verification docs" is dropped, and the `verifications` bucket is forced private.
- **RPCs.** New: `submit_verification_for_user(uuid, …)`, callable by the service role only, with paths confined to the user's own folder. `submit_verification_request` can no longer be executed by clients.

## 2. Pre-apply snapshot (DEV)

Run the following before applying, and paste the output:

```sql
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('profiles','banking_details','reviews')
   and grantee in ('anon','authenticated')
 order by 1,2,3;

select grantee, table_name, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name in ('profiles','banking_details','reviews')
   and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE')
 order by 1,2,3,4;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where (schemaname = 'public' and tablename in ('profiles','banking_details','reviews'))
    or (schemaname = 'storage' and tablename = 'objects')
 order by 1,2,3;

select id, public from storage.buckets where id = 'verifications';

-- Dev vs prod drift check (prod list read separately, read-only)
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
 order by ordinal_position;
```

_TODO: paste output._

## 3. Apply (DEV)

_TODO: paste the NOTICE output of applying 067, especially the
"profiles UPDATE/INSERT granted to authenticated on: …" line and any
"allow-listed profiles columns not present (skipped)" line._

## 4. Post-apply snapshot (DEV)

_TODO: re-run the section 2 queries and paste the output._

## 5. Test run (DEV)

```
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/067-lock-sensitive-columns.test.sql
```

The script runs in one transaction ending in `ROLLBACK`, as two existing non-admin dev users.

Mapping of checks to the plan:

| Plan check | Script lines (NOTICE text) |
|---|---|
| Privileged INSERT rejected | `PASS: privileged INSERT …` |
| Privileged UPDATE rejected (T18) | `PASS: UPDATE profiles.<col> rejected` |
| Ownership reassignment rejected | `profiles.id`, `banking_details.user_id`, `reviews.reviewer_id/reviewee_id` |
| Normal profile edit succeeds | `PASS: legitimate profile edit …` |
| Service-role verification approval succeeds | `admin_approve_verification`, service-role update, `submit_verification_for_user` |
| Banking recipient/is_verified rejected (T19) | `PASS: UPDATE banking_details.<col> rejected` |
| Storage overwrite rejected; cross-user read/write rejected | `PASS: own verification object cannot be overwritten`, `cross-user storage …` |
| Anonymous access rejected | section 2 of the script |
| Verified name lock | `PASS: verified name change rejected …` |
| Defence in depth (triggers hold with a table-wide grant) | `PASS: [trigger] …` |
| Existing rows readable/updatable via allowed columns | `user can still read own banking row`, bio edits |

_TODO: paste the full output (all NOTICE lines and the final result row)._

## 6. Local rehearsal (not a Supabase project)

Before handover, the migration and test script were run against a throwaway
local PostgreSQL 16 with a minimal Supabase stub (roles `anon`,
`authenticated`, `service_role`, `supabase_admin`; `auth.uid()`/`auth.role()`
reading `request.jwt.claims`; `storage.buckets`/`storage.objects` with the 003
policies; `profiles` with every column from the repo migrations; 032, 033, 036,
043 and 063b applied). Results:

- 067 applied cleanly and re-applied cleanly (idempotent).
- The test script finished with `ALL 067 CHECKS PASSED`, every check PASS.
- The full profile-page payload, including a phone change, saves as `authenticated`; 063's guard still resets `phone_verified_at`.

This rehearsal does **not** replace the DEV run above. It cannot reproduce
Supabase's real storage triggers, grants or any dev/prod drift.

## 7. Deploy order and known effects

1. Deploy the app code first. `/api/verifications` falls back to the old RPC when `submit_verification_for_user` is missing, and `/api/banking` must write `banking_details` with the service role.
2. Then apply 067.
3. Applying 067 under an older build breaks two things: verification upload (it upserts at fixed paths and calls the old RPC) and the banking save (it writes through the user-session client).

## 8. Rejected-attempt logging

- **Where:** `platform_events`, with `event_type = 'security_write_denied'` and `event_category = 'security'`.
- **Fields:** metadata holds `{ route, table, code, hint }` and nothing else.
- **Routes that log it:** `POST /api/verifications`, `POST /api/onboarding` and `PUT /api/portfolio`.
- **Not covered:** the client-side profile page (`/dashboard/profile`) writes directly with the browser client. It shows the refusal message but cannot log server-side.

## 9. Rollback

See the commented ROLLBACK section at the bottom of the migration. The audit table is deliberately kept on rollback.
