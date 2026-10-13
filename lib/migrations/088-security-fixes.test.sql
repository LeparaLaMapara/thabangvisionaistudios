-- 088 test: security fixes of 2026-10-13. One transaction, rolled back.
-- Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/088-security-fixes.test.sql

begin;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000880a1';
  b uuid := '00000000-0000-4000-8000-0000000880b1';
begin
  insert into auth.users (id, email) values (a, 't088-a@example.invalid'), (b, 't088-b@example.invalid');
  insert into public.profiles (id) values (a), (b) on conflict (id) do nothing;

  -- 1. Push endpoints must be on a push service.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (a, 'https://fcm.googleapis.com/fcm/send/t088', repeat('k', 40), repeat('s', 16)),
         (a, 'https://updates.push.services.mozilla.com/wpush/v2/t088', repeat('k', 40), repeat('s', 16)),
         (a, 'https://web.push.apple.com/t088', repeat('k', 40), repeat('s', 16)),
         (a, 'https://wns2-par02p.notify.windows.com/w/?token=t088', repeat('k', 40), repeat('s', 16));
end $$;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000880a1';
  bad text;
begin
  if (select count(*) from public.push_subscriptions where user_id = a) <> 4 then
    raise exception 'FAIL 1: the four real push services were not all accepted';
  end if;
  foreach bad in array array[
    'https://169.254.169.254/latest/meta-data/iam',
    'https://localhost:5432/x',
    'https://10.0.0.1/admin',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilnotify.windows.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com/a' || chr(9) || 'b',
    'https://fcm.googleapis.com/a\b'
  ] loop
    begin
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (a, bad, repeat('k', 40), repeat('s', 16));
      raise exception 'FAIL 1: % was accepted', bad;
    exception when check_violation then
      null;
    end;
  end loop;
  raise notice 'PASS 1: only push service endpoints are stored';
end $$;

-- 2. At most 10 per person, the oldest removed.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000880a1';
  i integer;
  n integer;
begin
  update public.push_subscriptions set created_at = now() - interval '1 day' where user_id = a;
  for i in 1..9 loop
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
    values (a, 'https://fcm.googleapis.com/fcm/send/t088-' || i, repeat('k', 40), repeat('s', 16), now() + make_interval(secs => i));
  end loop;
  select count(*) into n from public.push_subscriptions where user_id = a;
  if n <> 10 then raise exception 'FAIL 2: expected 10 subscriptions, found %', n; end if;
  if exists (select 1 from public.push_subscriptions where user_id = a and endpoint = 'https://fcm.googleapis.com/fcm/send/t088-9') is not true then
    raise exception 'FAIL 2: the newest subscription was removed';
  end if;
  raise notice 'PASS 2: at most 10 subscriptions per person';
end $$;

-- 3. Phone codes: sends and guesses are counted atomically.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000880a1';
  ok boolean;
  r record;
  i integer;
begin
  for i in 1..3 loop
    if not public.phone_code_store(a, '+27821234567', 'h' || i, 10, 3) then
      raise exception 'FAIL 3: send % of 3 was refused', i;
    end if;
  end loop;
  if public.phone_code_store(a, '+27821234567', 'h4', 10, 3) then
    raise exception 'FAIL 3: a fourth send in the hour was allowed';
  end if;
  if (select code_hash from public.phone_codes where user_id = a) <> 'h3' then
    raise exception 'FAIL 3: a refused send replaced the code';
  end if;

  for i in 1..5 loop
    select * into r from public.phone_code_try(a, 5);
    if r.outcome <> 'ok' or r.code_hash <> 'h3' then raise exception 'FAIL 3: try % gave %', i, r.outcome; end if;
  end loop;
  select * into r from public.phone_code_try(a, 5);
  if r.outcome <> 'too_many' or r.code_hash is not null then raise exception 'FAIL 3: a sixth try gave %', r.outcome; end if;

  update public.phone_codes set expires_at = now() - interval '1 minute', attempts = 0 where user_id = a;
  select * into r from public.phone_code_try(a, 5);
  if r.outcome <> 'expired' then raise exception 'FAIL 3: an expired code gave %', r.outcome; end if;
  select * into r from public.phone_code_try('00000000-0000-4000-8000-0000000880ff', 5);
  if r.outcome <> 'expired' then raise exception 'FAIL 3: no code gave %', r.outcome; end if;

  -- An hour later the count starts again.
  update public.phone_codes set created_at = now() - interval '61 minutes' where user_id = a;
  if not public.phone_code_store(a, '+27821234567', 'h5', 10, 3) then
    raise exception 'FAIL 3: a send after the hour was refused';
  end if;
  if (select sent_count from public.phone_codes where user_id = a) <> 1 then
    raise exception 'FAIL 3: the hourly count did not restart';
  end if;
  raise notice 'PASS 3: phone sends and guesses are capped atomically';
end $$;

-- 4. Text limits.
do $$
begin
  begin
    insert into public.reviews (review_type, reviewer_id, reviewee_id, rating, comment)
    values ('crew', '00000000-0000-4000-8000-0000000880a1', '00000000-0000-4000-8000-0000000880b1', 5, repeat('x', 2001));
    raise exception 'FAIL 4: a 2001-character review was stored';
  exception when check_violation then
    null;
  end;
  raise notice 'PASS 4: review text is limited to 2000 characters';
end $$;

-- 5-6 run as a signed-in user (A).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000880a1', 'role', 'authenticated')::text, true);

do $$
begin
  -- 5. No direct dispute filing (the site checks the person is a party).
  begin
    insert into public.disputes (dispute_type, filed_by, reason, status)
    values ('quality_dispute', '00000000-0000-4000-8000-0000000880a1', '088 direct insert test', 'open');
    raise exception 'FAIL 5: a signed-in user inserted a dispute directly';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 5: disputes are filed through the site only';

  -- 6. No direct push subscription, and no phone RPCs.
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('00000000-0000-4000-8000-0000000880a1', 'https://fcm.googleapis.com/fcm/send/t088-client', repeat('k', 40), repeat('s', 16));
    raise exception 'FAIL 6: a signed-in user added a push subscription directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.phone_code_try('00000000-0000-4000-8000-0000000880a1', 5);
    raise exception 'FAIL 6: a signed-in user called phone_code_try';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 6: push subscriptions and phone codes are server-only';
end $$;

reset role;

do $$
begin
  -- 7. Grants and triggers.
  if has_table_privilege('anon', 'public.banking_details', 'select')
     or has_table_privilege('anon', 'public.subscriptions', 'select') then
    raise exception 'FAIL 7: anon still holds SELECT on banking_details or subscriptions';
  end if;
  if has_table_privilege('authenticated', 'public.disputes', 'insert') then
    raise exception 'FAIL 7: authenticated still holds INSERT on disputes';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_confirmed_notify' and tgrelid = 'auth.users'::regclass) then
    raise exception 'FAIL 7: the email-confirmed signup trigger is missing';
  end if;
  if exists (select 1 from pg_proc p where p.proname in ('phone_code_store', 'phone_code_try', 'push_subscriptions_cap')
               and (not p.prosecdef or not p.proconfig @> array['search_path=public, pg_temp'])) then
    raise exception 'FAIL 7: an 088 function lost SECURITY DEFINER or its pinned search_path';
  end if;
  raise notice 'PASS 7: grants, trigger and functions as expected';
end $$;

select 'ALL 088 CHECKS PASSED' as result;

rollback;
