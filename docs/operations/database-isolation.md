# Database isolation report (Phase 0, §6.9)

**Status: BLOCKED.** Isolation cannot be executed from this workstream. The Supabase connector can only see the `UAIE` organisation, not the new organisation the founder created. Nothing has been moved, deleted or rotated.

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
