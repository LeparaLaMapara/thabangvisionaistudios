-- 067 — Lock sensitive columns (Phase 0, WS2: "lock the doors in the database")
--
-- WHY
-- On live production (read 2026-10-08) the `authenticated` role can UPDATE
-- profiles.role, id_document_hash, verification_fraud_flags and
-- selfie_with_id_path. The "Profiles: owner update safe" WITH CHECK (036)
-- only freezes six columns. banking_details lets a user rewrite is_verified,
-- paystack_recipient_code and account_holder (its UPDATE policy has no WITH
-- CHECK). reviews can be re-pointed at another reviewee. The verification
-- bucket lets a user overwrite a document after it was checked.
--
-- WHAT THIS DOES (three layers, each enough on its own for the common case)
--   1. Column privileges. INSERT/UPDATE are revoked table-wide from anon and
--      authenticated, then UPDATE is granted back on an explicit allow-list of
--      columns a person legitimately edits about themselves. A column not on
--      the list (including any column added later) is NOT writable by clients.
--   2. Triggers (defence in depth). BEFORE INSERT/UPDATE triggers reject, for
--      untrusted callers, changes to privileged columns, changes of ownership
--      columns, a verified person's legal name, and INSERTs whose privileged
--      fields are not at their defaults. They still hold if someone later
--      re-adds a table-wide GRANT by mistake.
--   3. Policies. reviews and banking_details UPDATE policies gain WITH CHECK;
--      the verification-document UPDATE (overwrite) storage policy is dropped.
--
-- WHO IS "TRUSTED"
-- current_user in ('postgres', 'service_role', 'supabase_admin'):
--   * service_role  — server routes using createAdminClient().
--   * postgres      — SECURITY DEFINER RPCs owned by postgres
--                     (admin_approve_verification, admin_reject_verification,
--                     submit_verification_for_user below, handle_new_user),
--                     and the SQL editor.
--   * supabase_admin — dashboard table editor / platform maintenance.
-- This deliberately differs from guard_phone_verified (063), which keys on
-- auth.role(): inside a SECURITY DEFINER function auth.role() still reports the
-- caller's JWT role ('authenticated'), whereas current_user is the function
-- owner. The RPCs above are the sanctioned, purpose-scoped write paths, so they
-- must pass. The trigger functions themselves are SECURITY INVOKER on purpose,
-- otherwise current_user would always be their owner.
--
-- AUDIT
-- Trusted changes to privileged columns are written to security_audit_log by
-- AFTER triggers, with values REDACTED except for non-personal flags/statuses.
-- REJECTED attempts are NOT logged here: the rejecting statement's transaction
-- rolls back and would take the log row with it. API routes that catch a
-- denial (SQLSTATE 42501) log it through logEvent() -> platform_events, which
-- is a separate statement on a separate connection.
--
-- VERIFICATION SUBMISSION
-- submit_verification_request (032) took paths, fraud flags and the ID hash
-- from the caller and was executable by any signed-in user over
-- /rest/v1/rpc, so a user could skip the face match, clear their own fraud
-- flags, or point their submission at a path in another user's folder. It is
-- replaced by submit_verification_for_user, executable by service_role only
-- and validating that every path is inside the subject's own folder. The old
-- function is kept (for rollback) but no longer executable by clients.
--
-- DEPLOY ORDER: deploy the matching app code FIRST, then apply this file.
-- The new /api/verifications code falls back to the old RPC when the new one
-- does not exist yet, so it works on both sides of the migration; the OLD
-- build's verification upload (upsert at fixed paths + old RPC) stops working
-- once this is applied. The banking save route must write with the service
-- role (app/api/banking/route.ts) before this is applied.
--
-- Idempotent: safe to re-run. Rollback: see the bottom of the file.
-- Tests: lib/migrations/067-lock-sensitive-columns.test.sql (run on DEV only).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. security_audit_log
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.security_audit_log (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor           uuid,                 -- auth.uid() of the caller, null for pure service-role calls
  actor_role      text,                 -- JWT role claim ('service_role', 'authenticated' via an RPC, null in SQL editor)
  db_role         text not null default current_user,  -- effective database role that made the write
  table_name      text not null,
  row_id          text,
  operation       text not null,        -- INSERT | UPDATE
  column_name     text not null,
  change_summary  jsonb not null default '{}'::jsonb   -- redacted: no raw personal data
);

