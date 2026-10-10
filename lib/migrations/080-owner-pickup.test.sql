-- 080 test script. DEV DATABASE ONLY. Runs in ONE transaction and ends in
-- ROLLBACK, so it leaves no trace. Creates its own throwaway users, listings,
-- bookings, addresses and legs. Run AFTER applying 076 and 080:
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/080-owner-pickup.test.sql
--
-- Every check prints "PASS n: …" as a NOTICE or aborts with "FAIL n: …".
--
-- Covers:
--    1. an owner_pickup address must name its owner; one ACTIVE pickup
--       address per owner; a retired one makes room for a new one
--    2. one order can hold an outbound leg from our site AND one from each
--       owner (same attempt number); a second live leg for the SAME origin is
--       the existing row (created = false), for our site exactly as before 080
--    3. privacy (D21, D-88): the owner reads their own pickup address; the
--       renter whose order uses it, another owner, a stranger, an admin
--       through the API and anon read nothing of it
--    4. clients never read a shipment's origin_owner_id or address ids; the
--       owner sees the leg from their address (non-sensitive columns only)
--    5. retention: an ACTIVE pickup address is never purged; a retired one is
--       purged once no live leg uses it, never while one does
--    6. listing_private.owner_pickup defaults to false and clients cannot write it
--    7. notifications accept the rental_owner_* types and still accept old ones
--    8. the replaced functions stay service_role only, with a pinned search_path
--    review fixes:
--    9. the cancelled-order sweep keeps an owner's scheduled return while THAT
--       owner's gear is with the renter, even when the studio's gear is back
--       (per origin, R-84); an origin whose gear never went out is still listed
--   10. delivery_save_owner_pickup retires and inserts in one transaction: a
--       failed insert leaves the old address active; service_role only
--   11. (3f) the renter reads their own quotes' fee, never the provider's cost
--       or where the gear is (origin_owner_id, address ids)

begin;

do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000800a1';
  stranger uuid := '00000000-0000-4000-8000-0000000800a2';
  staff uuid := '00000000-0000-4000-8000-0000000800a3';
  owner_a uuid := '00000000-0000-4000-8000-0000000800b1';
  owner_b uuid := '00000000-0000-4000-8000-0000000800b2';
  studio_cam uuid := '00000000-0000-4000-8000-0000000800c1';
  lens_a uuid := '00000000-0000-4000-8000-0000000800c2';
  light_b uuid := '00000000-0000-4000-8000-0000000800c3';
  grp uuid := '00000000-0000-4000-8000-0000000800d1';
  bk_s uuid := '00000000-0000-4000-8000-0000000800e1';
  bk_a uuid := '00000000-0000-4000-8000-0000000800e2';
  bk_b uuid := '00000000-0000-4000-8000-0000000800e3';
  office uuid := '00000000-0000-4000-8000-0000000800f1';
  home uuid := '00000000-0000-4000-8000-0000000800f2';
  pick_a uuid := '00000000-0000-4000-8000-0000000800f3';
  pick_b uuid := '00000000-0000-4000-8000-0000000800f4';
  pick_a_old uuid := '00000000-0000-4000-8000-0000000800f5';
  q_s uuid := '00000000-0000-4000-8000-000000080101';
  q_a uuid := '00000000-0000-4000-8000-000000080102';
  q_b uuid := '00000000-0000-4000-8000-000000080103';
  r jsonb;
  s_site uuid;
  s_a uuid;
  s_b uuid;
  n integer;
