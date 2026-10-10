-- 079 test script. ONE transaction, ends in ROLLBACK; creates its own users.
-- Apply 079-security-phase-6.sql first.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/079-security-phase-6.test.sql

begin;

-- ── Fixtures (as the migration owner) ──────────────────────────────────────
do $$
declare
  admin_u uuid := gen_random_uuid();
  demoted_u uuid := gen_random_uuid();
  legacy_u uuid := gen_random_uuid();
  susp_u uuid := gen_random_uuid();
  user_u uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  s uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (admin_u, 't079-admin@example.invalid'), (demoted_u, 't079-demoted@example.invalid'),
    (legacy_u, 't079-legacy@example.invalid'), (susp_u, 't079-susp@example.invalid'),
    (user_u, 't079-user@example.invalid');
  insert into public.profiles (id) values (admin_u), (demoted_u), (legacy_u), (susp_u), (user_u)
    on conflict (id) do nothing;

  -- An admin promoted through the app (role change stamped by the trigger).
  update public.profiles set role = 'admin' where id = admin_u;
  -- AUTH-2: promoted, then demoted through the app.
  update public.profiles set role = 'admin' where id = demoted_u;
  update public.profiles set role = 'user' where id = demoted_u;
  -- A suspended account that is (still) an admin in profiles.
  update public.profiles set role = 'admin', is_suspended = true where id = susp_u;

  insert into public.smart_rentals (id, slug, title, quantity, is_published) values (r, 't079-' || r, 'Test', 1, true);

  insert into auth.sessions (id, user_id, created_at, updated_at) values (s, user_u, now(), now());
  insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
    values ('t079-token-' || s, user_u::text, s, false, now(), now());

  perform set_config('t079.admin', admin_u::text, true);
  perform set_config('t079.demoted', demoted_u::text, true);
  perform set_config('t079.legacy', legacy_u::text, true);
  perform set_config('t079.susp', susp_u::text, true);
  perform set_config('t079.user', user_u::text, true);
  perform set_config('t079.rental', r::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. is_admin()
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  claims_admin jsonb := jsonb_build_object('role', 'authenticated', 'app_metadata', jsonb_build_object('role', 'admin'));
begin
  if (select role_changed_at from public.profiles where id = current_setting('t079.admin')::uuid) is null then
    raise exception 'FAIL A0: a role change was not stamped';
  end if;
  if (select role_changed_at from public.profiles where id = current_setting('t079.legacy')::uuid) is not null then
    raise exception 'FAIL A0: a plain user got role_changed_at';
  end if;
  raise notice 'PASS A0: role changes are stamped, plain profiles are not';

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.admin'), 'role', 'authenticated')::text, true);
  if not public.is_admin() then raise exception 'FAIL A1: profiles.role admin not recognised'; end if;
  raise notice 'PASS A1: profiles.role = admin is admin (no JWT claim needed)';

  -- The exploit: an old token minted while the user was admin, after demotion.
  perform set_config('request.jwt.claims', (claims_admin || jsonb_build_object('sub', current_setting('t079.demoted')))::text, true);
  if public.is_admin() then raise exception 'FAIL A2: a demoted admin''s stale JWT still gives admin'; end if;
  raise notice 'PASS A2: a demoted admin''s stale JWT (app_metadata.role admin) is not admin';

  perform set_config('request.jwt.claims', (claims_admin || jsonb_build_object('sub', current_setting('t079.legacy')))::text, true);
  if not public.is_admin() then raise exception 'FAIL A3: legacy app_metadata admin lost'; end if;
  raise notice 'PASS A3: an app_metadata-only admin whose role was never managed keeps admin (no lockout)';

  perform set_config('request.jwt.claims', (claims_admin || jsonb_build_object('sub', current_setting('t079.susp')))::text, true);
  if public.is_admin() then raise exception 'FAIL A4: a suspended admin is admin'; end if;
  raise notice 'PASS A4: a suspended account is never admin (profile or JWT)';

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.user'), 'role', 'authenticated')::text, true);
  if public.is_admin() then raise exception 'FAIL A5: an ordinary user is admin'; end if;
  perform set_config('request.jwt.claims', '', true);
  if public.is_admin() then raise exception 'FAIL A5: empty claims gave admin'; end if;
  raise notice 'PASS A5: ordinary user and empty claims are not admin';

  perform set_config('request.jwt.claims', '', true);
end $$;

-- A6. The AUTH-2 reproduction: a demoted admin's old token on an admin RPC.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.demoted'), 'role', 'authenticated',
  'app_metadata', json_build_object('role', 'admin'))::text, true);
set local role authenticated;
do $$
declare v jsonb;
begin
  if exists (select 1 from pg_proc where proname = 'admin_list_verifications') then
    begin
      execute 'select to_jsonb(t) from public.admin_list_verifications() t limit 1' into v;
      raise exception 'FAIL A6: demoted admin listed verifications';
    exception when others then
      if sqlerrm like 'FAIL A6%' then raise; end if;
      raise notice 'PASS A6: demoted admin''s old token is refused by admin_list_verifications (%)', sqlerrm;
    end;
  else
    raise notice 'SKIP A6: admin_list_verifications not on this database';
  end if;
