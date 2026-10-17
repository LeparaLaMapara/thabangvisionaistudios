-- 098 test: plan timeline and moving a plan. Due dates, steps and order are
-- stored; a filled need passes on its step; moving shifts only needs and the
-- brief, only for the client's own open plan; plan moves are valid proposals;
-- browsers cannot run the move. One transaction, rolled back. Raises on the
-- first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/098-plan-timeline.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000980a1', 't098-client@example.invalid');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000980a2', 't098-other@example.invalid');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000980a3', 't098-person@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000980a1') on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000980a2') on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000980a3') on conflict (id) do nothing;

do $$
declare
  client uuid := '00000000-0000-4000-8000-0000000980a1';
  other uuid := '00000000-0000-4000-8000-0000000980a2';
  person uuid := '00000000-0000-4000-8000-0000000980a3';
  pr uuid;
  req uuid;
  plan uuid;
  mua_need uuid;
  item uuid;
  b jsonb;
begin
  -- Shape
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_items' and column_name = 'due_date')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_items' and column_name = 'step')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_items' and column_name = 'position') then
    raise exception 'FAIL 1: project_items timeline columns are missing';
  end if;
  if has_function_privilege('authenticated', 'public.project_move_date(uuid, uuid, date, date, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.project_move_date(uuid, uuid, date, date, text, integer)', 'EXECUTE') then
    raise exception 'FAIL 2: a browser role can move a plan';
  end if;

  -- Create stores due date, step and position
  plan := public.project_create(client, 'Traditional wedding', '{"outcome":"traditional wedding","date":"2027-03-20","shoot_type":"traditional-wedding"}', null,
    jsonb_build_array(
      jsonb_build_object('kind', 'need', 'need', '{"type":"person","status":"to_book","label":"Photographer or videographer","role_slug":"photographer-videographer"}'::jsonb, 'due_date', '2027-02-20', 'step', 'Send requests to the photographer or videographer', 'position', 0),
      jsonb_build_object('kind', 'need', 'need', '{"type":"person","status":"to_book","label":"Make-up artist","role_slug":"makeup-artist"}'::jsonb, 'due_date', '2027-03-06', 'step', 'Send requests for make-up and hair', 'position', 1),
      jsonb_build_object('kind', 'need', 'need', '{"type":"unsupported","status":"not_offered","label":"Catering"}'::jsonb, 'position', 2)));
  if (select count(*) from public.project_items where project_id = plan and due_date is not null) <> 2 then raise exception 'FAIL 3: due dates were not stored'; end if;
  if (select step from public.project_items where project_id = plan and position = 1) <> 'Send requests for make-up and hair' then raise exception 'FAIL 4: step or position not stored'; end if;
  select id into mua_need from public.project_items where project_id = plan and position = 1;

  -- A plan with junk timeline values still saves, without them
  item := public.project_create(client, 'Junk', '{}', null,
    jsonb_build_array(jsonb_build_object('kind', 'need', 'need', '{"label":"x"}'::jsonb, 'due_date', 'not a date', 'position', 'x')));
  if exists (select 1 from public.project_items where project_id = item and (due_date is not null or position is not null)) then raise exception 'FAIL 5: junk timeline values were stored'; end if;
  begin
    insert into public.project_items (project_id, kind, need, position) values (plan, 'need', '{"label":"y"}', 500);
    raise exception 'FAIL 6: a position out of range was accepted';
  exception when check_violation then null;
  end;

  -- A request filling the make-up need keeps its step and position
  insert into public.person_roles (user_id, role_slug, status)
  values (person, (select slug from public.roles order by sort limit 1), 'draft') returning id into pr;
  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, client, current_date + 30, '08:00', 4, 'Soweto') returning id into req;
  item := public.project_link_item(plan, client, 'people_request', req, mua_need);
  if (select position from public.project_items where id = item) is distinct from 1::smallint
     or (select step from public.project_items where id = item) is distinct from 'Send requests for make-up and hair' then
    raise exception 'FAIL 7: the filled need did not pass on its step and position';
  end if;

  -- Move: someone else cannot; a closed plan cannot; bad dates refused
  if public.project_move_date(plan, other, '2027-04-03', null, 'Saturday 3 April 2027', 14) then raise exception 'FAIL 8: someone else moved the plan'; end if;
  begin
    perform public.project_move_date(plan, client, '2027-04-03', '2027-04-01', 'x', 14);
    raise exception 'FAIL 9: an end before the start was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Move: the brief and the needs' due dates shift; the request keeps no due date
  if not public.project_move_date(plan, client, '2027-04-03', null, 'Saturday 3 April 2027', 14) then raise exception 'FAIL 10: the client could not move their plan'; end if;
  select brief into b from public.projects where id = plan;
  if b->>'date' <> '2027-04-03' or b->>'date_label' <> 'Saturday 3 April 2027' or b->>'shoot_type' <> 'traditional-wedding' then raise exception 'FAIL 11: the brief did not move (or lost fields): %', b; end if;
  if (select due_date from public.project_items where project_id = plan and position = 0) <> '2027-03-06'::date then raise exception 'FAIL 12: the need due date did not shift by 14 days'; end if;
  if (select due_date from public.project_items where id = item) is not null then raise exception 'FAIL 13: a request got a due date'; end if;
  if (select requested_date from public.role_booking_requests where id = req) <> current_date + 30 then raise exception 'FAIL 14: moving the plan changed a request'; end if;

  update public.projects set status = 'closed' where id = plan;
  if public.project_move_date(plan, client, '2027-05-01', null, 'x', 28) then raise exception 'FAIL 15: a closed plan was moved'; end if;

  -- A plan move is a valid agent action; an unknown kind is not
  insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
  values (gen_random_uuid(), client, 'project_update', 0, '{}', '{}', 'x', now() + interval '15 minutes');
  begin
    insert into public.agent_actions (id, user_id, kind, amount_cents, payload, summary, nonce_hash, expires_at)
    values (gen_random_uuid(), client, 'project_delete', 0, '{}', '{}', 'x', now() + interval '15 minutes');
    raise exception 'FAIL 16: an unknown action kind was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