begin
  insert into auth.users (id, email) values
    (renter, 'p8-renter@example.invalid'), (stranger, 'p8-stranger@example.invalid'), (staff, 'p8-staff@example.invalid'),
    (owner_a, 'p8-owner-a@example.invalid'), (owner_b, 'p8-owner-b@example.invalid');
  insert into public.profiles (id) values (renter), (stranger), (staff), (owner_a), (owner_b) on conflict (id) do nothing;
  update public.profiles set role = 'admin' where id = staff;
  insert into public.smart_rentals (id, slug, title, quantity, is_published, price_per_day, replacement_value, owner_id, owner_type) values
    (studio_cam, 'p8-cam-' || studio_cam, 'P8 studio camera', 1, true, 500, 15000, null, 'studio'),
    (lens_a, 'p8-lens-' || lens_a, 'P8 lens (owner A)', 1, true, 300, 8000, owner_a, 'community'),
    (light_b, 'p8-light-' || light_b, 'P8 light (owner B)', 1, true, 200, 6000, owner_b, 'community');
  insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id) values
    (bk_s, renter, studio_cam, '2030-03-01', '2030-03-03', 1500, 'confirmed', grp, null),
    (bk_a, renter, lens_a, '2030-03-01', '2030-03-03', 900, 'confirmed', grp, owner_a),
    (bk_b, renter, light_b, '2030-03-01', '2030-03-03', 600, 'confirmed', grp, owner_b);

  insert into public.delivery_addresses (id, user_id, purpose, formatted_address, suburb, city, province, postal_code, lat, lng, contact_name, contact_phone, instructions, verified_by) values
    (office, null, 'platform_site', '99 Smith Street, Braamfontein', 'Braamfontein', 'Johannesburg', 'Gauteng', '2001', -26.19, 28.03, 'Desk', '0000000000', null, 'test'),
    (home, renter, 'renter_address', '1 Test Road, Sandton', 'Sandton', 'Johannesburg', 'Gauteng', '2196', -26.10, 28.05, 'Thandi', '0000000001', null, 'test'),
    (pick_a, owner_a, 'owner_pickup', '7 Owner Lane, Melville', 'Melville', 'Johannesburg', 'Gauteng', '2092', -26.17, 28.00, 'Ayanda', '0000000003', 'Ring twice', 'test'),
    (pick_b, owner_b, 'owner_pickup', '9 Owner Road, Parkhurst', 'Parkhurst', 'Johannesburg', 'Gauteng', '2193', -26.14, 28.02, 'Bongani', '0000000004', null, 'test');

  -- 1. Must name its owner; one active per owner; retiring makes room.
  begin
    insert into public.delivery_addresses (user_id, purpose, formatted_address, lat, lng, contact_name, contact_phone, verified_by)
    values (null, 'owner_pickup', 'Nobody''s', -26.1, 28.0, 'x', '0', 'test');
    raise exception 'FAIL 1: an owner_pickup address without an owner was stored';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.delivery_addresses (user_id, purpose, formatted_address, lat, lng, contact_name, contact_phone, verified_by)
    values (owner_a, 'owner_pickup', 'Second active', -26.1, 28.0, 'x', '0', 'test');
    raise exception 'FAIL 1: a second ACTIVE pickup address was stored for one owner';
  exception when unique_violation then
    null;
  end;
  insert into public.delivery_addresses (id, user_id, purpose, formatted_address, suburb, city, province, lat, lng, contact_name, contact_phone, verified_by, retired_at)
  values (pick_a_old, owner_a, 'owner_pickup', '1 Old Street, Melville', 'Melville', 'Johannesburg', 'Gauteng', -26.17, 28.00, 'Ayanda', '0000000003', 'test', now() - interval '200 days');
  raise notice 'PASS 1: an owner pickup address names its owner; one active per owner; retired ones are kept apart';

  -- 2. One leg per origin.
  insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents, platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at, origin_owner_id)
  values (q_s, renter, grp, 'outbound', 'manual', 'own_fleet', 15000, 15000, 0, 15000, array[studio_cam], office, home, now() + interval '30 minutes', null),
         (q_a, renter, grp, 'outbound', 'manual', 'own_fleet', 12000, 12000, 0, 12000, array[lens_a], pick_a, home, now() + interval '30 minutes', owner_a),
         (q_b, renter, grp, 'outbound', 'manual', 'own_fleet', 11000, 11000, 0, 11000, array[light_b], pick_b, home, now() + interval '30 minutes', owner_b);
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 1, 'renterId', renter,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk_s, 'rentalId', studio_cam, 'ownerId', null)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q_s, 'merchantReference', 'tvd_p8_o1', 'quoteAmountCents', 15000,
      'customerFeeCents', 15000, 'platformFeeCents', 0, 'replacementValueCents', 1500000, 'originAddressId', office, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_p8_o1', 'idempotencyKey', 'delivery-dispatch:p8:outbound:1', 'providerId', 'manual'));
  s_site := (r ->> 'shipment_id')::uuid;
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 1, 'originOwnerId', owner_a, 'renterId', renter,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk_a, 'rentalId', lens_a, 'ownerId', owner_a)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q_a, 'merchantReference', 'tvd_p8_o1_a', 'quoteAmountCents', 12000,
      'customerFeeCents', 12000, 'platformFeeCents', 0, 'replacementValueCents', 800000, 'originAddressId', pick_a, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_p8_o1_a', 'idempotencyKey', 'delivery-dispatch:p8:outbound@a:1', 'providerId', 'manual'));
  if not (r ->> 'created')::boolean then raise exception 'FAIL 2: the owner A leg was not created next to the studio leg'; end if;
  s_a := (r ->> 'shipment_id')::uuid;
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 1, 'originOwnerId', owner_b, 'renterId', renter,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk_b, 'rentalId', light_b, 'ownerId', owner_b)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q_b, 'merchantReference', 'tvd_p8_o1_b', 'quoteAmountCents', 11000,
      'customerFeeCents', 11000, 'platformFeeCents', 0, 'replacementValueCents', 600000, 'originAddressId', pick_b, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_p8_o1_b', 'idempotencyKey', 'delivery-dispatch:p8:outbound@b:1', 'providerId', 'manual'));
  if not (r ->> 'created')::boolean then raise exception 'FAIL 2: the owner B leg was not created'; end if;
  s_b := (r ->> 'shipment_id')::uuid;
  if (select origin_owner_id from public.delivery_shipments where id = s_a) is distinct from owner_a
     or (select origin_owner_id from public.delivery_shipments where id = s_site) is not null then
    raise exception 'FAIL 2: the origin was not stored';
  end if;
  -- A second live attempt for owner A's leg returns owner A's live leg (never the studio's).
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 2, 'originOwnerId', owner_a, 'renterId', renter,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk_a, 'rentalId', lens_a, 'ownerId', owner_a)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q_a, 'merchantReference', 'tvd_p8_o2_a', 'quoteAmountCents', 12000,
      'customerFeeCents', 12000, 'platformFeeCents', 0, 'replacementValueCents', 800000, 'originAddressId', pick_a, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_p8_o2_a', 'idempotencyKey', 'delivery-dispatch:p8:outbound@a:2', 'providerId', 'manual'));
  if (r ->> 'created')::boolean or (r ->> 'shipment_id')::uuid <> s_a then raise exception 'FAIL 2: a second live owner A leg was made (or the wrong leg returned)'; end if;
  -- And for our site, exactly as before 080.
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 2, 'renterId', renter,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk_s, 'rentalId', studio_cam, 'ownerId', null)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q_s, 'merchantReference', 'tvd_p8_o2', 'quoteAmountCents', 15000,
      'customerFeeCents', 15000, 'platformFeeCents', 0, 'replacementValueCents', 1500000, 'originAddressId', office, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_p8_o2', 'idempotencyKey', 'delivery-dispatch:p8:outbound:2', 'providerId', 'manual'));
  if (r ->> 'created')::boolean or (r ->> 'shipment_id')::uuid <> s_site then raise exception 'FAIL 2: a second live studio leg was made'; end if;
  -- The index itself refuses a second live leg of one origin, whatever the caller.
  begin
    insert into public.delivery_shipments (booking_group_id, leg, attempt, origin_owner_id, renter_id, items, provider, provider_kind, quote_id, merchant_reference, quote_amount_cents, customer_fee_cents, origin_address_id, destination_address_id)
    values (grp, 'outbound', 9, owner_a, renter, '[]', 'manual', 'own_fleet', q_a, 'tvd_p8_direct', 0, 0, pick_a, home);
    raise exception 'FAIL 2: a second live leg for owner A was inserted directly';
  exception when unique_violation then
    null;
  end;
  select count(*) into n from public.delivery_shipments where booking_group_id = grp;
  if n <> 3 then raise exception 'FAIL 2: % legs (expected 3: studio, owner A, owner B)', n; end if;
  raise notice 'PASS 2: one live leg per order, leg and origin; studio legs behave as before';

  -- 5. Retention (decided here as the server; checked after the client part).
  if public.delivery_redact_address(pick_a, jsonb_build_object('lat', -26.17, 'lng', 28.0), now()) then
    raise exception 'FAIL 5: an ACTIVE owner pickup address was purged';
  end if;
  if not public.delivery_redact_address(pick_a_old, jsonb_build_object('lat', -26.17, 'lng', 28.0), now()) then
    raise exception 'FAIL 5: a retired pickup address nothing uses was not purged';
  end if;
  update public.delivery_addresses set retired_at = now() where id = pick_b;
  if public.delivery_redact_address(pick_b, jsonb_build_object('lat', -26.14, 'lng', 28.02), now()) then
    raise exception 'FAIL 5: a retired pickup address was purged while a live leg uses it';
  end if;
  update public.delivery_addresses set retired_at = null where id = pick_b;
  if (select contact_phone from public.delivery_addresses where id = pick_a_old) <> '' then raise exception 'FAIL 5: the purged address kept its phone'; end if;
  raise notice 'PASS 5: an active pickup address is kept; a retired one is purged only when no live leg uses it';

  -- 6. Opt-in default.
  insert into public.listing_private (rental_id) values (lens_a), (light_b) on conflict (rental_id) do nothing;
  if (select owner_pickup from public.listing_private where rental_id = lens_a) is distinct from false then raise exception 'FAIL 6: owner pickup is not off by default'; end if;
  update public.listing_private set owner_pickup = true where rental_id = lens_a;

  -- 7. Notification types.
  insert into public.notifications (user_id, type, title, body) values
    (owner_a, 'rental_owner_pickup_scheduled', 't', 'b'), (owner_a, 'rental_owner_pickup_collected', 't', 'b'),
    (owner_a, 'rental_owner_gear_returned', 't', 'b'), (owner_a, 'rental_delivery_booked', 't', 'b'), (owner_a, 'rental_payment_received', 't', 'b');
  raise notice 'PASS 7: notifications accept rental_owner_* and still accept the older types';

  -- 8. The replaced functions.
  if has_function_privilege('authenticated', 'public.delivery_create_shipment(jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.delivery_redact_address(uuid, jsonb, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.delivery_redact_address(uuid, jsonb, timestamptz)', 'execute') then
    raise exception 'FAIL 8: a client can execute a delivery function';
  end if;
  if exists (select 1 from pg_proc p where p.proname in ('delivery_create_shipment', 'delivery_redact_address')
               and (not p.prosecdef or not p.proconfig @> array['search_path=public, pg_temp'])) then
    raise exception 'FAIL 8: a replaced function lost SECURITY DEFINER or its pinned search_path';
  end if;
  raise notice 'PASS 8: the replaced functions are service_role only, definer, pinned search_path';
