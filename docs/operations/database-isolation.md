# Database isolation report (Phase 0, §6.9)

**Status: BLOCKED.** Isolation cannot be executed from this workstream. Two plans are written down: A (move the other apps out, §3–§5) and B (move ThabangVision into a new project built from the repo, §7). The Supabase connector can only see the `UAIE` organisation, not the new organisation the founder created. Nothing has been moved, deleted or rotated.

Everything below was gathered by read-only queries on 2026-10-06 and 2026-10-08.

## 1. Inventory: what shares ThabangVision's projects

### `thabangvision-prod` (`zbdsqvpxpsygbuqnuekm`, eu-west-2)

| Schema / tables | Owner app | Notes |
|---|---|---|
| `public` (~52 tables) | ThabangVision | Includes `profiles`, `banking_details`, the bookings tables, `verifications` storage and more |
| `public.apps`, `kb_documents`, `kb_chunks`, `kb_conversations`, `kb_messages`, `blog_comments`, `blog_subscribers` | Thabang Neural Observatory (`tmashininisekgoto`) | 61 KB docs. `anon` has table-level INSERT/UPDATE/DELETE grants, but RLS (no write policies) blocks them |
| `tutor` (60 tables) | Sekhoto Multiversity (tutor) | 112 learners. Usage granted to `service_role` only |
| `multiversity`, `multiversity_assessment`, `multiversity_ops` (38 tables) | Sekhoto Multiversity | **11 tables have foreign keys into `auth.users`**, the user list ThabangVision logins live in |

### `thabangvision-dev` (`bprargrqppufeuewryze`)
- The same mix as prod.
- The migration history also shows `trading_*`, `making_money_*`, `backhaul_*`, `palesa_portfolio_schema`, `shop_*` and `edu_*` migrations from other projects.

## 2. Why this is a risk (P0)
1. **One shared user list (`auth.users`).** Multiversity sign-ups become ThabangVision accounts. Both `on_auth_user_created` triggers (`handle_new_user`, `notify_signup`) fire for them.
2. **The service-role key is shared.** The other apps can only reach their schemas through `service_role`, so they hold ThabangVision prod's master key. That key bypasses all RLS (profiles, `banking_details`, verification storage).
3. **Generic object names collide** (`handle_new_user`, Vault secrets `signup_webhook_*`).
4. **POPIA s19 safeguards and disclosures** do not account for any of this.

## 3. Target state (agreed with the founder)

| Organisation | Plan | Project | Contents |
|---|---|---|---|
| UAIE | Pro | `thabangvision-prod` | ThabangVision only |
| UAIE | Pro | `multiversity-prod` (new) | Multiversity + tutor |
| New org | Free | `thabangvision-dev` | ThabangVision test data only |
| New org | Free | `multiversity-dev` | Multiversity testing |

**Observatory:** where it goes is still open (founder decision D-20 in the register).

## 4. Procedure (each step needs founder approval at execution time)
1. **Back up.** Take a full logical backup of prod (`pg_dump` of all schemas plus `auth` rows), and confirm it by restoring it into a scratch project.
2. **Inventory cross-references.** List every FK into `auth.users`, the triggers on `auth.users`, Vault secrets, storage buckets, webhooks (Paystack, signup), and the Vercel environment variables per project.
3. **Create `multiversity-prod`.** Restore the `tutor` and `multiversity*` schemas into it, plus the `auth.users` rows referenced by `multiversity.*` (10 users at last count). Their password hashes are preserved.
4. **Repoint the Multiversity and tutor Vercel projects** to the new URL and keys, and smoke-test them.
5. **Observatory.** Move it to its decided home and repoint its project.
6. **Drop the other apps' schemas and tables from ThabangVision prod.**
   - Use a *new* migration, `drop_foreign_schemas`, run only after step 4 is verified.
   - Remove `auth.users` rows that belong only to other apps (no ThabangVision activity), with their auto-created profiles.
7. **Rotate ThabangVision prod's JWT signing keys and API keys** in a controlled order:
   1. issue new keys;
   2. update the ThabangVision Vercel environment variables;
   3. redeploy;
   4. revoke the old keys.

   Also rotate `CRON_SECRET`, the signup-webhook secret and the e2e test password.
8. **Repeat for dev**, or recreate dev from ThabangVision migrations only.

## 5. Rollback
- **Before step 6:** do nothing, because the old schemas still exist. Point the apps back at the old URL and keys.
- **After step 6:** restore the dropped schemas from the step 1 backup.
- **After step 7:** keys can't be restored once revoked. Keep the old keys valid (do not revoke) until every app has been verified on its new keys.

## 6. What unblocks this
- Re-authorise the Supabase connector so it can see the new organisation. A dashboard session by the founder would also work.
- The founder decides where the Observatory goes.
- The founder approves a maintenance window. Production is already in maintenance mode.

## 7. Plan B: move ThabangVision to a new project of its own (step by step)

**Status: BLOCKED** on the same founder access as above (§6). Nothing here has
been executed. Written 2026-10-10, after Step 2 made the schema rebuildable
from the repo.

Plan A (§3–§5) keeps ThabangVision in `thabangvision-prod` and moves the
other apps out. Plan B does the opposite: ThabangVision moves into a **new,
empty** Supabase project built from this repo, and the old project is left
to the other apps. It is now practical because a database rebuilt from the
repo (`scripts/db/rebuild-local.sh`, migration 077) signs people up, takes
payments and passes every SQL test and end-to-end journey. Its advantages:
nothing of another app comes along (no shared `auth.users`, triggers, Vault
secrets or service-role key), and the old project stays untouched as the
rollback. Its cost: every ThabangVision user must sign in again (new JWT
secret), and storage objects must be copied.

