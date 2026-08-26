-- 043 — Make the 042 revokes actually take effect
--
-- Migration 042 ran `revoke execute ... from anon` and appeared to succeed,
-- but afterwards has_function_privilege('anon', fn, 'EXECUTE') was still true
-- for every function. The search_path pinning in 042 did work; only the
-- revokes were ineffective.
--
-- Why: Postgres grants EXECUTE on every new function to the PUBLIC role by
-- default. `anon` and `authenticated` inherit from PUBLIC, and revoking a
-- privilege from a role does not remove one it inherits. The grant has to be
-- taken from PUBLIC itself, then handed back to the roles that genuinely need
-- it.
--
-- Verified on the development project before being written:
--   revoke execute on function public.handle_new_user() from public, anon, authenticated;
--   -> anon_can_call false, auth_can_call false
--
-- And the signup trigger was smoke-tested afterwards by inserting a throwaway
-- auth.users row and confirming public.profiles gained the matching row, which
-- it did. Postgres checks EXECUTE on a trigger function when the trigger is
-- created, not each time it fires, so revoking is safe for trigger functions.
--
-- public.is_admin() is still deliberately left callable. Seventeen RLS
-- policies granted to the `public` role call it, and RLS expressions run as the
-- querying role, so revoking would break the public catalogue. See 042 for the
-- full reasoning.


-- ── Verification RPCs: authenticated only ───────────────────────────────────
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
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    -- Handed back only to signed-in callers. The admin_* functions still guard
    -- on is_admin() internally, so a non-admin authenticated caller is refused.
    execute format('grant execute on function %s to authenticated', fn.sig);
    raise notice 'locked to authenticated: %', fn.sig;
  end loop;
end $$;


-- ── Trigger and maintenance functions: no callers at all ────────────────────
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
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
    raise notice 'removed from the REST surface: %', fn.sig;
  end loop;
end $$;