end $$;

-- 3, 4 and 6 run as signed-in users.
set local role authenticated;

-- Owner A: their own pickup addresses (active and retired), nothing else.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000800b1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_addresses;
  if n <> 2 then raise exception 'FAIL 3: owner A sees % addresses (expected their own 2)', n; end if;
  if exists (select 1 from public.delivery_addresses where user_id <> '00000000-0000-4000-8000-0000000800b1') then
    raise exception 'FAIL 3: owner A reads someone else''s address';
  end if;
  if (select contact_phone from public.delivery_addresses where id = '00000000-0000-4000-8000-0000000800f3') <> '0000000003' then
    raise exception 'FAIL 3: owner A cannot read their own pickup contact';
  end if;
  -- The leg from their address: visible, without addresses, origin or money.
  select count(*) into n from public.delivery_shipments where id is not null;
  if n <> 1 then raise exception 'FAIL 4: owner A sees % legs (expected the one from their address)', n; end if;
  begin
    perform origin_owner_id from public.delivery_shipments;
    raise exception 'FAIL 4: origin_owner_id is readable by a client';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform origin_address_id from public.delivery_shipments;
    raise exception 'FAIL 4: an owner can read the origin address id';
  exception when insufficient_privilege then
    null;
  end;
  -- They read their own opt-in, but cannot change it directly.
  if (select owner_pickup from public.listing_private where rental_id = '00000000-0000-4000-8000-0000000800c2') is distinct from true then
    raise exception 'FAIL 6: owner A cannot read their own pickup opt-in';
  end if;
  begin
    update public.listing_private set owner_pickup = false where rental_id = '00000000-0000-4000-8000-0000000800c2';
    raise exception 'FAIL 6: an owner changed listing_private directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.delivery_addresses set formatted_address = 'moved' where id = '00000000-0000-4000-8000-0000000800f3';
    raise exception 'FAIL 3: an owner changed their pickup address directly (it must be verified on the server)';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 3a: an owner reads only their own pickup addresses and the leg from them, without origin or address ids';
