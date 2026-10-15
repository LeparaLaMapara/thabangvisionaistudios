-- 092 test: albums, a person's own rate unit, multi-day requests.
-- One transaction, rolled back. Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/092-people-portfolio.test.sql

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000920a1', 't092-a@example.invalid');
insert into public.profiles (id) values ('00000000-0000-4000-8000-0000000920a1') on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'role_evidence' and column_name = 'album')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'role_evidence' and column_name = 'source_production_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'person_roles' and column_name = 'pricing_unit')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'role_booking_requests' and column_name = 'total_cents') then
    raise exception 'FAIL 1: a 092 column is missing';
  end if;
  if not has_column_privilege('anon', 'public.person_roles', 'pricing_unit', 'select') then
    raise exception 'FAIL 1: browsers cannot read the rate unit';
  end if;
  if has_column_privilege('anon', 'public.person_roles', 'user_id', 'select') then
    raise exception 'FAIL 1: 092 gave user_id back to browsers';
  end if;
  raise notice 'PASS 1: columns and grants';
end $$;

-- 2. The owner sets their own unit and adds work with an album.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000920a1', 'role', 'authenticated')::text, true);
insert into public.person_roles (user_id, role_slug, headline, price_cents) values ('00000000-0000-4000-8000-0000000920a1', 'photographer-videographer', 't092 photographer', 180000);
update public.person_roles set pricing_unit = 'day' where headline = 't092 photographer';
-- Proof is written by the server (service role) since 094.
reset role;
insert into public.role_evidence (person_role_id, step_key, kind, source, media_kind, url, album)
select id, 'work', 'photo', 'uploaded', 'image', 'https://res.cloudinary.com/demo/image/upload/x.jpg', 'Maternity'
  from public.person_roles where headline = 't092 photographer';
set local role authenticated;

do $$
begin
  if (select pricing_unit from public.person_roles where headline = 't092 photographer') <> 'day' then
    raise exception 'FAIL 2: the person could not set per day';
  end if;
  begin
    update public.person_roles set pricing_unit = 'week' where headline = 't092 photographer';
    raise exception 'FAIL 2: an unknown unit was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 2: own unit and albums';
end $$;

reset role;
do $$ begin raise notice '092 OK'; end $$;

rollback;
