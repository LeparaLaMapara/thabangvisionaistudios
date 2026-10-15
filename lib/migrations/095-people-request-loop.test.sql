-- 095 test: the People request loop. One transaction, rolled back.
-- Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/095-people-request-loop.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000950a1', 't095-a@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000950a1') on conflict (id) do nothing;

do $$
declare
  u uuid;
  pr uuid;
  rq uuid;
begin
  u := '00000000-0000-4000-8000-0000000950a1';

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'role_booking_requests'
        and column_name in ('responded_at', 'responded_by', 'client_note')) <> 3 then
    raise exception 'FAIL 1: responded_at, responded_by or client_note is missing';
  end if;

  insert into public.person_roles (user_id, role_slug, status)
  values (u, (select slug from public.roles order by sort limit 1), 'draft')
  returning id into pr;

  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, u, current_date + 3, '08:00', 4, 'Soweto')
  returning id into rq;

  -- The new step: date agreed, not paid. Then paid, then a decline with a note.
  update public.role_booking_requests set status = 'accepted', responded_at = now(), responded_by = u where id = rq;
  update public.role_booking_requests set status = 'confirmed', confirmed_at = now() where id = rq;
  update public.role_booking_requests set status = 'declined', client_note = 'They are away that week.' where id = rq;

  begin
    update public.role_booking_requests set status = 'paid' where id = rq;
    raise exception 'FAIL 2: an unknown status was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.role_booking_requests set client_note = repeat('x', 501) where id = rq;
    raise exception 'FAIL 3: a 501 character note was accepted';
  exception when check_violation then null;
  end;

  -- Old types still work, the new ones are allowed.
  insert into public.notifications (user_id, type, title, body) values (u, 'gig_request', 't', 't');
  insert into public.notifications (user_id, type, title, body) values (u, 'people_request', 't', 't');
  insert into public.notifications (user_id, type, title, body) values (u, 'people_request_update', 't', 't');
  insert into public.notifications (user_id, type, title, body) values (u, 'people_profile_update', 't', 't');

  begin
    insert into public.notifications (user_id, type, title, body) values (u, 'people_nonsense', 't', 't');
    raise exception 'FAIL 4: an unknown notification type was accepted';
  exception when check_violation then null;
  end;

  -- Browsers still cannot read requests.
  if has_table_privilege('authenticated', 'public.role_booking_requests', 'select') then
    raise exception 'FAIL 5: signed-in browsers can read role_booking_requests';
  end if;

  raise notice '095 OK';
end $$;

rollback;