end $$;

-- The renter whose order collects from both owners: their own address only.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000800a1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_addresses;
  if n <> 1 then raise exception 'FAIL 3: the renter sees % addresses (expected only their own)', n; end if;
  if exists (select 1 from public.delivery_addresses where purpose = 'owner_pickup') then
    raise exception 'FAIL 3: the renter reads an owner''s pickup address (D-88)';
  end if;
  select count(*) into n from public.delivery_shipments where status is not null;
  if n <> 3 then raise exception 'FAIL 4: the renter sees % of their 3 legs', n; end if;
  begin
    perform origin_address_id from public.delivery_shipments;
    raise exception 'FAIL 4: the renter can read a leg''s origin address id';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.listing_private;
  if n <> 0 then raise exception 'FAIL 6: the renter reads % owners'' private listing rows', n; end if;
  raise notice 'PASS 3b: the renter never reads an owner''s pickup address or a leg''s address ids';
end $$;

-- 11 (3f). The renter's own quotes: the fee, not the provider's side or where the gear is.
do $$
declare
  n integer;
  c text;
begin
  select count(*) into n from public.delivery_quotes;
  if n <> 3 then raise exception 'FAIL 11: the renter sees % of their 3 quotes', n; end if;
  select sum(customer_fee_cents) into n from public.delivery_quotes;
  if n <> 38000 then raise exception 'FAIL 11: the renter cannot read their own fees (%)', n; end if;
  foreach c in array array['provider_cost_cents', 'quote_amount_cents', 'platform_fee_cents', 'provider_quote_ref', 'origin_owner_id', 'origin_address_id', 'destination_address_id'] loop
    begin
      execute format('select %I from public.delivery_quotes limit 1', c);
      raise exception 'FAIL 11: the renter can read delivery_quotes.%', c;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  raise notice 'PASS 11 (3f): the renter reads their own quotes'' fee, never the provider cost or the origin';
