-- 042 — Lock down SECURITY DEFINER functions exposed over the REST API
--
-- Supabase exposes every function in `public` at /rest/v1/rpc/<name>. The
-- database linter found SECURITY DEFINER functions invocable by `anon` — that
-- is, without signing in at all. Each is guarded internally, so this was
-- defence in depth rather than an open door, but the door should be locked
-- rather than merely watched.
--
-- Written defensively: it resolves each function from pg_proc and skips any
-- that do not exist. The dev and production projects have drifted (dev is
-- missing the verification RPCs entirely), and migrations here are applied by
-- hand, so one file has to run cleanly against both.
--
--
-- WHAT IS DELIBERATELY LEFT ALONE
--
-- public.is_admin() keeps EXECUTE for anon and authenticated. That is not an
-- oversight. Seventeen RLS policies call it, and most are granted to the
-- `public` role, which includes anon: smart_rentals, smart_productions,
-- listings, orders, invoices, profiles, equipment_bookings, booking_payments,
-- crew_requests, careers, press, feature_flags, feature_flag_events,
-- subscriptions, subscription_plans and platform_events.
--
-- RLS expressions are evaluated as the querying role, so revoking EXECUTE from
-- anon would make every one of those policies raise a permission error and the
-- public catalogue would stop loading. The function only reports whether the
-- caller is an admin, which the caller already knows, so leaving it callable
-- costs nothing.


-- ── 1. Verification RPCs: unreachable without signing in ────────────────────
-- All are called from API routes using the user-session client, so the caller
-- is always `authenticated`. The four admin_* functions additionally guard on
-- is_admin() internally, so a non-admin authenticated caller is still refused.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'submit_verification_request',
        'admin_list_verifications',
        'admin_get_verification',
        'admin_approve_verification',
        'admin_reject_verification'
      )
  loop
    execute format('revoke execute on function %s from anon', fn.sig);
    raise notice 'revoked anon EXECUTE on %', fn.sig;
  end loop;
end $$;


-- ── 2. Trigger and maintenance functions: off the REST surface entirely ─────
-- These are fired by triggers, never called directly by the application.
-- Postgres checks EXECUTE on a trigger function when the trigger is CREATED,
-- not each time it fires, so revoking does not stop the triggers working. It
-- only removes them from /rest/v1/rpc.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'handle_new_user',
        'rls_auto_enable',
        'log_feature_flag_change',
        'increment_conversation_message_count'
      )
  loop
    execute format('revoke execute on function %s from anon, authenticated', fn.sig);
    raise notice 'revoked anon+authenticated EXECUTE on %', fn.sig;
  end loop;
end $$;


-- ── 3. Pin search_path where it is still mutable ────────────────────────────
-- A SECURITY DEFINER function with a mutable search_path can be pointed at an
-- attacker-controlled schema and made to run their code with the definer's
-- rights. Pinning closes that.
--
-- Functions that already carry a search_path (is_admin, the admin_* set,
-- submit_verification_request, rls_auto_enable) are skipped by the
-- proconfig test below rather than being reset.
--
-- handle_new_user was read line by line first: it only does
-- INSERT INTO public.profiles (id) VALUES (NEW.id), fully schema-qualified, so
-- `public` alone suffices and `auth` is not required.
--
-- The match_* functions use pgvector operators, which live in `extensions`.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proconfig is null
      and p.proname in (
        'handle_new_user',
        'increment_conversation_message_count',
        'increment_faq_view',
        'log_feature_flag_change',
        'set_updated_at',
        'update_updated_at',
        'update_updated_at_column',
        'match_content',
        'match_kb_chunks'
      )
  loop
    if fn.proname like 'match_%' then
      execute format('alter function %s set search_path = public, extensions, pg_temp', fn.sig);
    else
      execute format('alter function %s set search_path = public, pg_temp', fn.sig);
    end if;
    raise notice 'pinned search_path on %', fn.sig;
  end loop;
end $$;
