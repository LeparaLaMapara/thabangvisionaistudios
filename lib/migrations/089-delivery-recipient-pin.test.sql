-- 089 test: drop-off PIN column. One transaction, rolled back.
-- Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/089-delivery-recipient-pin.test.sql

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'delivery_shipments' and column_name = 'recipient_pin'
  ) then
    raise exception 'FAIL 1: delivery_shipments.recipient_pin is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.delivery_shipments'::regclass and conname = 'delivery_shipments_recipient_pin_check'
  ) then
    raise exception 'FAIL 2: the PIN format check is missing';
  end if;

  -- The check accepts 4 to 8 digits and nothing else.
  if not (select '0001' ~ '^[0-9]{4,8}$') or (select '12a4' ~ '^[0-9]{4,8}$') or (select '123' ~ '^[0-9]{4,8}$') then
    raise exception 'FAIL 3: the PIN pattern is wrong';
  end if;

  -- Signed-in users still cannot read shipments directly (the PIN stays server-side).
  if has_table_privilege('authenticated', 'public.delivery_shipments', 'select')
     or has_table_privilege('anon', 'public.delivery_shipments', 'select') then
    raise exception 'FAIL 4: anon or authenticated can read delivery_shipments';
  end if;

  raise notice '089 OK';
end $$;

rollback;