end $$;

-- Owner B: their own address only, never owner A's (both on the same order).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000800b2', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  if exists (select 1 from public.delivery_addresses where user_id <> '00000000-0000-4000-8000-0000000800b2') then
    raise exception 'FAIL 3: owner B reads another person''s address';
  end if;
  select count(*) into n from public.delivery_shipments where id is not null;
  if n <> 1 then raise exception 'FAIL 4: owner B sees % legs (expected 1)', n; end if;
  raise notice 'PASS 3c: another owner on the same order reads only their own address';
end $$;

-- A stranger, and an admin through the API (staff use the audited server reveal only).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000800a2', 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.delivery_addresses) then raise exception 'FAIL 3: a stranger reads delivery addresses'; end if;
  if exists (select 1 from public.delivery_shipments) then raise exception 'FAIL 3: a stranger reads delivery legs'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000800a3', 'role', 'authenticated')::text, true);
do $$
begin
  if not public.is_admin() then raise exception 'FAIL 3: the test admin is not an admin'; end if;
  if exists (select 1 from public.delivery_addresses where purpose = 'owner_pickup') then
    raise exception 'FAIL 3: an admin reads owner pickup addresses through the API (only the audited reveal may, D21)';
  end if;
  raise notice 'PASS 3d: strangers and admins (through the API) read no pickup address';
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.delivery_addresses limit 1;
    raise exception 'FAIL 3: anon can query delivery_addresses';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 3e: anon reads nothing';
