-- 093 test: studios category and half-day price. One transaction, rolled back.
-- Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/093-studio-rentals.test.sql

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'smart_rentals' and column_name = 'price_per_half_day'
  ) then
    raise exception 'FAIL 1: smart_rentals.price_per_half_day is missing';
  end if;

  -- A studio row is accepted, with a half-day price.
  insert into public.smart_rentals (slug, title, category, owner_type, price_per_day, price_per_half_day)
  values ('t093-studio', 'T093 Studio', 'studios', 'studio', 3500, 1500);

  -- Every older category still works.
  insert into public.smart_rentals (slug, title, category, owner_type, price_per_day)
  values ('t093-camera', 'T093 Camera', 'cameras-optics', 'studio', 100);

  begin
    insert into public.smart_rentals (slug, title, category, owner_type) values ('t093-bad', 'T093 Bad', 'locations', 'studio');
    raise exception 'FAIL 2: an unknown category was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.smart_rentals set price_per_half_day = 0 where slug = 't093-studio';
    raise exception 'FAIL 3: a zero half-day price was accepted';
  exception when check_violation then null;
  end;

  -- Clearing the half-day price removes the option.
  update public.smart_rentals set price_per_half_day = null where slug = 't093-studio';

  raise notice '093 OK';
end $$;

rollback;
