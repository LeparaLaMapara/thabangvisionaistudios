-- 094 test: security re-check of 2026-10-15. One transaction, rolled back.
-- Raises on the first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/094-security-recheck.test.sql

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000940a1', 't094-person@example.invalid'),
  ('00000000-0000-4000-8000-0000000940b1', 't094-buyer@example.invalid'),
  ('00000000-0000-4000-8000-0000000940c1', 't094-seller@example.invalid'),
  ('00000000-0000-4000-8000-0000000940d1', 't094-other@example.invalid');
insert into public.profiles (id) values
  ('00000000-0000-4000-8000-0000000940a1'), ('00000000-0000-4000-8000-0000000940b1'),
  ('00000000-0000-4000-8000-0000000940c1'), ('00000000-0000-4000-8000-0000000940d1')
on conflict (id) do nothing;

-- 1. Grants: anon reads only the gallery columns; the client updates only
--    an order's status and notes.
do $$
declare
  c text;
begin
  foreach c in array array['note', 'device_summary', 'captured_at', 'booking_id', 'verified_by', 'source_production_id', 'legal_code', 'storage_ref'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'role_evidence' and column_name = c)
       and has_column_privilege('anon', 'public.role_evidence', c, 'select') then
      raise exception 'FAIL 1: anon can still read role_evidence.%', c;
    end if;
  end loop;
  foreach c in array array['id', 'person_role_id', 'kind', 'url', 'album'] loop
    if not has_column_privilege('anon', 'public.role_evidence', c, 'select') then
      raise exception 'FAIL 1: anon lost the gallery column role_evidence.%', c;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.role_evidence', 'note', 'select') then
    raise exception 'FAIL 1: the owner can no longer read their own rows back';
  end if;
  if has_table_privilege('authenticated', 'public.role_evidence', 'insert')
     or has_column_privilege('authenticated', 'public.role_evidence', 'source', 'insert') then
    raise exception 'FAIL 1: browsers can still insert proof directly';
  end if;
  foreach c in array array['total', 'seller_id', 'buyer_id', 'platform_fee', 'seller_payout', 'payfast_payment_id'] loop
    if has_column_privilege('authenticated', 'public.orders', c, 'update') then
      raise exception 'FAIL 1: signed-in users can still update orders.%', c;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.orders', 'status', 'update') then
    raise exception 'FAIL 1: the order route can no longer move a status';
  end if;
  raise notice 'PASS 1: grants';
end $$;

-- 2. An approved profile with work, a vouch and a "public" vouch (as a
--    direct REST insert could make), set up as the platform.
insert into public.person_roles (id, user_id, role_slug, headline, status)
values ('00000000-0000-4000-8000-0000000940f1', '00000000-0000-4000-8000-0000000940a1', 'photographer-videographer', 't094 photographer', 'approved');
insert into public.role_evidence (person_role_id, step_key, kind, source, url, is_public, note, device_summary)
values
  ('00000000-0000-4000-8000-0000000940f1', 'work', 'photo', 'uploaded', 'https://res.cloudinary.com/demo/image/upload/t094.jpg', true, null, '{"device":"t094 phone"}'),
  ('00000000-0000-4000-8000-0000000940f1', null, 'vouch', 'vouched', null, true, 't094 Thandi 0820000000', null);

-- anon sees the photo only, and only through the allowed columns.
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$
begin
  if (select count(*) from public.role_evidence where person_role_id = '00000000-0000-4000-8000-0000000940f1') <> 1 then
    raise exception 'FAIL 2: anon should see exactly the one public photo (vouches are never public)';
  end if;
  begin
    perform note from public.role_evidence limit 1;
    raise exception 'FAIL 2: anon read the note column';
  exception when insufficient_privilege then null;
  end;
  begin
    perform device_summary from public.role_evidence limit 1;
    raise exception 'FAIL 2: anon read device_summary';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2: anon gallery read';
end $$;
reset role;