end $$;
reset role;

-- 9 and 10 run as the server again (after the client checks, whose counts they would change).
do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000800a1';
  owner_a uuid := '00000000-0000-4000-8000-0000000800b1';
  owner_b uuid := '00000000-0000-4000-8000-0000000800b2';
  owner_c uuid := '00000000-0000-4000-8000-0000000800b3';
  studio_cam uuid := '00000000-0000-4000-8000-0000000800c1';
  lens_a uuid := '00000000-0000-4000-8000-0000000800c2';
  light_b uuid := '00000000-0000-4000-8000-0000000800c3';
  office uuid := '00000000-0000-4000-8000-0000000800f1';
  home uuid := '00000000-0000-4000-8000-0000000800f2';
  pick_a uuid := '00000000-0000-4000-8000-0000000800f3';
  pick_b uuid := '00000000-0000-4000-8000-0000000800f4';
  pick_c uuid := '00000000-0000-4000-8000-0000000800f6';
  grp2 uuid := '00000000-0000-4000-8000-0000000800d2';
  q2 uuid := '00000000-0000-4000-8000-000000080201';
  bk2_s uuid := '00000000-0000-4000-8000-0000000802e1';
  bk2_a uuid := '00000000-0000-4000-8000-0000000802e2';
  bk2_b uuid := '00000000-0000-4000-8000-0000000802e3';
  ids uuid[];
  v_new uuid;
  n integer;
