-- 097 test: Ubunye plans. References only, the client's own only, RLS read
-- own, no client writes, one booking one plan, need XOR ref, plan proposals
-- allowed, chat card columns. One transaction, rolled back. Raises on the
-- first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/097-ubunye-projects.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000970a1', 't097-client@example.invalid');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000970a2', 't097-other@example.invalid');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000970a3', 't097-person@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000970a1') on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000970a2') on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000970a3') on conflict (id) do nothing;

create temporary table _t097 (k text primary key, v uuid) on commit drop;
grant all on _t097 to authenticated;

do $$
declare
  client uuid := '00000000-0000-4000-8000-0000000970a1';
  other uuid := '00000000-0000-4000-8000-0000000970a2';
  person uuid := '00000000-0000-4000-8000-0000000970a3';
  pr uuid;
  mine uuid;
  theirs uuid;
  rental uuid;
  grp uuid := gen_random_uuid();
  plan uuid;
  need_item uuid;
  item uuid;
begin
  -- Shape
  if to_regclass('public.projects') is null or to_regclass('public.project_items') is null then
    raise exception 'FAIL 1: projects or project_items is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.projects'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.project_items'::regclass) then
    raise exception 'FAIL 2: RLS is off on projects or project_items';
  end if;
  if has_table_privilege('authenticated', 'public.projects', 'INSERT')
     or has_table_privilege('authenticated', 'public.projects', 'UPDATE')
     or has_table_privilege('authenticated', 'public.projects', 'DELETE')
     or has_table_privilege('authenticated', 'public.project_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_items', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_items', 'DELETE')
     or has_table_privilege('anon', 'public.projects', 'SELECT')
     or has_table_privilege('anon', 'public.project_items', 'SELECT') then
    raise exception 'FAIL 3: anon or authenticated holds a write (or anon a read) on plans';
  end if;
  if has_function_privilege('authenticated', 'public.project_create(uuid, text, jsonb, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.project_link_item(uuid, uuid, text, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.project_ref_owned(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'FAIL 4: a browser role can execute a plan function';
  end if;
  if not exists (select 1 from public.feature_flags where key = 'ubunye_projects') then
    raise exception 'FAIL 5: the ubunye_projects flag row is missing';
  end if;

  -- Records to point at
  insert into public.person_roles (user_id, role_slug, status)
  values (person, (select slug from public.roles order by sort limit 1), 'draft')
  returning id into pr;
  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, client, current_date + 5, '08:00', 4, 'Soweto') returning id into mine;
  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, other, current_date + 6, '08:00', 4, 'Soweto') returning id into theirs;
  insert into public.smart_rentals (slug, title) values ('t097-light', 'T097 light') returning id into rental;
  insert into public.equipment_bookings (user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id)
  values (client, rental, current_date + 10, current_date + 11, 100, 'cancelled', grp);

  -- Ownership, fail closed
  if not public.project_ref_owned(client, 'people_request', mine) then raise exception 'FAIL 6: own request not recognised'; end if;
  if public.project_ref_owned(client, 'people_request', theirs) then raise exception 'FAIL 7: someone else''s request counted as own'; end if;
  if not public.project_ref_owned(client, 'gear_order', grp) then raise exception 'FAIL 8: own gear order not recognised'; end if;
  if public.project_ref_owned(other, 'gear_order', grp) then raise exception 'FAIL 9: someone else''s gear order counted as own'; end if;
  if public.project_ref_owned(client, 'need', mine) or public.project_ref_owned(client, 'bogus', mine) then raise exception 'FAIL 10: an unknown kind counted as owned'; end if;

  -- Create: all or nothing
  begin
    perform public.project_create(client, 'Music video', '{"outcome":"music video"}', null,
      jsonb_build_array(jsonb_build_object('kind', 'need', 'need', '{"type":"unsupported","label":"Editor"}'::jsonb),
                        jsonb_build_object('kind', 'people_request', 'ref_id', theirs)));
    raise exception 'FAIL 11: a plan pointing at someone else''s request was created';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.projects where client_id = client) then raise exception 'FAIL 12: a refused plan left a row behind'; end if;

  plan := public.project_create(client, 'Music video in Soweto', '{"outcome":"music video","place":"Soweto","budget_cents":1500000}', null,
    jsonb_build_array(jsonb_build_object('kind', 'need', 'need', '{"type":"person","label":"Videographer","role_slug":"photographer-videographer"}'::jsonb),
                      jsonb_build_object('kind', 'need', 'need', '{"type":"unsupported","label":"Editor","status":"coming_soon"}'::jsonb)));
  select id into need_item from public.project_items where project_id = plan and need->>'label' = 'Videographer';
  insert into _t097 values ('plan', plan), ('mine', mine);

  -- need XOR ref
  begin
    insert into public.project_items (project_id, kind, ref_id, need) values (plan, 'people_request', mine, '{"x":1}');
    raise exception 'FAIL 13: an item with both a ref and a need was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.project_items (project_id, kind) values (plan, 'need');
    raise exception 'FAIL 14: a need item with no need was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.projects (client_id, title, brief) values (client, 'Too big', jsonb_build_object('outcome', repeat('x', 3000)));
    raise exception 'FAIL 15: an oversized brief was accepted';
  exception when check_violation then null;
  end;

  -- Link: own request replaces the need; twice gives the same item; someone else's refused
  item := public.project_link_item(plan, client, 'people_request', mine, need_item);
  if exists (select 1 from public.project_items where id = need_item) then raise exception 'FAIL 16: the filled need is still there'; end if;
  if public.project_link_item(plan, client, 'people_request', mine) <> item then raise exception 'FAIL 17: linking twice made a second item'; end if;
  begin
    perform public.project_link_item(plan, client, 'people_request', theirs);
    raise exception 'FAIL 18: someone else''s request was linked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.project_link_item(plan, other, 'people_request', theirs);
    raise exception 'FAIL 19: someone else linked into this plan';
  exception when insufficient_privilege then null;
  end;
  -- One booking, one plan
  declare second_plan uuid;
  begin
    second_plan := public.project_create(client, 'Second', '{}', null, jsonb_build_array(jsonb_build_object('kind', 'need', 'need', '{"label":"x"}'::jsonb)));
    begin
      perform public.project_link_item(second_plan, client, 'people_request', mine);
      raise exception 'FAIL 20: one request was linked into two plans';
    exception when unique_violation then null;
    end;
  end;

  -- A plan proposal is a valid agent action
  insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
  values (gen_random_uuid(), client, 'project_create', 0, '{}', '{}', 'x', now() + interval '15 minutes');

  -- Chat cards
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'cards')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'tool_ref_ids') then
    raise exception 'FAIL 21: chat_messages.cards or tool_ref_ids is missing';
  end if;
end $$;

-- RLS: the client reads their own plan and items; someone else reads nothing and cannot write.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000970a1', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.projects where id = (select v from _t097 where k = 'plan')) <> 1 then raise exception 'FAIL 22: the client cannot read their own plan'; end if;
  if (select count(*) from public.project_items where project_id = (select v from _t097 where k = 'plan')) < 2 then raise exception 'FAIL 23: the client cannot read their own plan items'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000970a2', 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.projects where id = (select v from _t097 where k = 'plan')) then raise exception 'FAIL 24: another client read the plan'; end if;
  if exists (select 1 from public.project_items where project_id = (select v from _t097 where k = 'plan')) then raise exception 'FAIL 25: another client read the plan items'; end if;
  begin
    insert into public.projects (client_id, title) values ('00000000-0000-4000-8000-0000000970a2', 'Mine now');
    raise exception 'FAIL 26: a browser session inserted a plan';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.project_items set need = '{"label":"hacked"}' where project_id = (select v from _t097 where k = 'plan');
    raise exception 'FAIL 27: a browser session updated plan items';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
