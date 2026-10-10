# Authentication and roles

How people sign in, how an auth user becomes a profile, which database roles
exist, where the app uses the service role, and who may execute each
SECURITY DEFINER function. The function list is generated from a local
rebuild at migration 077 (2026-10-10); the rest was written from the code.

## Signing in (Supabase Auth)

All in `app/(marketing)/login/page.tsx`, with the browser client
(`@/lib/supabase/client`):

| Method | Call | Notes |
|---|---|---|
| E-mail code or link (passwordless) | `signInWithOtp({ email, options: { emailRedirectTo: /auth/callback?next=… } })`, then `verifyOtp({ email, token, type: 'email' })` for the 6-digit code | Creates the account on first use. The hosted e-mail template carries only the link until risk R-33 is done |
| Password | `signInWithPassword` | Reset: `resetPasswordForEmail` → `/reset-password` → `updateUser({ password })` |
| Google | `signInWithOAuth({ provider: 'google', options: { redirectTo: /auth/callback?next=… } })` | |

`app/auth/callback/route.ts` exchanges the code for a session
(`exchangeCodeForSession`), cleans `next` (no open redirects,
`lib/auth/next-path.ts`) and sends a first-time person to `/welcome` for the
Terms. `/welcome` stores what they came to do as `user_metadata.intent`
(`rent`, `hire`, `list`, `supply`): user-editable, used only for routing and
wording, never for access.

Phone numbers are verified separately (`/api/phone/send`, `/api/phone/verify`,
hashed codes in `phone_codes`, 063); a client cannot set `phone_verified_at`
(`guard_phone_verified`).

## From auth user to profile

```
auth.users INSERT
  ├─ on_auth_user_created        → public.handle_new_user()   insert into profiles (id) on conflict do nothing
  └─ on_auth_user_created_notify → public.notify_signup()     POST {user_id} to the signup webhook (Vault secrets); never blocks sign-up
```

- `handle_new_user` (codified in 077 from production; 077 replaces the body
  only where it is missing or is the broken 006 body, and keeps any other,
  such as DEV's, which skips Multiversity users): SECURITY DEFINER,
  `search_path = public, pg_temp`, EXECUTE revoked from `public`, `anon`,
  `authenticated`. It inserts only the id, so every other column takes its
  default, which is exactly what 067's INSERT rule requires (`role = 'user'`,
  unverified, not suspended, no fraud flags). The repo's older body (006)
  also copied the e-mail into `profiles.email`, a column 048 drops, so a
  database rebuilt from the repo could not sign anyone up until 077.
- In production `auth.users` is shared with other apps, so their sign-ups
  also get a ThabangVision profile and welcome flow
  ([database-isolation.md](../operations/database-isolation.md)). 077 creates
  the trigger only when it is missing and warns, without replacing it, if it
  calls something else.

## Database roles

| Role | Who | RLS | What it may do |
|---|---|---|---|
| `anon` | any request with the public key and no session | applies | Read what public policies allow (published catalogue, flags, `public_profiles`, published reviews without `reviewer_email`). No table writes since 077. Executes `is_admin()` (policies need it), `busy_creator_ids()` and the non-definer helpers |
| `authenticated` | a signed-in user (JWT) | applies | Own rows per policy; `profiles` UPDATE only on 067's column allow-list; cart, consent, bug reports, onboarding progress, portfolio analysis, notification read state. Money tables are read-only (059) |
| `service_role` | the server (`createAdminClient()`, `SUPABASE_SERVICE_ROLE_KEY`) | **bypassed** | Everything. Every route that uses it must authenticate and authorise the user itself |
| `postgres` | migrations, SQL editor; owner of every function | bypassed (owner) | 067 treats it (and `service_role`, `supabase_admin`) as a trusted caller for privileged columns |
| `supabase_auth_admin`, `authenticator`, `supabase_admin` | Supabase internals | — | not used by the app |

## Admins

An admin is an ordinary account promoted by hand (or by
`/api/admin/users/[id]/role`, which writes both places):

1. JWT `app_metadata.role = 'admin'` (`auth.users.raw_app_meta_data`, set
   with the Auth admin API; only the service role can change it);
2. `profiles.role = 'admin'` (a client cannot change `role`: 067);
3. `ADMIN_EMAILS` in `lib/constants.ts`: a break-glass e-mail list checked
   against the session's e-mail **in API routes only**
   (`lib/auth/supabase.ts`). It does not check `email_confirmed_at` (audit
   D6, still open: recommendation R-71).

