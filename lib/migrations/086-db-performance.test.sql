-- 086 test script. ONE transaction, ends in ROLLBACK; creates its own users
-- and rows. Apply 086-db-performance.sql first.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/086-db-performance.test.sql
--
-- A. no ThabangVision policy calls auth.uid()/auth.jwt()/auth.role()/
--    is_admin()/current_user_is_suspended() per row; the four service-role
--    policies are gone; the three admin chat/welcome policies use is_admin().
-- B. who reads chats, messages, welcome drafts and notifications is
--    unchanged, except that a suspended admin reads no one else's chats.
-- C. the new indexes exist, no exact duplicate index is left, and the
--    covered ones are gone.
-- D. prune_log_retention deletes only old rows of the right kind, refuses
--    short retention and other tables, and only service_role may call it.
-- The policy behaviour of the rest of the schema is covered by the 067,
-- 077, 079 and 080 tests and rls-coverage.test.sql, which run after this.

begin;

create temporary table _t086_tables (name text primary key) on commit drop;
insert into _t086_tables values
  ('agent_actions'), ('ai_budget_alerts'), ('ai_token_usage'), ('banking_details'),
  ('booking_payments'), ('booking_status_history'), ('bookings'), ('bug_reports'), ('careers'),
  ('cart_items'), ('chat_conversations'), ('chat_faqs'), ('chat_messages'), ('consent_records'),
  ('content_embeddings'), ('crew_requests'), ('delivery_addresses'),
  ('delivery_cancelled_order_notes'), ('delivery_custody_events'), ('delivery_dispatch_intents'),
  ('delivery_events'), ('delivery_incidents'), ('delivery_manual_tasks'), ('delivery_proofs'),
  ('delivery_provider_events'), ('delivery_quotes'), ('delivery_reconciliation'),
  ('delivery_shipments'), ('dispute_comments'), ('disputes'), ('equipment_bookings'),
  ('feature_flag_events'), ('feature_flags'), ('invoices'), ('ledger_journals'), ('ledger_lines'),
  ('listing_private'), ('listings'), ('moderation_log'), ('newsletter_subscribers'),
  ('notification_outbox'), ('notifications'), ('onboarding_progress'), ('ops_check_runs'),
  ('ops_findings'), ('orders'), ('owner_payouts'), ('payment_confirmations'), ('payment_events'),
  ('payment_reference_mismatches'), ('phone_codes'), ('platform_events'), ('portfolio_analysis'),
  ('portfolio_tag_corrections'), ('press'), ('production_categories'), ('profiles'),
  ('public_profiles'), ('rate_limits'), ('refund_obligations'), ('rental_blocks'),
  ('rental_escalations'), ('rental_payment_intents'), ('reviews'), ('security_audit_log'),
  ('service_booking_events'), ('smart_productions'), ('smart_rentals'), ('subscription_plans'),
  ('subscriptions'), ('ubunye_usage'), ('unmet_demand'), ('unmet_demand_summary'),
  ('welcome_messages');
grant select on _t086_tables to public;

-- ════════════════════════════════════════════════════════════════════════════
-- A. Policy shape
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text;
  v_wrapped int;