Choose A or B with the founder (decision D-20 is related: where the
Observatory goes). Each step below needs founder approval at execution time.

### B1. Prepare (no downtime)
1. Create the project (`thabangvision-prod-2`, same region eu-west-2, Pro
   plan) in the organisation that will own it. Enable the extensions the
   schema uses: `pgcrypto`, `pg_net`, `vector` (in `extensions`).
2. Build the schema from the repo, in the canonical order
   ([docs/database/README.md](../database/README.md)): base schema,
   `lib/migrations` with the April files before 029, through the latest
   migration. `rebuild-local.sh` refuses remote hosts on purpose: apply the
   files with `psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f …` in the order that
   `scripts/db/rebuild-local.sh <local url> --list` prints, then run every
   `*.test.sql` and `rls-coverage.test.sql` against the new, still empty
   project. All must pass.
3. Auth settings, copied by hand from the old project: Site URL and redirect
   URLs, e-mail templates (with the 6-digit code, R-33), SMTP sender, rate
   limits, password policy, Google provider (same client id/secret; add the
   new `https://<new-ref>.supabase.co/auth/v1/callback` to the Google console
   **before** cutover).
4. Storage: create the private `verifications` bucket (067 does it if
   missing) and confirm its two policies.
5. Vault: `select public.set_signup_webhook('<url>', '<new secret>');` with a
   **new** webhook secret, and set the same secret in the app's environment
   for the new project.
6. Rehearse steps B2–B4 once end to end against a copy, then on a preview
   deployment pointed at the new project (`develop` env vars), with the
   local journeys (`tests/e2e-local`) as the checklist.

### B2. Freeze and back up (maintenance window starts)
1. Production is already in maintenance mode; keep it on. Pause the Vercel
   crons (or rotate `CRON_SECRET` so they fail closed) so nothing writes.
2. Note the time T0. Paystack keeps retrying webhooks it could not deliver,
   so payments made in the window are not lost; they are applied after the
   switch and reconciled in B5.
3. Full logical backup of the old project (all schemas plus `auth`), and a
   restore test into a scratch project (§4.1 of Plan A, same procedure).

### B3. Copy the data
1. **Which users.** ThabangVision users = rows of `public.profiles` whose
   `auth.users` row is not referenced by any `multiversity*`/`tutor` table,
   plus users referenced there who also have ThabangVision activity (any
   booking, equipment booking, listing, verification submission, consent,
   onboarding, payment). Produce both lists and have the founder approve
   the overlap.
2. **Auth users**, ids preserved: `pg_dump --data-only` of `auth.users` and
   `auth.identities` filtered to those ids (a `COPY (select …) TO` per table
   works), restored into the new project's `auth` schema as `postgres`.
   Password hashes (`encrypted_password`) and Google identities carry over;
   sessions and refresh tokens are **not** copied, so everyone signs in
   again. Insert `auth.users` with the signup trigger disabled
   (`set session_replication_role = replica;`) so `handle_new_user` and
   `notify_signup` do not fire; the profiles come in the next step.
3. **ThabangVision tables** (the list in
   [schema.md](../database/schema.md); not `apps`, `kb_*`, `blog_*`):
   `pg_dump --data-only --table=public.<t> …` from the old project, restored
   with `session_replication_role = replica` so the 067 guards, append-only
   triggers and audit triggers do not fire on historical rows. Then
   re-enable (`set session_replication_role = origin;`). Run 077's data note
   query (README "After 077") on the new project.
4. **Storage**: copy every object of the `verifications` bucket with a small
   script using both service keys (download from old, upload to new at the
   same path `<user id>/…`); compare object counts and sizes. Media is in
   Cloudinary and does not move.
5. **Checks** before switching: row counts per table equal; ledger balanced
   (`sum(debit_cents) = sum(credit_cents)`); `payment_reference_mismatches`
   empty; the invariant sweep run once by hand against the new project from
   a preview deployment; `rls-coverage.test.sql` passes.

### B4. Switch
1. In Vercel (production): set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` to the new
   project, and the new signup-webhook secret. The CSP already allows
   `https://*.supabase.co`. Redeploy.
2. Smoke test as a real person: sign in with e-mail code, password and
   Google; open the dashboard; add to cart; reach the Paystack page (test
   mode first if the founder allows); admin pages.
3. Re-enable crons. Leave maintenance mode when the founder says so.

### B5. After the switch
1. Reconcile Paystack payments made since T0 against `payment_events` /
   `rental_payment_intents` on the new project (the invariant sweep reports
   paid-but-not-confirmed).
2. Keep the old project unchanged and read-only for ThabangVision for at
   least 30 days (rollback). Then remove ThabangVision's tables and users
   from it with a reviewed migration, and **revoke the old project's keys for
   ThabangVision** (its service-role key stays with the other apps, which is
   now their concern only).
3. Rotate `CRON_SECRET`, the e2e test password (R-13) and any key that ever
   sat in the old project's shared environment.
4. Dev: create `thabangvision-dev` the same way, from the repo, with test
   data only.

### B6. Rollback
- **Before B4:** nothing to undo; drop the new project if wanted.
- **After B4, inside the window:** point the three Vercel variables back at
  the old project and redeploy. Writes made on the new project since the
  switch (sign-ups, bookings, payments) must be copied back by hand or
  replayed from Paystack; keeping maintenance mode on until B4.2 passes
  keeps this list empty.
- **After the old keys are revoked (B5.2):** no rollback to the old project;
  restore from the B2 backup into a fresh project instead.