create index if not exists idx_security_audit_log_row
  on public.security_audit_log (table_name, row_id, occurred_at desc);
create index if not exists idx_security_audit_log_occurred
  on public.security_audit_log (occurred_at desc);

alter table public.security_audit_log enable row level security;
-- No client policies at all: RLS on + no policy = no rows for anon/authenticated.
revoke all on public.security_audit_log from public, anon, authenticated, service_role;
-- The server (and the triggers when running as service_role) may append and
-- read. Nobody but the owner (postgres) may UPDATE, DELETE or TRUNCATE.
grant select, insert on public.security_audit_log to service_role;

comment on table public.security_audit_log is
  'Trusted (service-role / definer RPC) changes to privileged columns on profiles and banking_details. Values are redacted except non-personal flags. Rejected client attempts are NOT here (they roll back); they are logged by API routes to platform_events (event_type security_write_denied). Append-only for service_role; no client access.';


-- ════════════════════════════════════════════════════════════════════════════
-- 1. Column privileges
-- ════════════════════════════════════════════════════════════════════════════
-- Revoking a table-level privilege also revokes every column-level grant of it,
-- so re-running this block resets to exactly the allow-lists below. PUBLIC is
-- included because a privilege inherited from PUBLIC survives a revoke from
-- anon/authenticated (the lesson of 043).

revoke insert, update on public.profiles        from public, anon, authenticated;
revoke insert, update on public.banking_details from public, anon, authenticated;
revoke insert, update on public.reviews         from public, anon, authenticated;

-- ── profiles: the allow-list ────────────────────────────────────────────────
-- Each column is written by a user-session path today (file in brackets):
--   first_name, last_name, display_name   names; locked by trigger once verified
--                                         [dashboard/profile/page.tsx, api/onboarding]
--   bio                                   [dashboard/profile, onboarding/StepBioReview]
--   avatar_url, avatar_public_id          [dashboard/profile avatar upload, api/onboarding]
--   skills, social_links, location        [dashboard/profile]
--   phone                                 [dashboard/profile, api/onboarding];
--                                         phone_verified_at is reset by 063's guard
--   street_address, city, province, postal_code, country,
--   address_lat, address_lng, address_place_id
--                                         [dashboard/profile, api/onboarding]
--   available_for_hire, hourly_rate, specializations, crew_bio, years_experience
--                                         creator settings [dashboard/profile]
--   portfolio_projects                    [api/portfolio PUT]
--   onboarding_completed_at               progress marker [api/onboarding]
--   popia_consent_at, popia_consent_version, marketing_opt_in
--                                         the person's own consent [api/popia-consent]
--   updated_at                            sent by every save above
-- NOT granted (server / definer RPC only): id, role, is_verified,
-- verification_*, id_*, selfie_with_id_path, crew_slug, crew_featured,
-- no_show_count, is_suspended, suspended_*, suspension_*, phone_verified_at,
-- popia_consent_ip, created_at, and anything not listed.
--
-- INSERT: profiles are created by handle_new_user (SECURITY DEFINER). The
-- existing "insert own only" path is kept for the same safe columns plus id;
-- privileged columns then take their defaults.
do $$
declare
  v_update_cols constant text[] := array[
    'first_name', 'last_name', 'display_name',
    'bio', 'avatar_url', 'avatar_public_id', 'skills', 'social_links', 'location',
    'phone',
    'street_address', 'city', 'province', 'postal_code', 'country',
    'address_lat', 'address_lng', 'address_place_id',
    'available_for_hire', 'hourly_rate', 'specializations', 'crew_bio', 'years_experience',
    'portfolio_projects',
    'onboarding_completed_at',
    'popia_consent_at', 'popia_consent_version', 'marketing_opt_in',
    'updated_at'
  ];
  v_present text;
  v_missing text;
begin
  -- Only grant columns that exist, so this runs on both dev and prod even if
  -- they have drifted. Missing columns are reported, not fatal.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_present
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and c.column_name = any (v_update_cols);

  select string_agg(w, ', ') into v_missing
    from unnest(v_update_cols) w
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = 'profiles'
                        and c.column_name = w);

  if v_present is not null then
    execute format('grant update (%s) on public.profiles to authenticated', v_present);
    execute format('grant insert (id, %s) on public.profiles to authenticated', v_present);
    raise notice '067: profiles UPDATE/INSERT granted to authenticated on: %', v_present;
  end if;
  if v_missing is not null then
    raise notice '067: allow-listed profiles columns not present (skipped): %', v_missing;
  end if;