begin
  select string_agg(format('%s."%s"', tablename, policyname), ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in (select name from _t086_tables)
     and not (tablename = 'profiles' and cmd in ('SELECT', 'ALL'))  -- must stay bare (086 C)
     and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
           '\( SELECT (auth\.uid|auth\.jwt|auth\.role|is_admin|current_user_is_suspended)\(\) AS [a-z_]+\)', '', 'g')
         ~ '(auth\.(uid|jwt|role)|(^|[^a-z_.])is_admin|(^|[^a-z_.])current_user_is_suspended)\(\)';
  if v_bad is not null then raise exception 'FAIL A1: per-row calls left in: %', v_bad; end if;
  select count(*) into v_wrapped from pg_policies
   where schemaname = 'public' and tablename in (select name from _t086_tables)
     and coalesce(qual, '') || coalesce(with_check, '') ~ '\( SELECT (auth\.uid|is_admin)\(\) AS';
  if v_wrapped < 60 then raise exception 'FAIL A1: only % policies use (select ...); expected the whole set', v_wrapped; end if;
  raise notice 'PASS A1: no per-row auth/admin calls; % policies call them once per query', v_wrapped;

  select string_agg(format('%s."%s"', tablename, policyname), ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('ai_budget_alerts', 'ai_token_usage', 'chat_faqs', 'ubunye_usage')
     and coalesce(qual, '') like '%auth.role()%service_role%';
  if v_bad is not null then raise exception 'FAIL A2: service-role policies left: %', v_bad; end if;
  raise notice 'PASS A2: the no-op service-role policies are gone';

  select string_agg(format('%s."%s"', tablename, policyname), ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('chat_conversations', 'chat_messages', 'welcome_messages')
     and qual ~ 'FROM profiles';
  if v_bad is not null then raise exception 'FAIL A3: admin policies still read profiles directly: %', v_bad; end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename in ('chat_conversations', 'chat_messages', 'welcome_messages')
         and cmd = 'SELECT' and qual = '( SELECT is_admin() AS is_admin)') <> 3 then
    raise exception 'FAIL A3: expected one is_admin() read policy on each of chat_conversations, chat_messages, welcome_messages';
  end if;
  raise notice 'PASS A3: chat and welcome admin reads go through is_admin()';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. Behaviour (fixtures as the migration owner)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  admin_u uuid := gen_random_uuid();
  susp_u uuid := gen_random_uuid();
  user_u uuid := gen_random_uuid();
  other_u uuid := gen_random_uuid();
  c_user uuid := gen_random_uuid();
  c_other uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (admin_u, 't086-admin@example.invalid'), (susp_u, 't086-susp@example.invalid'),
    (user_u, 't086-user@example.invalid'), (other_u, 't086-other@example.invalid');
  insert into public.profiles (id) values (admin_u), (susp_u), (user_u), (other_u)
    on conflict (id) do nothing;
  update public.profiles set role = 'admin' where id = admin_u;
  update public.profiles set role = 'admin', is_suspended = true where id = susp_u;

  insert into public.chat_conversations (id, user_id) values (c_user, user_u), (c_other, other_u);
  insert into public.chat_messages (conversation_id, role, content) values
    (c_user, 'user', 't086 mine'), (c_other, 'user', 't086 theirs');
  insert into public.welcome_messages (user_id, subject, body, drafted_by)
    values (other_u, 't086', 't086 body', 'test')
    on conflict (user_id) do nothing;
  insert into public.notifications (user_id, type, title, body) values
    (user_u, 'cart_reminder', 't086', 'mine'), (other_u, 'cart_reminder', 't086', 'theirs');

  perform set_config('t086.admin', admin_u::text, true);
  perform set_config('t086.susp', susp_u::text, true);
  perform set_config('t086.user', user_u::text, true);
  perform set_config('t086.other', other_u::text, true);
end $$;

create function pg_temp.t086_seen() returns table (convs int, msgs int, welcomes int, notes int)
language sql as $fn$
  select (select count(*)::int from public.chat_conversations
           where user_id in (current_setting('t086.user')::uuid, current_setting('t086.other')::uuid)),
         (select count(*)::int from public.chat_messages where content like 't086 %'),
         (select count(*)::int from public.welcome_messages where user_id = current_setting('t086.other')::uuid),
         (select count(*)::int from public.notifications where title = 't086')
$fn$;
grant execute on function pg_temp.t086_seen() to public;

-- A signed-in user: own chat, own messages, own notification, no welcome drafts.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t086.user'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare s record;
begin
  select * into s from pg_temp.t086_seen();
  if (s.convs, s.msgs, s.welcomes, s.notes) <> (1, 1, 0, 1) then
    raise exception 'FAIL B1: user sees % conversations, % messages, % welcomes, % notifications (want 1,1,0,1)', s.convs, s.msgs, s.welcomes, s.notes;
  end if;
  raise notice 'PASS B1: a user reads only their own chat, messages and notifications';
end $$;
reset role;

-- An admin: every chat, every message, the welcome draft; notifications stay private.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t086.admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare s record;
begin
  select * into s from pg_temp.t086_seen();
  if (s.convs, s.msgs, s.welcomes, s.notes) <> (2, 2, 1, 0) then
    raise exception 'FAIL B2: admin sees % conversations, % messages, % welcomes, % notifications (want 2,2,1,0)', s.convs, s.msgs, s.welcomes, s.notes;
  end if;
  raise notice 'PASS B2: an admin reads all chats and welcome drafts, not others'' notifications';
end $$;
reset role;

-- A suspended admin: nothing of anyone else's (the fix).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t086.susp'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare s record;
begin
  select * into s from pg_temp.t086_seen();
  if (s.convs, s.msgs, s.welcomes, s.notes) <> (0, 0, 0, 0) then
    raise exception 'FAIL B3: suspended admin sees % conversations, % messages, % welcomes, % notifications', s.convs, s.msgs, s.welcomes, s.notes;
  end if;
  raise notice 'PASS B3: a suspended admin reads no one else''s chats or welcome drafts';
end $$;
reset role;

-- A visitor: nothing.
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare s record;
begin
  begin
    select * into s from pg_temp.t086_seen();
    if (s.convs, s.msgs, s.welcomes, s.notes) <> (0, 0, 0, 0) then
      raise exception 'FAIL B4: a visitor sees % conversations, % messages, % welcomes, % notifications', s.convs, s.msgs, s.welcomes, s.notes;
    end if;
  exception when insufficient_privilege then null;  -- no grant at all is fine too
  end;
  raise notice 'PASS B4: a visitor reads no chats, welcome drafts or notifications';
end $$;
reset role;

-- A user cannot mark someone else's notification read (UPDATE policy kept).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t086.user'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  update public.notifications set is_read = true where title = 't086';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B5: user updated % notifications (want 1, their own)', n; end if;
  raise notice 'PASS B5: a user updates only their own notification';
end $$;

-- A user can still update their own profile ("Profiles: owner update safe"
-- reads profiles in its check; a subquery in profiles' read policies would
-- make this fail with infinite recursion), and still cannot make themselves
-- admin.
do $$
declare n int;
begin
  update public.profiles set display_name = 't086 me' where id = current_setting('t086.user')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL B6: own profile update touched % rows', n; end if;
  begin
    update public.profiles set role = 'admin' where id = current_setting('t086.user')::uuid;
    raise exception 'FAIL B6: a user made themselves admin';
  exception when others then
    if sqlerrm like 'FAIL%' or sqlerrm like '%infinite recursion%' then raise; end if;
  end;
  update public.profiles set display_name = 't086 them' where id = current_setting('t086.other')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B6: a user updated someone else''s profile'; end if;
  raise notice 'PASS B6: a user updates their own profile, not their role, not anyone else''s';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ════════════════════════════════════════════════════════════════════════════
-- C. Indexes
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  want text[][] := array[
    ['notifications', 'btree (type, link)'],
    ['notifications', 'btree (user_id, created_at DESC)'],
    ['crew_requests', 'btree (lower(client_email))'],
    ['chat_messages', 'btree (conversation_id, created_at)'],
    ['smart_productions', 'btree (production_category_id)'],
    ['rental_payment_intents', 'btree (user_id)'],
    ['unmet_demand', 'btree (user_id)'],
    ['disputes', 'btree (filed_by)'],
    ['delivery_quotes', 'btree (origin_address_id)'],
    ['delivery_quotes', 'btree (destination_address_id)'],
    ['delivery_shipments', 'btree (quote_id)'],
    ['delivery_shipments', 'btree (origin_address_id)'],
    ['delivery_shipments', 'btree (destination_address_id)'],
    ['delivery_incidents', 'btree (shipment_id)']];
  gone text[][] := array[
    ['equipment_bookings', 'btree (rental_id, start_date, end_date) WHERE (status = ANY (ARRAY[''pending''::text, ''confirmed''::text, ''active''::text]))'],
    ['notifications', 'btree (user_id)'],
    ['chat_messages', 'btree (conversation_id)']];
  i int;
  v_bad text;
begin
  for i in 1 .. array_length(want, 1) loop
    if not exists (select 1 from pg_index x
                    where x.indrelid = ('public.' || want[i][1])::regclass and x.indisvalid
                      and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = want[i][2]) then
      raise exception 'FAIL C1: no index % on %', want[i][2], want[i][1];
    end if;
  end loop;
  raise notice 'PASS C1: the % new indexes exist', array_length(want, 1);

  for i in 1 .. array_length(gone, 1) loop
    if exists (select 1 from pg_index x
                where x.indrelid = ('public.' || gone[i][1])::regclass and not x.indisunique
                  and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = gone[i][2]) then
      raise exception 'FAIL C2: covered index % on % is still there', gone[i][2], gone[i][1];
    end if;
  end loop;
  -- What covers them is still there.
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'equipment_bookings'
                  and indexdef like '%(rental_id, start_date, end_date) WHERE%''disputed''%') then
    raise exception 'FAIL C2: equipment_bookings lost 070''s availability index';
  end if;
  if to_regclass('public.idx_smart_productions_one_per_creator') is null then
    raise exception 'FAIL C2: the one-production-per-creator index is gone';
  end if;
  raise notice 'PASS C2: covered indexes dropped, their covering indexes kept';

  select string_agg(format('%s: %s = %s', a.indrelid::regclass, a.indexrelid::regclass, b.indexrelid::regclass), '; ') into v_bad
    from pg_index a
    join pg_index b on b.indrelid = a.indrelid and b.indexrelid > a.indexrelid
    join pg_class ca on ca.oid = a.indexrelid
    join pg_class cb on cb.oid = b.indexrelid
    join pg_class t on t.oid = a.indrelid
   where t.relnamespace = 'public'::regnamespace and t.relname in (select name from _t086_tables)
     and ca.relam = cb.relam and a.indkey::text = b.indkey::text and a.indclass::text = b.indclass::text
     and a.indcollation::text = b.indcollation::text and a.indoption::text = b.indoption::text
     and coalesce(pg_get_expr(a.indexprs, a.indrelid), '') = coalesce(pg_get_expr(b.indexprs, b.indrelid), '')
     and coalesce(pg_get_expr(a.indpred, a.indrelid), '') = coalesce(pg_get_expr(b.indpred, b.indrelid), '')
     and not (exists (select 1 from pg_constraint k where k.conindid = a.indexrelid)
              and exists (select 1 from pg_constraint k where k.conindid = b.indexrelid));
  if v_bad is not null then raise exception 'FAIL C3: exact duplicate indexes left: %', v_bad; end if;
  raise notice 'PASS C3: no exact duplicate index on a ThabangVision table';

  -- Unique slugs still enforced after the copies went.
  if not exists (select 1 from pg_index x join pg_constraint k on k.conindid = x.indexrelid
                  where x.indrelid = 'public.smart_rentals'::regclass and k.contype = 'u'
                    and pg_get_indexdef(x.indexrelid) ~ 'USING btree \(slug\)$') then
    raise exception 'FAIL C4: smart_rentals.slug is no longer unique';
  end if;
  raise notice 'PASS C4: unique slugs still enforced';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. prune_log_retention
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  u uuid := current_setting('t086.user')::uuid;
  old_ts timestamptz := now() - interval '400 days';
