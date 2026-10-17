-- 096 test: one open People request per client, person and first day.
-- One transaction, rolled back. Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/096-people-request-dedupe.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000960a1', 't096-client@example.invalid');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000960a2', 't096-person@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000960a1') on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000960a2') on conflict (id) do nothing;

do $$
declare
  client uuid := '00000000-0000-4000-8000-0000000960a1';
  person uuid := '00000000-0000-4000-8000-0000000960a2';
  pr uuid;
  first_rq uuid;
begin
  if to_regclass('public.role_booking_requests_one_open') is null then
    raise exception 'FAIL 1: the index role_booking_requests_one_open is missing';
  end if;

  insert into public.person_roles (user_id, role_slug, status)
  values (person, (select slug from public.roles order by sort limit 1), 'draft')
  returning id into pr;

  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, client, current_date + 3, '08:00', 4, 'Soweto')
  returning id into first_rq;

  -- The same ask again while the first is open: refused.
  begin
    insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
    values (pr, client, current_date + 3, '09:00', 6, 'Soweto');
    raise exception 'FAIL 2: a second open request for the same person and day was accepted';
  exception when unique_violation then null;
  end;

  -- Another day for the same person: allowed.
  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, client, current_date + 4, '08:00', 4, 'Soweto');

  -- Still refused while accepted or confirmed.
  update public.role_booking_requests set status = 'accepted' where id = first_rq;
  begin
    insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
    values (pr, client, current_date + 3, '08:00', 4, 'Soweto');
    raise exception 'FAIL 3: a second request was accepted while the first was accepted';
  exception when unique_violation then null;
  end;

  -- After a decline the client can ask again.
  update public.role_booking_requests set status = 'declined' where id = first_rq;
  insert into public.role_booking_requests (person_role_id, client_id, requested_date, arrival_time, duration_hours, area)
  values (pr, client, current_date + 3, '08:00', 4, 'Soweto');
end $$;

rollback;