begin
  -- 9. A cancelled order: the studio's gear went out and came back; owner A's went
  --    out and its return to owner A's address is only scheduled.
  insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id) values
    (bk2_s, renter, studio_cam, '2031-05-01', '2031-05-03', 1500, 'cancelled', grp2, null),
    (bk2_a, renter, lens_a, '2031-05-01', '2031-05-03', 900, 'cancelled', grp2, owner_a);
  insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents, platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at, status, paid_reference)
  values (q2, renter, grp2, 'outbound', 'manual', 'own_fleet', 100, 100, 0, 100, array[studio_cam], office, home, now() + interval '1 hour', 'consumed', 'p8-grp2');
  insert into public.delivery_shipments (booking_group_id, leg, attempt, origin_owner_id, renter_id, items, provider, provider_kind, quote_id, merchant_reference, status, quote_amount_cents, customer_fee_cents, origin_address_id, destination_address_id)
  values (grp2, 'outbound', 1, null, renter, '[]', 'manual', 'own_fleet', q2, 'tvd_p8g2_o1', 'delivered', 100, 100, office, home),
         (grp2, 'return', 1, null, renter, '[]', 'manual', 'own_fleet', q2, 'tvd_p8g2_r1', 'delivered', 100, 100, home, office),
         (grp2, 'outbound', 1, owner_a, renter, '[]', 'manual', 'own_fleet', q2, 'tvd_p8g2_o1_a', 'delivered', 100, 100, pick_a, home),
         (grp2, 'return', 1, owner_a, renter, '[]', 'manual', 'own_fleet', q2, 'tvd_p8g2_r1_a', 'scheduled', 100, 100, home, pick_a);
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(500) x;
  if grp2 = any (coalesce(ids, '{}')) then
    raise exception 'FAIL 9: the sweep would cancel owner A''s return pickup while owner A''s gear is with the renter (studio gear being back says nothing about it)';
  end if;
  -- Owner B's gear never went out: their scheduled return is cancellable, so the order is listed.
  insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id)
  values (bk2_b, renter, light_b, '2031-05-01', '2031-05-03', 600, 'cancelled', grp2, owner_b);
  insert into public.delivery_shipments (booking_group_id, leg, attempt, origin_owner_id, renter_id, items, provider, provider_kind, quote_id, merchant_reference, status, quote_amount_cents, customer_fee_cents, origin_address_id, destination_address_id)
  values (grp2, 'return', 1, owner_b, renter, '[]', 'manual', 'own_fleet', q2, 'tvd_p8g2_r1_b', 'scheduled', 100, 100, home, pick_b);
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(500) x;
  if not (grp2 = any (coalesce(ids, '{}'))) then
    raise exception 'FAIL 9: a cancellable return of an origin whose gear never went out was not listed';
  end if;
  raise notice 'PASS 9: the cancelled-order sweep decides "the renter may still have the gear" per origin';

  -- 10. Replacing a pickup address is atomic.
  insert into auth.users (id, email) values (owner_c, 'p8-owner-c@example.invalid');
  insert into public.profiles (id) values (owner_c) on conflict (id) do nothing;
  insert into public.delivery_addresses (id, user_id, purpose, formatted_address, suburb, city, province, lat, lng, contact_name, contact_phone, verified_by)
  values (pick_c, owner_c, 'owner_pickup', '3 Old Road, Auckland Park', 'Auckland Park', 'Johannesburg', 'Gauteng', -26.18, 28.0, 'Cebo', '0000000005', 'test');
  begin
    perform public.delivery_save_owner_pickup(owner_c, jsonb_build_object('formatted_address', '4 Bad Road', 'lat', 200, 'lng', 28.0, 'contact_name', 'Cebo', 'contact_phone', '0', 'verified_by', 'test'), now());
    raise exception 'FAIL 10: an address with an impossible latitude was stored';
  exception when check_violation then
    null;
  end;
  if (select retired_at from public.delivery_addresses where id = pick_c) is not null then
    raise exception 'FAIL 10: a failed save retired the owner''s address and left them with none';
  end if;
  v_new := public.delivery_save_owner_pickup(owner_c, jsonb_build_object('formatted_address', '5 New Road, Melville', 'suburb', 'Melville', 'city', 'Johannesburg',
    'province', 'Gauteng', 'postal_code', '2092', 'lat', -26.17, 'lng', 28.0, 'contact_name', 'Cebo', 'contact_phone', '0000000005', 'instructions', null, 'verified_by', 'test'), now());
  select count(*) into n from public.delivery_addresses where user_id = owner_c and purpose = 'owner_pickup' and retired_at is null and redacted_at is null;
  if v_new is null or n <> 1 or (select retired_at from public.delivery_addresses where id = pick_c) is null
     or (select formatted_address from public.delivery_addresses where id = v_new) <> '5 New Road, Melville' then
    raise exception 'FAIL 10: the save did not leave exactly the new address active (% active)', n;
  end if;
  if has_function_privilege('authenticated', 'public.delivery_save_owner_pickup(uuid, jsonb, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.delivery_save_owner_pickup(uuid, jsonb, timestamptz)', 'execute')
     or exists (select 1 from pg_proc p where p.proname in ('delivery_save_owner_pickup', 'delivery_cancelled_orders_to_settle')
                  and (not p.prosecdef or not p.proconfig @> array['search_path=public, pg_temp'])) then
    raise exception 'FAIL 10: delivery_save_owner_pickup / the sweep is callable by a client or lost its definer settings';
  end if;
  raise notice 'PASS 10: an owner''s pickup address is replaced atomically, by the server only';
end $$;

select 'ALL 080 CHECKS PASSED' as result;
rollback;
