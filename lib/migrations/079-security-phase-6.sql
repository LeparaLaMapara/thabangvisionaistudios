-- 079: Phase 6 security fixes in the database
--
-- See docs/security/phase-6-assessment.md. Four independent parts, each
-- idempotent; safe to re-run.
--
--   A. is_admin() no longer trusts a stale JWT (AUTH-2).
--   B. admin_revoke_user_sessions(): end every session of one user, for the
--      role-change and suspend routes (AUTH-2, AUTH-3).
--   C. A suspended account cannot write its cart, banking details or reviews
--      straight through the REST API (AUTH-3).
--   D. Names and places on profiles cannot hold `<` or `>` (INJ-1, the
--      profile page writes some of them straight to Supabase).

-- ════════════════════════════════════════════════════════════════════════════
-- A. is_admin()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Before: admin when the JWT said app_metadata.role = 'admin' OR
-- profiles.role = 'admin'. A JWT is a snapshot: after an admin was demoted
-- (both app_metadata and profiles.role set back to 'user'), the old access
-- token kept admin over direct REST/RPC until it expired (AUTH-2: a demoted
-- admin still read every user's verification data via admin_list_verifications).
--
-- Now: profiles.role is the authority, and it is not trusted for a suspended
-- account. The JWT claim is still honoured, but only for a profile whose role
-- has never been changed since 079 (profiles.role_changed_at IS NULL): those
-- are admins made by hand in app_metadata (CLAUDE.md fallback level 1) before
-- this migration, and dropping them would lock the owner out at the database
-- layer. Every role change through the admin UI (or SQL) after 079 stamps
-- role_changed_at, from then on the profile alone decides. This mirrors the
-- app's requireAdmin, which reads app_metadata FRESH from the Auth server
-- (never a stale token) and then profiles.role; see lib/auth/supabase.ts.

alter table public.profiles add column if not exists role_changed_at timestamptz;

comment on column public.profiles.role_changed_at is
  'Set by trigger whenever profiles.role changes (079). Once set, is_admin() trusts profiles.role only, never a JWT app_metadata claim.';

create or replace function public.profiles_stamp_role_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.role_changed_at := case when coalesce(new.role, 'user') <> 'user' then now() else null end;
  elsif new.role is distinct from old.role then
    new.role_changed_at := now();
  elsif current_user in ('postgres', 'service_role', 'supabase_admin')
        and current_setting('tv.stamp_role_change', true) = 'on' then
    -- The platform asks for a stamp without a role change: ending a
    -- demoted user's sessions (admin_revoke_user_sessions), so an
    -- app_metadata-only admin whose profile already said 'user' stops
    -- being trusted by their old JWT (review fix).
    new.role_changed_at := now();
  else
    -- Derived, never written by hand.
    new.role_changed_at := old.role_changed_at;
  end if;
  return new;
end;
$$;

-- BEFORE triggers run in name order: after profiles_guard_sensitive_columns.
drop trigger if exists profiles_stamp_role_change on public.profiles;
create trigger profiles_stamp_role_change
  before insert or update on public.profiles
  for each row execute function public.profiles_stamp_role_change();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select role, role_changed_at, is_suspended
      from public.profiles
     where id = auth.uid()
  )
  select
    -- 1. The profile says admin, and the account is not suspended.
    exists (select 1 from p where p.role = 'admin' and p.is_suspended is not true)
    -- 2. Legacy: a JWT app_metadata admin whose profile role was never managed
    --    since 079 (no row, or role_changed_at null) and is not suspended.
    or (
      coalesce(
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role') = 'admin',
        false
      )
      and not exists (
        select 1 from p where p.role_changed_at is not null or p.is_suspended is true
      )
    );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. admin_revoke_user_sessions()
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deletes every auth session of the user; their refresh tokens go with them
-- (auth.refresh_tokens.session_id ON DELETE CASCADE; legacy rows with no
-- session are deleted explicitly). GoTrue then answers 403 session_not_found
-- for the old access token on /user (so the app's getUser() sees no user
-- immediately) and refuses every refresh. Direct REST calls with the old
-- access token still verify until it expires (at most the JWT lifetime);
-- part A and part C cover the privileges that matter in that window.
-- It also stamps profiles.role_changed_at, so the user's old JWT app_metadata
-- claim stops counting in is_admin() (part A). Service role only: the app
-- calls it after requireAdmin().

create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_sessions integer;
begin
  if p_user_id is null then
    raise exception 'admin_revoke_user_sessions: user is required';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text and session_id is null;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;
  -- Stamp the profile as role-managed (see profiles_stamp_role_change): a
  -- JWT app_metadata claim minted before this moment no longer counts in
  -- is_admin(), even when the role route's demotion changed nothing because
  -- the profile already said 'user' (an app_metadata-only admin).
  perform set_config('tv.stamp_role_change', 'on', true);
  update public.profiles set updated_at = updated_at where id = p_user_id;
  perform set_config('tv.stamp_role_change', 'off', true);
  return v_sessions;
end;
$$;

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Suspended accounts cannot write through the REST API
-- ════════════════════════════════════════════════════════════════════════════
--
-- The app routes already refuse a suspended account (checkNotSuspended), but
-- the user's own session could still insert cart lines, change banking
-- details and post reviews directly (AUTH-3). A suspension that has expired
-- does not count, as in checkNotSuspended.

create or replace function public.current_user_is_suspended()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and is_suspended is true
       and (suspension_expires_at is null or suspension_expires_at > now())
  );
$$;

-- anon holds no write grant on these tables, so it never evaluates them.
revoke all on function public.current_user_is_suspended() from public, anon;
grant execute on function public.current_user_is_suspended() to authenticated, service_role;

alter policy "Users insert own cart" on public.cart_items
  with check (auth.uid() = user_id and not public.current_user_is_suspended());
alter policy "Users update own cart" on public.cart_items
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.current_user_is_suspended());

alter policy "Users can insert own banking details" on public.banking_details
  with check (auth.uid() = user_id and not public.current_user_is_suspended());
alter policy "Users can update own banking details" on public.banking_details
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.current_user_is_suspended());

alter policy "Users can insert own reviews" on public.reviews
  with check (auth.uid() = reviewer_id and not public.current_user_is_suspended());
alter policy "Users can update own reviews" on public.reviews
  using (auth.uid() = reviewer_id)
  with check (auth.uid() = reviewer_id and not public.current_user_is_suspended());

-- ════════════════════════════════════════════════════════════════════════════
-- D. No markup in names and places
-- ════════════════════════════════════════════════════════════════════════════
--
-- These columns are shown on public pages (creator pages, JSON-LD, search).
-- Rendering is escaped (renderJsonLd, React), this refuses the payload at the
-- door for every writer, including the profile page's direct update. Only a
-- CHANGED value is checked, so a legacy row is never blocked from other edits.

create or replace function public.profiles_reject_markup()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_col text;
begin
  foreach v_col in array array[
    'display_name', 'first_name', 'last_name', 'city', 'province', 'location',
    'postal_code', 'street_address', 'country', 'crew_slug'
  ] loop
    if (v_new ->> v_col) ~ '[<>]' and (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception 'Names and places cannot contain < or >.'
        using errcode = '22023', hint = 'tv_markup_refused', detail = v_col;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists profiles_reject_markup on public.profiles;
create trigger profiles_reject_markup
  before insert or update on public.profiles
  for each row execute function public.profiles_reject_markup();

notify pgrst, 'reload schema';