`requireAdmin()` (API routes) checks all three; `is_admin()` (RLS and the
admin RPCs) checks 1 and 2. The `(admin)` layout redirects non-admins.
077 made `is_admin()` return false instead of failing when
`request.jwt.claims` is an empty string.

## Where the service role is used

`createAdminClient()` appears in about 120 files. By area:

| Area | Why |
|---|---|
| `app/api/admin/*` (30 files), `app/(admin)` pages | admin reads/writes across users, after `requireAdmin()` |
| Payments: `app/api/webhooks/*`, `lib/payments/*`, `lib/rental/*`, `app/api/cart/checkout`, `mark-paid` | money rows clients may not write (059); webhooks have no user session |
| Crons: `app/api/cron/*`, `lib/cron` | no user session |
| Service bookings, disputes, rentals, delivery (`app/api/service-bookings`, `app/api/disputes`, `app/api/rentals`, `lib/delivery`) | state transitions through RPCs executable by `service_role` only |
| `app/api/banking`, `app/api/verifications`, `app/api/onboarding/complete`, `app/api/phone` | privileged columns (067) and secrets |
| Ubunye / agents (`lib/agents`, `lib/agent`, `app/api/agents`, `app/api/search` RAG) | usage counters, token accounting, agent actions |
| Analytics and ops (`lib/analytics`, `lib/demand`, `lib/features.ts`, `app/sitemap.ts`) | write-only telemetry tables; cached flag reads |

## Sessions

