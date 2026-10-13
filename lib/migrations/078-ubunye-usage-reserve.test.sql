-- 078 test script. ONE transaction, ends in ROLLBACK; creates its own user.
-- Apply 078-ubunye-usage-reserve.sql first.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/078-ubunye-usage-reserve.test.sql
--
-- The concurrency check (two sessions at the cap) is scripts/db/078-concurrency.test.sh.

begin;

do $$
declare
  u uuid := gen_random_uuid();
  d date := date '2031-01-01';
  r integer;
  n integer;
begin
  insert into auth.users (id, email) values (u, 'ubunye-078@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;

  -- 1. Reserve up to the limit, then refuse without changing anything.
  r := public.ubunye_reserve_message(u, d, 3); if r is distinct from 1 then raise exception 'FAIL 1: first reserve gave %', r; end if;
  r := public.ubunye_reserve_message(u, d, 3); if r is distinct from 2 then raise exception 'FAIL 1: second reserve gave %', r; end if;
  r := public.ubunye_reserve_message(u, d, 3); if r is distinct from 3 then raise exception 'FAIL 1: third reserve gave %', r; end if;
  r := public.ubunye_reserve_message(u, d, 3); if r is not null then raise exception 'FAIL 1: a fourth slot was given (%)', r; end if;
  select message_count into n from public.ubunye_usage where user_id = u and date = d;
  if n <> 3 then raise exception 'FAIL 1: count is % after a refused reserve', n; end if;
  raise notice 'PASS 1: slots are given up to the limit, then refused with nothing changed';

  -- 2. A release gives the slot back; it can be reserved again.
  perform public.ubunye_release_message(u, d);
  select message_count into n from public.ubunye_usage where user_id = u and date = d;
  if n <> 2 then raise exception 'FAIL 2: release left %', n; end if;
  r := public.ubunye_reserve_message(u, d, 3); if r is distinct from 3 then raise exception 'FAIL 2: re-reserve gave %', r; end if;
  raise notice 'PASS 2: a released slot can be used again';

  -- 3. Release never goes below 0, and a release with no row is a no-op.
  update public.ubunye_usage set message_count = 0 where user_id = u and date = d;
  perform public.ubunye_release_message(u, d);
  perform public.ubunye_release_message(u, d + 1);
  select message_count into n from public.ubunye_usage where user_id = u and date = d;
  if n <> 0 then raise exception 'FAIL 3: count went to %', n; end if;
  if exists (select 1 from public.ubunye_usage where user_id = u and date = d + 1) then raise exception 'FAIL 3: release created a row'; end if;
  raise notice 'PASS 3: release never goes below 0 and never creates a row';

  -- 4. A zero or missing limit reserves nothing.
  if public.ubunye_reserve_message(u, d + 2, 0) is not null or public.ubunye_reserve_message(u, d + 2, null) is not null then
    raise exception 'FAIL 4: a slot was given with no allowance';
  end if;
  if exists (select 1 from public.ubunye_usage where user_id = u and date = d + 2) then raise exception 'FAIL 4: a row was written'; end if;
  raise notice 'PASS 4: no allowance, no slot';

  -- 5. Only the service role may call them.
  if has_function_privilege('anon', 'public.ubunye_reserve_message(uuid, date, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ubunye_reserve_message(uuid, date, integer)', 'execute')
     or has_function_privilege('anon', 'public.ubunye_release_message(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'public.ubunye_release_message(uuid, date)', 'execute') then
    raise exception 'FAIL 5: anon or authenticated can execute the 078 functions';
  end if;
  if not has_function_privilege('service_role', 'public.ubunye_reserve_message(uuid, date, integer)', 'execute') then
    raise exception 'FAIL 5: service_role cannot reserve';
  end if;
  if not exists (select 1 from pg_proc where proname = 'ubunye_reserve_message' and prosecdef
                   and array_to_string(proconfig, ',') like 'search_path=public%') then
    raise exception 'FAIL 5: search_path is not pinned';
  end if;
  raise notice 'PASS 5: service_role only, SECURITY DEFINER with a pinned search_path';
end $$;

rollback;