end $$;

-- ── banking_details: no client writes at all ────────────────────────────────
-- The only writer is POST /api/banking, which must use the service role
-- (it creates the Paystack recipient server-side and stores its code).
-- Clients keep SELECT on their own row (policy unchanged).

-- ── reviews: only the content of your own review ───────────────────────────
-- No application code inserts or edits reviews today. A client INSERT would
-- let any signed-in person publish ratings of any creator with no completed
-- booking behind them (ratings feed ranking and the AI agents), so INSERT is
-- not granted back: review creation must go through a server route that checks
-- the booking. The author may still edit the wording/rating of their own review.
do $$
declare v_present text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_present
    from information_schema.columns
   where table_schema = 'public' and table_name = 'reviews'
     and column_name in ('rating', 'comment');
  if v_present is not null then
    execute format('grant update (%s) on public.reviews to authenticated', v_present);
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. profiles triggers
-- ════════════════════════════════════════════════════════════════════════════
-- Columns are compared through to_jsonb(row) so a column missing on one
-- project (drift) reads as NULL on both sides instead of raising.
--
-- Privileged = role, is_verified, selfie_with_id_path, is_suspended,
-- no_show_count, crew_featured, crew_slug, plus every column whose name starts
-- with verification_, id_ or suspen (covers suspended_at/by and
-- suspension_reason/expires_at, and any future column with those prefixes).
-- phone_verified_at is NOT listed: 063's guard silently resets it when the
-- phone changes, and that trigger fires before this one.