- `proxy.ts` (Next.js 16's middleware) refreshes the Supabase session on
  every request (`auth.getUser()`), redirects signed-out visitors of
  `/dashboard/*` to `/login?next=…`, and rejects cross-origin mutation
  requests to `/api/*` (CSRF Origin check; webhooks exempt).
- `providers/AuthProvider.tsx` bridges the server-resolved session to the
  client (no auth flicker) and signs the person out after
  `STUDIO.session.idleTimeoutMinutes` (30) without activity
  (`/login?reason=idle`).
- Sessions live in Supabase's cookies; nothing auth-related is kept in
  `localStorage`/`sessionStorage`.

## SECURITY DEFINER functions

Every one pins `search_path` (ending in `pg_temp` since 077). "Executable by"
is `has_function_privilege` for the three API roles; trigger functions run
only as triggers whatever their grants.

| Function | Returns | search_path | Executable by |
|---|---|---|---|
| `admin_approve_verification(uuid,text)` | jsonb | `public, pg_temp` | authenticated, service_role |
| `admin_get_verification(uuid)` | jsonb | `public, pg_temp` | authenticated, service_role |
| `admin_list_verifications()` | jsonb | `public, pg_temp` | authenticated, service_role |
| `admin_reject_verification(uuid,text)` | jsonb | `public, pg_temp` | authenticated, service_role |
| `agent_actions_supersede()` | trigger | `public, pg_temp` | service_role |
| `busy_creator_ids(uuid[])` | uuid | `public, pg_temp` | anon, authenticated, service_role |
| `caller_owns_rental(uuid)` | boolean | `public, pg_temp` | authenticated, service_role |
| `claim_delivery_provider_events(integer,integer)` | delivery_provider_events | `public, pg_temp` | service_role |
| `claim_outbox(integer,integer)` | notification_outbox | `public, pg_temp` | service_role |
| `claim_payment_events(integer,integer)` | payment_events | `public, pg_temp` | service_role |
| `confirm_manual_payment(uuid,text,uuid)` | jsonb | `public, pg_temp` | service_role |
| `confirm_rental_payment(text,text,integer,boolean,jsonb,jsonb)` | text | `public, pg_temp` | service_role |
| `delivery_apply_transition(jsonb)` | text | `public, pg_temp` | service_role |
| `delivery_cancelled_orders_to_settle(integer)` | uuid | `public, pg_temp` | service_role |
| `delivery_claim_dispatch(uuid,text[],timestamp with time zone,timestamp with time zone)` | boolean | `public, pg_temp` | service_role |
| `delivery_create_shipment(jsonb,jsonb)` | jsonb | `public, pg_temp` | service_role |
| `delivery_insert_fee_refund(jsonb,uuid,jsonb)` | integer | `public, pg_temp` | service_role |
| `delivery_is_renter(uuid)` | boolean | `public, pg_temp` | authenticated, service_role |
| `delivery_list_awaiting_acceptance(timestamp with time zone,integer)` | uuid | `public, pg_temp` | service_role |
| `delivery_mark_quote_paid(uuid,text[],text,text,uuid)` | boolean | `public, pg_temp` | service_role |
| `delivery_note_cancelled_order(uuid,text)` | void | `public, pg_temp` | service_role |
| `delivery_open_incident(jsonb,jsonb)` | boolean | `public, pg_temp` | service_role |
| `delivery_owns_all(uuid,uuid[])` | boolean | `public, pg_temp` | authenticated, service_role |
| `delivery_owns_any(uuid,uuid[])` | boolean | `public, pg_temp` | authenticated, service_role |
| `delivery_post(jsonb,jsonb)` | void | `public, pg_temp` | service_role |
| `delivery_redact_address(uuid,jsonb,timestamp with time zone)` | boolean | `public, pg_temp` | service_role |
| `delivery_refund_quote(jsonb)` | text | `public, pg_temp` | service_role |
| `delivery_save_reconciliation(jsonb,jsonb,jsonb)` | boolean | `public, pg_temp` | service_role |
| `expire_rental_holds()` | integer | `public, pg_temp` | service_role |
| `handle_new_user()` | trigger | `public, pg_temp` | service_role |
| `increment_conversation_message_count()` | trigger | `public, pg_temp` | service_role |
| `increment_faq_view(uuid)` | void | `public, pg_temp` | service_role |
| `is_admin()` | boolean | `public, pg_temp` | anon, authenticated, service_role |
| `ledger_post(jsonb)` | boolean | `public, pg_temp` | service_role |
| `log_feature_flag_change()` | trigger | `public, pg_temp` | service_role |
| `notify_signup()` | trigger | `public, extensions, vault, pg_temp` | service_role |
| `open_return_dispute(uuid,uuid,text,jsonb,text)` | uuid | `public, pg_temp` | service_role |
| `outbox_enqueue(jsonb)` | integer | `public, pg_temp` | service_role |
| `payout_transition(uuid,text[],text,jsonb,jsonb,jsonb)` | boolean | `public, pg_temp` | service_role |
| `profile_is_creator(profiles)` | boolean | `public, pg_temp` | anon, authenticated, service_role |
| `rate_limit_hit(text,integer,integer)` | boolean | `public, pg_temp` | service_role |
| `rate_limits_prune(integer)` | integer | `public, pg_temp` | service_role |
| `record_failed_payment_attempt(text)` | void | `public, pg_temp` | service_role |
| `record_unallocated_payment(text,text,integer,text,text,jsonb,jsonb,jsonb)` | text | `public, pg_temp` | service_role |
| `refund_obligations_cap()` | trigger | `public, pg_temp` | service_role |
| `refund_transition(uuid,text[],text,jsonb,jsonb,jsonb)` | boolean | `public, pg_temp` | service_role |
| `rental_units_blocked(uuid,date,date,uuid)` | integer | `public, pg_temp` | service_role |
| `reserve_rental_order(jsonb,jsonb,integer)` | jsonb | `public, pg_temp` | service_role |
| `set_signup_webhook(text,text)` | void | `public, vault, pg_temp` | service_role |
| `submit_verification_for_user(uuid,text,text,text,jsonb,jsonb,text,text,text)` | jsonb | `public, pg_temp` | service_role |
| `submit_verification_request(text,text,text,jsonb,jsonb,text,text,text)` | jsonb | `public, pg_temp` | service_role |
| `transition_rental_booking(uuid[],text[],text,text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)` | integer | `public, pg_temp` | service_role |

Notes:

- `admin_*` verification RPCs are callable by `authenticated` but start with
  `if not is_admin() then raise`, so only admins get past the first line.
- `profile_is_creator(profiles)` (077) is SECURITY DEFINER and executable
  by anon so `public_profiles` answers the same for every reader (an
  anonymous reader cannot see the unpublished production created at the end
  of creator onboarding). It returns one boolean about the row it is given.
  Its signals: specializations, creator bio, portfolio projects, featured,
  or a production made for the person; never `onboarding_completed_at`.
- `busy_creator_ids(uuid[])` (077) is executable by anon on purpose:
  Ubunye's creator search runs as the visitor and only needs to know which
  of up to 100 creators have an active crew request. It returns ids only.
- `delivery_is_renter`, `delivery_owns_any`, `delivery_owns_all` and
  `caller_owns_rental` are policy helpers (they read tables the caller's own
  RLS would hide) and answer only about `auth.uid()`.
- Everything else that moves money or state (`reserve_rental_order`,
  `confirm_rental_payment`, `ledger_post`, `delivery_*`, `refund_transition`,
  `payout_transition`, …) is `service_role` only.