-- Another signed-in user reads nothing of it through the API.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000940d1', 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from public.role_evidence where person_role_id = '00000000-0000-4000-8000-0000000940f1') <> 0 then
    raise exception 'FAIL 3: another signed-in user can read the profile''s evidence rows';
  end if;
  raise notice 'PASS 3: other users read nothing';
end $$;
reset role;

-- The owner still reads all of their own rows, but cannot file proof
-- straight through the API (FAIL 1 checks the grant itself).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000940a1', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into public.role_evidence (person_role_id, step_key, kind, source, url)
    values ('00000000-0000-4000-8000-0000000940f1', 'work', 'photo', 'captured_in_app', 'https://example.invalid/forged.jpg');
    raise exception 'FAIL 4: the owner inserted proof straight through the API';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.role_evidence where person_role_id = '00000000-0000-4000-8000-0000000940f1' and (note is not null or device_summary is not null)) <> 2 then
    raise exception 'FAIL 4: the owner cannot read their own evidence';
  end if;
  raise notice 'PASS 4: owner reads own';
end $$;
reset role;

-- 5. Orders: the route's moves only.
insert into public.listings (id, user_id, type, title, slug)
values ('00000000-0000-4000-8000-0000000940c9', '00000000-0000-4000-8000-0000000940c1', 'sell', 't094 listing', 't094-listing');
insert into public.orders (id, buyer_id, seller_id, listing_id, status, total, platform_fee, seller_payout)
values
  ('00000000-0000-4000-8000-0000000940e1', '00000000-0000-4000-8000-0000000940b1', '00000000-0000-4000-8000-0000000940c1', '00000000-0000-4000-8000-0000000940c9', 'pending', 500, 50, 450),
  ('00000000-0000-4000-8000-0000000940e2', '00000000-0000-4000-8000-0000000940b1', '00000000-0000-4000-8000-0000000940c1', '00000000-0000-4000-8000-0000000940c9', 'paid', 500, 50, 450);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000940b1', 'role', 'authenticated')::text, true);
do $$
begin
  -- Buyer: no forged paid state, no price change.
  begin
    update public.orders set status = 'paid' where id = '00000000-0000-4000-8000-0000000940e1';
    raise exception 'FAIL 5: the buyer marked their own order paid';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set total = 1 where id = '00000000-0000-4000-8000-0000000940e1';
    raise exception 'FAIL 5: the buyer changed the total';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'completed' where id = '00000000-0000-4000-8000-0000000940e2';
    raise exception 'FAIL 5: the buyer completed a paid order';
  exception when insufficient_privilege then null;
  end;
  -- Buyer may cancel a pending order.
  update public.orders set status = 'cancelled', notes = 't094 changed my mind' where id = '00000000-0000-4000-8000-0000000940e1';
  if (select status from public.orders where id = '00000000-0000-4000-8000-0000000940e1') <> 'cancelled' then
    raise exception 'FAIL 5: the buyer could not cancel a pending order';
  end if;
  raise notice 'PASS 5: buyer moves';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000940c1', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    update public.orders set status = 'completed' where id = '00000000-0000-4000-8000-0000000940e2';
    raise exception 'FAIL 6: the seller jumped paid -> completed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'paid' where id = '00000000-0000-4000-8000-0000000940e1';
    raise exception 'FAIL 6: the seller marked a cancelled order paid';
  exception when insufficient_privilege then null;
  end;
  update public.orders set status = 'shipped' where id = '00000000-0000-4000-8000-0000000940e2';
  update public.orders set status = 'delivered' where id = '00000000-0000-4000-8000-0000000940e2';
  update public.orders set status = 'completed' where id = '00000000-0000-4000-8000-0000000940e2';
  if (select status from public.orders where id = '00000000-0000-4000-8000-0000000940e2') <> 'completed' then
    raise exception 'FAIL 6: the seller could not move one step at a time';
  end if;
  raise notice 'PASS 6: seller moves';
end $$;
reset role;

-- 7. The platform (service role) is not limited.
set local role service_role;
update public.orders set status = 'refunded', total = 0 where id = '00000000-0000-4000-8000-0000000940e2';
reset role;

do $$ begin raise notice '094 OK'; end $$;

rollback;