create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_col text;
  v_explicit constant text[] := array[
    'role', 'is_verified', 'selfie_with_id_path', 'is_suspended',
    'no_show_count', 'crew_featured', 'crew_slug'
  ];
  -- What an untrusted INSERT may carry in a privileged column besides NULL.
  v_defaults constant jsonb := jsonb_build_object(
    'role', 'user',
    'is_verified', false,
    'verification_status', 'unverified',
    'verification_attempts', 0,
    'verification_fraud_flags', '[]'::jsonb,
    'no_show_count', 0,
    'is_suspended', false,
    'crew_featured', false
  );
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (v_new ->> 'id') is distinct from auth.uid()::text then
      raise exception 'You can only create your own profile.'
        using errcode = '42501', hint = 'tv_ownership_column';
    end if;
    for v_col in select jsonb_object_keys(v_new) loop
      if (v_col = any (v_explicit) or v_col ~ '^(verification_|id_|suspen)')
         and (v_new -> v_col) <> 'null'::jsonb
         and (v_new -> v_col) is distinct from (v_defaults -> v_col) then
        raise exception 'Permission denied: % can only be set by the platform.', v_col
          using errcode = '42501', hint = 'tv_privileged_column';
      end if;
    end loop;
    return new;
  end if;

  -- UPDATE
  v_old := to_jsonb(old);

  if (v_new -> 'id') is distinct from (v_old -> 'id') then
    raise exception 'Permission denied: a profile cannot be moved to another account.'
      using errcode = '42501', hint = 'tv_ownership_column';
  end if;

  for v_col in select jsonb_object_keys(v_new) loop
    if (v_col = any (v_explicit) or v_col ~ '^(verification_|id_|suspen)')
       and (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Permission denied: % can only be changed by the platform.', v_col
        using errcode = '42501', hint = 'tv_privileged_column';
    end if;
  end loop;

  if (coalesce(v_old ->> 'verification_status', '') = 'verified'
      or coalesce((v_old ->> 'is_verified')::boolean, false))
     and ((v_new -> 'first_name')   is distinct from (v_old -> 'first_name')
       or (v_new -> 'last_name')    is distinct from (v_old -> 'last_name')
       or (v_new -> 'display_name') is distinct from (v_old -> 'display_name')) then
    raise exception 'Your name is locked after ID verification. Contact support to correct it.'
      using errcode = '42501', hint = 'tv_name_locked';
  end if;

  return new;
end;
$$;

create or replace function public.audit_profile_sensitive_changes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_col text;
  v_was_verified boolean;
  v_explicit constant text[] := array[
    'role', 'is_verified', 'selfie_with_id_path', 'is_suspended',
    'no_show_count', 'crew_featured', 'crew_slug'
  ];
  -- Non-personal values that are useful to see verbatim. Everything else is
  -- recorded only as present/absent.
  v_raw constant text[] := array[
    'role', 'is_verified', 'verification_status', 'is_suspended', 'crew_featured',
    'no_show_count', 'verification_attempts', 'verification_submitted_at',
    'verification_reviewed_at', 'suspended_at', 'suspension_expires_at'
  ];
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  -- Untrusted callers cannot reach here with a privileged change (the BEFORE
  -- trigger rejects it), and they have no INSERT on the log anyway.
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    return null;
  end if;

  v_was_verified := coalesce(v_old ->> 'verification_status', '') = 'verified'
                    or coalesce((v_old ->> 'is_verified')::boolean, false);

  for v_col in select jsonb_object_keys(v_new) loop
    continue when (v_new -> v_col) is not distinct from (v_old -> v_col);
    continue when tg_op = 'INSERT' and (v_new -> v_col) = 'null'::jsonb;
    continue when not (
      v_col = any (v_explicit)
      or v_col ~ '^(verification_|id_|suspen)'
      or (v_was_verified and v_col in ('first_name', 'last_name', 'display_name'))
    );

    insert into public.security_audit_log
      (actor, actor_role, db_role, table_name, row_id, operation, column_name, change_summary)
    values (
      auth.uid(), v_claims ->> 'role', current_user, tg_table_name, v_new ->> 'id', tg_op, v_col,
      case when v_col = any (v_raw) then
        jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col)
      else
        jsonb_build_object(
          'old', case when coalesce(v_old -> v_col, 'null'::jsonb) = 'null'::jsonb then null else '[redacted]' end,
          'new', case when coalesce(v_new -> v_col, 'null'::jsonb) = 'null'::jsonb then null else '[redacted]' end
        )
      end
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_sensitive_columns();

drop trigger if exists profiles_audit_sensitive_changes on public.profiles;
create trigger profiles_audit_sensitive_changes
  after insert or update on public.profiles
  for each row execute function public.audit_profile_sensitive_changes();


-- ════════════════════════════════════════════════════════════════════════════
-- 3. banking_details: trigger + WITH CHECK
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.guard_banking_sensitive_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_col text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (v_new ->> 'user_id') is distinct from auth.uid()::text then
      raise exception 'You can only add your own banking details.'
        using errcode = '42501', hint = 'tv_ownership_column';
    end if;
    if coalesce((v_new ->> 'is_verified')::boolean, false)
       or coalesce(v_new -> 'paystack_recipient_code', 'null'::jsonb) <> 'null'::jsonb then
      raise exception 'Permission denied: banking verification is set by the platform.'
        using errcode = '42501', hint = 'tv_privileged_column';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  foreach v_col in array array['id', 'user_id'] loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Permission denied: banking details cannot be moved to another account.'
        using errcode = '42501', hint = 'tv_ownership_column';
    end if;
  end loop;
  foreach v_col in array array['is_verified', 'paystack_recipient_code', 'account_holder'] loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Permission denied: % can only be changed by the platform.', v_col
        using errcode = '42501', hint = 'tv_privileged_column';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.audit_banking_sensitive_changes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_col text;
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    return null;
  end if;

  foreach v_col in array array['user_id', 'is_verified', 'paystack_recipient_code', 'account_holder'] loop
    continue when (v_new -> v_col) is not distinct from (v_old -> v_col);
    continue when tg_op = 'INSERT' and coalesce(v_new -> v_col, 'null'::jsonb) = 'null'::jsonb;
    insert into public.security_audit_log
      (actor, actor_role, db_role, table_name, row_id, operation, column_name, change_summary)
    values (
      auth.uid(), v_claims ->> 'role', current_user, tg_table_name, v_new ->> 'id', tg_op, v_col,
      case when v_col = 'is_verified' then
        jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col)
      else
        jsonb_build_object(
          'old', case when coalesce(v_old -> v_col, 'null'::jsonb) = 'null'::jsonb then null else '[redacted]' end,
          'new', case when coalesce(v_new -> v_col, 'null'::jsonb) = 'null'::jsonb then null else '[redacted]' end
        )
      end
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists banking_guard_sensitive_columns on public.banking_details;
create trigger banking_guard_sensitive_columns
  before insert or update on public.banking_details
  for each row execute function public.guard_banking_sensitive_columns();

drop trigger if exists banking_audit_sensitive_changes on public.banking_details;
create trigger banking_audit_sensitive_changes
  after insert or update on public.banking_details
  for each row execute function public.audit_banking_sensitive_changes();

drop policy if exists "Users can update own banking details" on public.banking_details;
create policy "Users can update own banking details"
  on public.banking_details for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. reviews: trigger + WITH CHECK
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.guard_review_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_col text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (v_new ->> 'reviewer_id') is distinct from auth.uid()::text then
      raise exception 'You can only write reviews as yourself.'
        using errcode = '42501', hint = 'tv_ownership_column';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  -- Who wrote it, who/what it is about, the booking it hangs off, and whether
  -- moderation has hidden it. booking_id / equipment_booking_id are listed in
  -- case a project has them; absent columns compare as NULL = NULL.
  foreach v_col in array array[
    'id', 'reviewer_id', 'reviewee_id', 'rental_id', 'order_id', 'request_id',
    'booking_id', 'equipment_booking_id', 'review_type', 'is_published', 'created_at'
  ] loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Permission denied: % of a review cannot be changed.', v_col
        using errcode = '42501', hint = 'tv_ownership_column';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists reviews_guard_ownership on public.reviews;
create trigger reviews_guard_ownership
  before insert or update on public.reviews
  for each row execute function public.guard_review_ownership();

drop policy if exists "Users can update own reviews" on public.reviews;
create policy "Users can update own reviews"
  on public.reviews for update
  to authenticated
  using (auth.uid() = reviewer_id)
  with check (auth.uid() = reviewer_id);


-- Trigger functions are fired by triggers only; take them off /rest/v1/rpc.
-- (EXECUTE on a trigger function is checked when the trigger is created, not
-- when it fires — see 043.)
revoke execute on function public.guard_profile_sensitive_columns()   from public, anon, authenticated;
revoke execute on function public.audit_profile_sensitive_changes()   from public, anon, authenticated;
revoke execute on function public.guard_banking_sensitive_columns()   from public, anon, authenticated;
revoke execute on function public.audit_banking_sensitive_changes()   from public, anon, authenticated;
revoke execute on function public.guard_review_ownership()            from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. Verification submission: service-role-only RPC
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.submit_verification_for_user(
  p_user_id                  uuid,
  p_id_front_path            text,
  p_selfie_with_id_path      text,
  p_id_back_path             text  default null,
  p_verification_metadata    jsonb default '{}'::jsonb,
  p_verification_fraud_flags jsonb default '[]'::jsonb,
  p_id_document_hash         text  default null,
  p_verification_ip          text  default 'unknown',
  p_verification_user_agent  text  default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix   text;
  v_status   text;
  v_attempts integer;
  v_flags    jsonb := coalesce(p_verification_fraud_flags, '[]'::jsonb);
  v_path     text;
begin
  if p_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;
  if p_id_front_path is null or p_selfie_with_id_path is null then
    return jsonb_build_object('success', false, 'error', 'Both documents are required');
  end if;

  -- Every path must sit inside the subject's own folder.
  v_prefix := p_user_id::text || '/';
  foreach v_path in array array[p_id_front_path, p_selfie_with_id_path, p_id_back_path] loop
    continue when v_path is null;
    if left(v_path, length(v_prefix)) <> v_prefix
       or position('..' in v_path) > 0
       or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('success', false, 'error', 'Invalid document path');
    end if;
  end loop;

  select verification_status, coalesce(verification_attempts, 0)
    into v_status, v_attempts
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Profile not found');
  end if;
  if v_status = 'pending' then
    return jsonb_build_object('success', false, 'error', 'Already under review');
  end if;
  if v_status = 'verified' then
    return jsonb_build_object('success', false, 'error', 'Already verified');
  end if;
  if v_attempts >= 3 then
    return jsonb_build_object('success', false, 'error', 'Maximum attempts reached');
  end if;

  if p_id_document_hash is not null and exists (
    select 1 from public.profiles
     where id_document_hash = p_id_document_hash and id <> p_user_id
  ) then
    v_flags := v_flags || jsonb_build_array(jsonb_build_object(
      'severity', 'high',
      'code', 'DUPLICATE_ID',
      'message', 'Same ID document submitted by another account'
    ));
  end if;

  update public.profiles set
    id_front_path                = p_id_front_path,
    id_back_path                 = p_id_back_path,
    selfie_with_id_path          = p_selfie_with_id_path,
    verification_metadata        = coalesce(p_verification_metadata, '{}'::jsonb),
    verification_ai_check        = null,
    verification_fraud_flags     = v_flags,
    id_document_hash             = p_id_document_hash,
    verification_ip              = p_verification_ip,
    verification_user_agent      = p_verification_user_agent,
    verification_attempts        = v_attempts + 1,
    verification_status          = 'pending',
    verification_submitted_at    = now(),
    verification_reviewed_at     = null,
    verification_rejected_reason = null
  where id = p_user_id;

  return jsonb_build_object('success', true, 'flags_detected', jsonb_array_length(v_flags));
end;
$$;

revoke execute on function public.submit_verification_for_user(uuid, text, text, text, jsonb, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_verification_for_user(uuid, text, text, text, jsonb, jsonb, text, text, text)
  to service_role;

comment on function public.submit_verification_for_user(uuid, text, text, text, jsonb, jsonb, text, text, text) is
  'Records a verification submission for p_user_id. Service role only (called by POST /api/verifications after it has authenticated the user, uploaded the files and run the face match). Paths must be inside the user''s own folder.';

-- The old client-callable RPC: kept for rollback, no longer callable by clients.
-- Resolved from pg_proc so this runs where it does not exist (dev drift, see 042).
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_verification_request'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    raise notice '067: client EXECUTE removed from %', fn.sig;
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 6. Storage: verification documents
-- ════════════════════════════════════════════════════════════════════════════
-- Existing (003): INSERT own folder, UPDATE own folder, SELECT own folder.
-- No DELETE policy exists; deletion is server-side (route clean-up and the
-- POPIA retention sweep in /api/cron/daily-maintenance, both service role).
--   * UPDATE is dropped: a checked document must not be replaceable in place.
--     Uploads now go through the service role to unique paths, no upsert.
--   * SELECT and INSERT stay scoped to the caller's own folder; recreated only
--     if missing.
--   * The bucket is forced private.

drop policy if exists "Users can update own verification docs" on storage.objects;

update storage.buckets set public = false where id = 'verifications' and public is distinct from false;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'Users can read own verification docs') then
    create policy "Users can read own verification docs"
      on storage.objects for select
      to authenticated
      using (bucket_id = 'verifications'
             and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'Users can upload own verification docs') then
    create policy "Users can upload own verification docs"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'verifications'
                  and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (run by hand, in one transaction, only if 067 must be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- -- 6. storage: restore the overwrite policy from 003
-- create policy "Users can update own verification docs"
--   on storage.objects for update to authenticated
--   using (bucket_id = 'verifications'
--          and (storage.foldername(name))[1] = auth.uid()::text);
--
-- -- 5. verification RPCs
-- grant execute on function public.submit_verification_request(text, text, text, jsonb, jsonb, text, text, text) to authenticated;
-- drop function if exists public.submit_verification_for_user(uuid, text, text, text, jsonb, jsonb, text, text, text);
--
-- -- 4. reviews
-- drop trigger if exists reviews_guard_ownership on public.reviews;
-- drop function if exists public.guard_review_ownership();
-- drop policy if exists "Users can update own reviews" on public.reviews;
-- create policy "Users can update own reviews" on public.reviews for update
--   using (auth.uid() = reviewer_id);
--
-- -- 3. banking_details
-- drop trigger if exists banking_guard_sensitive_columns on public.banking_details;
-- drop trigger if exists banking_audit_sensitive_changes on public.banking_details;
-- drop function if exists public.guard_banking_sensitive_columns();
-- drop function if exists public.audit_banking_sensitive_changes();
-- drop policy if exists "Users can update own banking details" on public.banking_details;
-- create policy "Users can update own banking details" on public.banking_details for update
--   using (auth.uid() = user_id);
--
-- -- 2. profiles
-- drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
-- drop trigger if exists profiles_audit_sensitive_changes on public.profiles;
-- drop function if exists public.guard_profile_sensitive_columns();
-- drop function if exists public.audit_profile_sensitive_changes();
--
-- -- 1. privileges: back to the Supabase default (table-wide) for these tables
-- grant insert, update on public.profiles, public.banking_details, public.reviews to anon, authenticated;
--
-- -- 0. audit log: keep the table (it is evidence); drop only if certain.
-- -- drop table if exists public.security_audit_log;
--
-- commit;