begin
  insert into public.platform_events (event_type, event_category, created_at) values
    ('t086_old', 't086', old_ts), ('t086_new', 't086', now() - interval '10 days');
  insert into public.ai_token_usage (model, created_at) values
    ('t086-old', old_ts), ('t086-new', now() - interval '300 days');
  insert into public.security_audit_log (table_name, operation, column_name, occurred_at) values
    ('t086', 'UPDATE', 'old', old_ts), ('t086', 'UPDATE', 'new', now() - interval '300 days');
  insert into public.payment_events (provider, dedupe_key, event_type, payload, received_at, processing_status) values
    ('t086', 't086-processed-' || gen_random_uuid(), 't086', '{}', old_ts, 'processed'),
    ('t086', 't086-ignored-' || gen_random_uuid(), 't086', '{}', old_ts, 'ignored'),
    ('t086', 't086-dead-' || gen_random_uuid(), 't086', '{}', old_ts, 'dead'),
    ('t086', 't086-failed-' || gen_random_uuid(), 't086', '{}', old_ts, 'failed'),
    ('t086', 't086-recent-' || gen_random_uuid(), 't086', '{}', now() - interval '30 days', 'processed');
  insert into public.notifications (user_id, type, title, body, is_read, created_at) values
    (u, 'cart_reminder', 't086-ret', 'old read', true, old_ts),
    (u, 'cart_reminder', 't086-ret', 'old unread', false, old_ts),
    (u, 'cart_reminder', 't086-ret', 'new read', true, now() - interval '10 days');
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.prune_log_retention(text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.prune_log_retention(text, integer, integer)', 'execute') then
    raise exception 'FAIL D1: anon or authenticated can run prune_log_retention';
  end if;
  if not has_function_privilege('service_role', 'public.prune_log_retention(text, integer, integer)', 'execute') then
    raise exception 'FAIL D1: service_role cannot run prune_log_retention';
  end if;
  raise notice 'PASS D1: only service_role runs prune_log_retention';
end $$;

set local role service_role;
do $$
declare
  n int;
begin
  -- Refusals.
  begin
    perform public.prune_log_retention('notifications', 29, 100);
    raise exception 'FAIL D2: 29 days accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.prune_log_retention('security_audit_log', 364, 100);
    raise exception 'FAIL D2: 364 days of audit log accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.prune_log_retention('chat_messages', 365, 100);
    raise exception 'FAIL D2: chat_messages accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.prune_log_retention('ledger_lines', 3650, 100);
    raise exception 'FAIL D2: ledger_lines accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.prune_log_retention('platform_events', 180, 0);
    raise exception 'FAIL D2: limit 0 accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS D2: refuses short retention, chat, ledger and a zero limit';

  -- A batch of one deletes one row.
  n := public.prune_log_retention('payment_events', 365, 1);
  if n <> 1 then raise exception 'FAIL D3: a batch of 1 deleted % rows', n; end if;
  raise notice 'PASS D3: the batch limit holds';

  perform public.prune_log_retention('platform_events', 180, 10000);
  perform public.prune_log_retention('ai_token_usage', 365, 10000);
  perform public.prune_log_retention('security_audit_log', 365, 10000);
  perform public.prune_log_retention('payment_events', 365, 10000);
  perform public.prune_log_retention('notifications', 180, 10000);
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.platform_events where event_type = 't086_old')
     or not exists (select 1 from public.platform_events where event_type = 't086_new') then
    raise exception 'FAIL D4: platform_events kept the old row or lost the new one';
  end if;
  if exists (select 1 from public.ai_token_usage where model = 't086-old')
     or not exists (select 1 from public.ai_token_usage where model = 't086-new') then
    raise exception 'FAIL D4: ai_token_usage kept the old row or lost the new one';
  end if;
  if exists (select 1 from public.security_audit_log where table_name = 't086' and column_name = 'old')
     or not exists (select 1 from public.security_audit_log where table_name = 't086' and column_name = 'new') then
    raise exception 'FAIL D4: security_audit_log kept the old row or lost the new one';
  end if;
  if exists (select 1 from public.payment_events where provider = 't086' and processing_status in ('processed', 'ignored') and received_at < now() - interval '365 days') then
    raise exception 'FAIL D4: old finished payment events left';
  end if;
  if (select count(*) from public.payment_events where provider = 't086' and processing_status in ('dead', 'failed')) <> 2 then
    raise exception 'FAIL D4: an unfinished (dead/failed) payment event was deleted';
  end if;
  if not exists (select 1 from public.payment_events where provider = 't086' and dedupe_key like 't086-recent-%') then
    raise exception 'FAIL D4: a recent payment event was deleted';
  end if;
  if exists (select 1 from public.notifications where title = 't086-ret' and body = 'old read')
     or not exists (select 1 from public.notifications where title = 't086-ret' and body = 'old unread')
     or not exists (select 1 from public.notifications where title = 't086-ret' and body = 'new read') then
    raise exception 'FAIL D4: notifications: old read kept, or old unread / new read deleted';
  end if;
  raise notice 'PASS D4: old log rows deleted; recent rows, unread notices and unfinished payment events kept';
end $$;

select '086 TEST PASSED' as result;
rollback;