end $$;

-- A7. A user cannot write role_changed_at to regain legacy JWT trust.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.demoted'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    update public.profiles set role_changed_at = null where id = current_setting('t079.demoted')::uuid;
    if (select role_changed_at from public.profiles where id = current_setting('t079.demoted')::uuid) is null then
      raise exception 'FAIL A7: a user cleared role_changed_at';
    end if;
    raise notice 'PASS A7: role_changed_at cannot be cleared by the user (kept by trigger)';
  exception when insufficient_privilege then
    raise notice 'PASS A7: role_changed_at cannot be written by the user (no grant)';
  end;
end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- B. admin_revoke_user_sessions()
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if has_function_privilege('anon', 'public.admin_revoke_user_sessions(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_revoke_user_sessions(uuid)', 'execute') then
    raise exception 'FAIL B1: anon or authenticated can revoke sessions';
  end if;
  if not has_function_privilege('service_role', 'public.admin_revoke_user_sessions(uuid)', 'execute') then
    raise exception 'FAIL B1: service_role cannot revoke sessions';
  end if;
  raise notice 'PASS B1: only service_role can call admin_revoke_user_sessions';
end $$;

set local role service_role;
do $$
declare n integer;
begin
  n := public.admin_revoke_user_sessions(current_setting('t079.user')::uuid);
  if n <> 1 then raise exception 'FAIL B2: revoked % sessions, expected 1', n; end if;
  if public.admin_revoke_user_sessions(current_setting('t079.user')::uuid) <> 0 then
    raise exception 'FAIL B2: a second revoke found sessions';
  end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from auth.sessions where user_id = current_setting('t079.user')::uuid)
     or exists (select 1 from auth.refresh_tokens where user_id = current_setting('t079.user')) then
    raise exception 'FAIL B2: a session or refresh token survived';
  end if;
  raise notice 'PASS B2: every session and refresh token of the user is gone (called as service_role); repeat is a no-op';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Suspended accounts cannot write through the REST API
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.susp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    insert into public.cart_items (user_id, rental_id, quantity)
      values (current_setting('t079.susp')::uuid, current_setting('t079.rental')::uuid, 1);
    raise exception 'FAIL C1: a suspended user inserted a cart line';
  exception when insufficient_privilege then
    raise notice 'PASS C1: a suspended user cannot insert cart lines (RLS)';
  end;
  begin
    insert into public.banking_details (user_id, bank_name, bank_code, account_type, account_holder)
      values (current_setting('t079.susp')::uuid, 'Bank', '000', 'cheque', 'X');
    raise exception 'FAIL C2: a suspended user wrote banking details';
  exception when insufficient_privilege then
    raise notice 'PASS C2: a suspended user cannot write banking details (RLS)';
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.user'), 'role', 'authenticated')::text, true);
do $$
begin
  insert into public.cart_items (user_id, rental_id, quantity)
    values (current_setting('t079.user')::uuid, current_setting('t079.rental')::uuid, 1);
  raise notice 'PASS C3: an active user still inserts cart lines';
end $$;
reset role;

-- An expired suspension does not block (as checkNotSuspended).
update public.profiles set suspension_expires_at = now() - interval '1 day' where id = current_setting('t079.susp')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.susp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into public.cart_items (user_id, rental_id, quantity)
    values (current_setting('t079.susp')::uuid, current_setting('t079.rental')::uuid, 1);
  raise notice 'PASS C4: an expired suspension no longer blocks writes';
end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- D. No markup in names and places
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t079.user'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    update public.profiles set location = 'Jozi</script><script>window.__XSS_LOC__=1</script>'
     where id = current_setting('t079.user')::uuid;
    raise exception 'FAIL D1: markup stored in location';
  exception when invalid_parameter_value then
    raise notice 'PASS D1: the INJ-1 payload is refused in location (profile page path)';
  end;
  begin
    update public.profiles set display_name = 'A <img src=x onerror=alert(1)>' where id = current_setting('t079.user')::uuid;
    raise exception 'FAIL D2: markup stored in display_name';
  exception when invalid_parameter_value then
    raise notice 'PASS D2: markup refused in display_name';
  end;
  update public.profiles set city = 'Hout Bay & Llandudno', province = 'Western Cape', display_name = 'O''Brien Nkosi-Dlamini'
   where id = current_setting('t079.user')::uuid;
  raise notice 'PASS D3: real names and places are accepted';
end $$;
reset role;

-- A legacy value with markup (stored before 079; simulated with the trigger
-- off) does not block an unrelated edit.
alter table public.profiles disable trigger profiles_reject_markup;
update public.profiles set location = 'old <value>' where id = current_setting('t079.legacy')::uuid;
alter table public.profiles enable trigger profiles_reject_markup;
do $$
begin
  update public.profiles set bio = 'still editable' where id = current_setting('t079.legacy')::uuid;
  raise notice 'PASS D4: a legacy row with markup can still be edited elsewhere';
end $$;

rollback;
