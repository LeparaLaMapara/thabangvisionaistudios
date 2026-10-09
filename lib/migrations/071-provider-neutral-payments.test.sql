-- 071 test script. One transaction, ends in ROLLBACK. Prints PASS or aborts with FAIL.
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/071-provider-neutral-payments.test.sql
begin;

do $$
declare
  u uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  b1 uuid;
  b2 uuid;
  rec record;
begin
  insert into auth.users (id, email) values (u, 'p2-071-' || u || '@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.smart_rentals (id, slug, title, quantity, is_published) values (r, 'p2-071-' || r, 'Test', 1, true);

  -- A manual payment: neutral reference copied, provider 'manual'.
  insert into public.equipment_bookings (user_id, rental_id, start_date, end_date, total_price, status, payfast_payment_id)
  values (u, r, '2032-01-01', '2032-01-02', 100, 'confirmed', 'manual:eft:abc') returning id into b1;
  select payment_provider, provider_reference into rec from public.equipment_bookings where id = b1;
  if rec.provider_reference <> 'manual:eft:abc' or rec.payment_provider <> 'manual' then raise exception 'FAIL: manual reference not mirrored (%)', rec; end if;

  -- A provider payment on a 070 order: provider taken from the payment intent.
  insert into public.rental_payment_intents (checkout_group_id, reference, provider, user_id, expected_amount_cents, hire_cents, deposit_cents, hold_expires_at)
  values (g, g::text, 'paystack', u, 10000, 10000, 0, now() + interval '1 hour');
  insert into public.equipment_bookings (user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id)
  values (u, r, '2032-02-01', '2032-02-02', 100, 'pending', g) returning id into b2;
  update public.equipment_bookings set payfast_payment_id = 'tx_123', status = 'confirmed' where id = b2;
  select payment_provider, provider_reference into rec from public.equipment_bookings where id = b2;
  if rec.provider_reference <> 'tx_123' or rec.payment_provider <> 'paystack' then raise exception 'FAIL: provider payment not mirrored (%)', rec; end if;
  raise notice 'PASS: legacy writes are mirrored into the neutral columns (dual-write)';

  -- An unrelated update leaves them alone.
  update public.equipment_bookings set notes = 'x' where id = b2;
  if (select provider_reference from public.equipment_bookings where id = b2) <> 'tx_123' then raise exception 'FAIL: unrelated update changed the reference'; end if;

  if exists (select 1 from public.payment_reference_mismatches where id in (b1, b2)) then raise exception 'FAIL: mismatch view reports mirrored rows'; end if;
  raise notice 'PASS: reconciliation view is empty for mirrored rows';
end $$;

rollback;
select 'ALL 071 CHECKS PASSED' as result;
