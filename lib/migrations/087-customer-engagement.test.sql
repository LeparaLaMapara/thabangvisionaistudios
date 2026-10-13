-- 087 test: customer engagement. One transaction, rolled back. Raises on the
-- first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/087-customer-engagement.test.sql

begin;

do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000870a1';
  b uuid := '00000000-0000-4000-8000-0000000870b1';
  n integer;
  nid uuid;
begin
  insert into auth.users (id, email) values (a, 't087-a@example.invalid'), (b, 't087-b@example.invalid');
  insert into public.profiles (id) values (a), (b) on conflict (id) do nothing;

  -- 1. The opt-out column, off by default.
  if (select email_lifecycle_opt_out from public.profiles where id = a) is distinct from false then
    raise exception 'FAIL 1: email_lifecycle_opt_out is not false by default';
  end if;
  raise notice 'PASS 1: email_lifecycle_opt_out exists and defaults to false';

  -- 2. The outbox takes push, and still refuses an unknown channel.
  insert into public.notification_outbox (dedupe_key, kind, channel, user_id)
  values ('t087:push', 'engage_push', 'push', a::text);
  begin
    insert into public.notification_outbox (dedupe_key, kind, channel, user_id) values ('t087:fax', 'engage_x', 'fax', a::text);
    raise exception 'FAIL 2: channel fax was accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'PASS 2: channel push accepted, an unknown channel refused';

  -- 3. Each dispatcher claims only its own rows.
  insert into public.notification_outbox (dedupe_key, kind, channel, user_id)
  values ('t087:engage-email', 'engage_nudge', 'email', a::text),
         ('t087:rental', 'booking_confirmed', 'in_app', a::text);
  select count(*) into n from public.claim_outbox(500) where left(dedupe_key, 5) = 't087:' and left(kind, 7) = 'engage_';
  if n <> 0 then raise exception 'FAIL 3: claim_outbox took % engagement rows', n; end if;
  select count(*) into n from public.claim_engagement_outbox(500, 3, array['push']) where dedupe_key = 't087:engage-email';
  if n <> 0 then raise exception 'FAIL 3: a push-only claim took an email row'; end if;
  select count(*) into n from public.claim_engagement_outbox(500) where dedupe_key = 't087:rental';
  if n <> 0 then raise exception 'FAIL 3: claim_engagement_outbox took a rental row'; end if;
  select count(*) into n from public.notification_outbox
   where dedupe_key in ('t087:push', 't087:engage-email') and status = 'sending' and attempts = 1;
  if n <> 2 then raise exception 'FAIL 3: claim_engagement_outbox claimed % of the 2 engagement rows', n; end if;
  if (select status from public.notification_outbox where dedupe_key = 't087:rental') <> 'sending' then
    raise exception 'FAIL 3: claim_outbox did not claim the rental row';
  end if;
  raise notice 'PASS 3: claim_outbox and claim_engagement_outbox each claim only their own kinds';

  -- 4. No push subscription: a bell item queues nothing.
  insert into public.notifications (user_id, type, title, body) values (b, 'dispute_updated', 't087', 't087') returning id into nid;
  if exists (select 1 from public.notification_outbox where dedupe_key = 'engage_push:notification:' || nid) then
    raise exception 'FAIL 4: a push was queued for someone without a subscription';
  end if;

  -- 5. With a subscription: one push queued per bell item, holding only the id.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (a, 'https://push.example.invalid/t087-a', repeat('k', 40), repeat('s', 16));
  insert into public.notifications (user_id, type, title, body) values (a, 'dispute_updated', 't087', 't087') returning id into nid;
  select count(*) into n from public.notification_outbox
   where dedupe_key = 'engage_push:notification:' || nid and channel = 'push' and kind = 'engage_push'
     and user_id = a::text and data = jsonb_build_object('notificationId', nid);
  if n <> 1 then raise exception 'FAIL 5: expected one queued push for the bell item, found %', n; end if;
  raise notice 'PASS 4-5: bell items queue a push only for people with a subscription';

  -- 6. Endpoint shape is checked.
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (a, 'http://insecure.invalid/x', repeat('k', 40), repeat('s', 16));
    raise exception 'FAIL 6: a non-https endpoint was accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'PASS 6: only https push endpoints are stored';

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (b, 'https://push.example.invalid/t087-b', repeat('k', 40), repeat('s', 16));
end $$;

-- 7-9 run as a signed-in user (A).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000870a1', 'role', 'authenticated')::text, true);

do $$
declare
  n integer;
begin
  select count(*) into n from public.push_subscriptions;
  if n <> 1 then raise exception 'FAIL 7: user A sees % subscriptions (expected their own 1)', n; end if;

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('00000000-0000-4000-8000-0000000870b1', 'https://push.example.invalid/t087-forged', repeat('k', 40), repeat('s', 16));
    raise exception 'FAIL 8: user A added a subscription for user B';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, failure_count)
    values ('00000000-0000-4000-8000-0000000870a1', 'https://push.example.invalid/t087-a2', repeat('k', 40), repeat('s', 16), 99);
    raise exception 'FAIL 8: a client set failure_count';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('00000000-0000-4000-8000-0000000870a1', 'https://push.example.invalid/t087-a3', repeat('k', 40), repeat('s', 16));

  delete from public.push_subscriptions where endpoint = 'https://push.example.invalid/t087-b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8: user A deleted user B''s subscription'; end if;

  begin
    update public.profiles set email_lifecycle_opt_out = true where id = '00000000-0000-4000-8000-0000000870a1';
    raise exception 'FAIL 9: a client changed email_lifecycle_opt_out directly';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.notification_outbox limit 1;
    raise exception 'FAIL 9: a client can read the outbox';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.claim_engagement_outbox(1);
    raise exception 'FAIL 9: a client can claim engagement messages';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 7-9: owner-only push subscriptions; opt-out, outbox and claim are server-only';
end $$;

reset role;
set local role anon;

do $$
begin
  begin
    perform 1 from public.push_subscriptions limit 1;
    raise exception 'FAIL 10: anon can read push subscriptions';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 10: anon has no access to push subscriptions';
end $$;

reset role;

do $$
begin
  if exists (select 1 from pg_proc p where p.proname in ('claim_outbox', 'claim_engagement_outbox', 'enqueue_push_for_notification')
               and (not p.prosecdef or not p.proconfig @> array['search_path=public, pg_temp'])) then
    raise exception 'FAIL 11: an 087 function lost SECURITY DEFINER or its pinned search_path';
  end if;
  if has_function_privilege('anon', 'public.claim_engagement_outbox(integer, integer, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.claim_outbox(integer, integer)', 'execute') then
    raise exception 'FAIL 11: a client role can execute a claim function';
  end if;
  raise notice 'PASS 11: definer functions pinned, claims are service_role only';
end $$;

select 'ALL 087 CHECKS PASSED' as result;

rollback;
