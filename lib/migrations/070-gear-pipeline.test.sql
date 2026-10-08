-- 070 test script. Runs in ONE transaction and ends in ROLLBACK, so it leaves
-- no trace. Creates its own throwaway users and listings.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/070-gear-pipeline.test.sql
--
-- Every check prints "PASS: …" or aborts with "FAIL: …". The real two-session
-- race (T07) needs two connections and is in scripts/db/070-concurrency.sh.

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  cam uuid := gen_random_uuid();
  lens uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid();
  g2 uuid := gen_random_uuid();
  g3 uuid := gen_random_uuid();
  g4 uuid := gen_random_uuid();
  r jsonb;
  outcome text;
  n integer;
  ok boolean;
  b1 uuid;
  journal jsonb;
begin
  insert into auth.users (id, email) values (u1, 'p1-test-u1@example.invalid'), (u2, 'p1-test-u2@example.invalid');
  insert into public.profiles (id) values (u1), (u2) on conflict (id) do nothing;
  insert into public.smart_rentals (id, slug, title, quantity, is_published, price_per_day, replacement_value)
  values (cam, 'p1-test-cam-' || cam, 'Test camera', 1, true, 1500, 10000),
         (lens, 'p1-test-lens-' || lens, 'Test lens', 1, true, 500, 4000);

  -- 1. A reservation takes the unit; a second customer is refused (T07, sequential).
  r := public.reserve_rental_order(
    jsonb_build_array(jsonb_build_object('user_id', u1, 'rental_id', cam, 'checkout_group_id', g1,
      'start_date', '2030-01-10', 'end_date', '2030-01-13', 'total_price', 4500, 'deposit_amount', 2500, 'quantity', 1)),
    jsonb_build_object('reference', g1::text, 'provider', 'paystack', 'expected_amount_cents', 700000,
      'hire_cents', 450000, 'deposit_cents', 250000, 'delivery_cents', 0),
    30);
  b1 := (r -> 'booking_ids' ->> 0)::uuid;
  if b1 is null then raise exception 'FAIL: reservation returned no booking'; end if;
  raise notice 'PASS: reservation created line % and an intent', b1;

  begin
    perform public.reserve_rental_order(
      jsonb_build_array(jsonb_build_object('user_id', u2, 'rental_id', cam, 'checkout_group_id', g2,
        'start_date', '2030-01-12', 'end_date', '2030-01-14', 'total_price', 3000, 'quantity', 1)), null, 30);
    raise exception 'FAIL: overlapping reservation was accepted';
  exception when sqlstate 'P0001' then
    raise notice 'PASS: overlapping reservation refused (insufficient_stock)';
  end;

  -- 1b. The same order cannot be reserved twice (idempotent checkout, T06).
  begin
    perform public.reserve_rental_order(
      jsonb_build_array(jsonb_build_object('user_id', u1, 'rental_id', lens, 'checkout_group_id', g1,
        'start_date', '2030-05-10', 'end_date', '2030-05-11', 'total_price', 500, 'quantity', 1)), null, 30);
    raise exception 'FAIL: a repeated order id was reserved twice';
  exception when unique_violation then
    raise notice 'PASS: repeated checkout request is refused (T06)';
  end;

  -- 1c. A cash-at-collection booking keeps its hold until the hire day ends.
  r := public.reserve_rental_order(
    jsonb_build_array(jsonb_build_object('user_id', u2, 'rental_id', lens, 'checkout_group_id', g4,
      'start_date', '2030-09-01', 'end_date', '2030-09-02', 'total_price', 1, 'quantity', 1, 'payment_method', 'cash')), null, 30);
  if (select hold_expires_at from public.equipment_bookings where checkout_group_id = g4) < '2030-09-01 22:00:00+00'::timestamptz then
    raise exception 'FAIL: cash hold expires before the hire day';
  end if;
  delete from public.booking_status_history where booking_id in (select id from public.equipment_bookings where checkout_group_id = g4);
  delete from public.equipment_bookings where checkout_group_id = g4;
  raise notice 'PASS: cash-at-collection holds until the hire day ends';

  -- 2. The return day is not resold (inclusive dates).
  begin
    perform public.reserve_rental_order(
      jsonb_build_array(jsonb_build_object('user_id', u2, 'rental_id', cam, 'checkout_group_id', g2,
        'start_date', '2030-01-13', 'end_date', '2030-01-15', 'total_price', 3000, 'quantity', 1)), null, 30);
    raise exception 'FAIL: booking starting on the previous return day was accepted';
  exception when sqlstate 'P0001' then
    raise notice 'PASS: return day is not resold';
  end;

  -- 3. All-or-nothing: a two-line cart where one line is unavailable inserts nothing.
  begin
    perform public.reserve_rental_order(
      jsonb_build_array(
        jsonb_build_object('user_id', u2, 'rental_id', lens, 'checkout_group_id', g2, 'start_date', '2030-01-10', 'end_date', '2030-01-11', 'total_price', 500, 'quantity', 1),
        jsonb_build_object('user_id', u2, 'rental_id', cam, 'checkout_group_id', g2, 'start_date', '2030-01-10', 'end_date', '2030-01-11', 'total_price', 1500, 'quantity', 1)),
      jsonb_build_object('reference', g2::text, 'provider', 'paystack', 'expected_amount_cents', 2000, 'hire_cents', 2000, 'deposit_cents', 0),
      30);
    raise exception 'FAIL: partially available cart was accepted';
  exception when sqlstate 'P0001' then
    null;
  end;
  select count(*) into n from public.equipment_bookings where checkout_group_id = g2;
  if n <> 0 or exists (select 1 from public.rental_payment_intents where checkout_group_id = g2) then
    raise exception 'FAIL: partial cart left % lines behind', n;
  end if;
  raise notice 'PASS: multi-item cart is all-or-nothing';

  -- 4. Lines for different customers/orders cannot be mixed in one call.
  begin
    perform public.reserve_rental_order(
      jsonb_build_array(
        jsonb_build_object('user_id', u2, 'rental_id', lens, 'checkout_group_id', g2, 'start_date', '2030-02-01', 'end_date', '2030-02-02', 'total_price', 1),
        jsonb_build_object('user_id', u1, 'rental_id', lens, 'checkout_group_id', g2, 'start_date', '2030-02-01', 'end_date', '2030-02-02', 'total_price', 1)),
      null, 30);
    raise exception 'FAIL: mixed-customer order accepted';
  exception when sqlstate '22023' then
    raise notice 'PASS: one order = one customer';
  end;

  -- 5. Confirm a verified payment, exactly once.
  journal := jsonb_build_object('idempotencyKey', 'payment:tx-1', 'kind', 'payment_captured', 'bookingGroupId', g1, 'memo', 't',
    'lines', jsonb_build_array(
      jsonb_build_object('account', 'cash_at_provider', 'debitCents', 700000, 'creditCents', 0),
      jsonb_build_object('account', 'unearned_hire', 'debitCents', 0, 'creditCents', 450000),
      jsonb_build_object('account', 'customer_deposits', 'debitCents', 0, 'creditCents', 250000)));
  outcome := public.confirm_rental_payment(g1::text, 'tx-1', 699999, false, journal, '[]');
  if outcome <> 'not_confirmable' then raise exception 'FAIL: wrong amount gave %', outcome; end if;
  raise notice 'PASS: wrong amount does not confirm';

  outcome := public.confirm_rental_payment(g1::text, 'tx-1', 700000, false, journal,
    jsonb_build_array(jsonb_build_object('dedupeKey', 'booking_confirmed:email:' || u1 || ':' || g1, 'kind', 'booking_confirmed', 'channel', 'email', 'userId', u1::text, 'bookingIds', jsonb_build_array(b1), 'data', '{}'::jsonb)));
  if outcome <> 'confirmed' then raise exception 'FAIL: confirm gave %', outcome; end if;
  if (select status from public.equipment_bookings where id = b1) <> 'confirmed' then raise exception 'FAIL: line not confirmed'; end if;
  outcome := public.confirm_rental_payment(g1::text, 'tx-1', 700000, false, journal, '[]');
  if outcome <> 'duplicate' then raise exception 'FAIL: replay gave %', outcome; end if;
  select count(*) into n from public.ledger_journals where idempotency_key = 'payment:tx-1';
  if n <> 1 then raise exception 'FAIL: % payment journals', n; end if;
  select count(*) into n from public.notification_outbox where dedupe_key like 'booking_confirmed:email:%' || g1;
  if n <> 1 then raise exception 'FAIL: % outbox rows', n; end if;
  raise notice 'PASS: duplicate webhook confirms once, books once, notifies once (T09, T28)';

  -- 6. Ledger is balanced and append-only.
  begin
    perform public.ledger_post(jsonb_build_object('idempotencyKey', 'bad', 'kind', 'adjustment', 'memo', 'x', 'lines', jsonb_build_array(
      jsonb_build_object('account', 'cash_at_provider', 'debitCents', 100, 'creditCents', 0),
      jsonb_build_object('account', 'unearned_hire', 'debitCents', 0, 'creditCents', 99))));
    raise exception 'FAIL: unbalanced journal accepted';
  exception when sqlstate '23514' then
    raise notice 'PASS: unbalanced journal refused';
  end;
  begin
    update public.ledger_lines set debit_cents = 1 where journal_id = (select id from public.ledger_journals where idempotency_key = 'payment:tx-1') and debit_cents > 0;
    raise exception 'FAIL: ledger line was edited';
  exception when sqlstate '42501' then
    raise notice 'PASS: ledger is append-only';
  end;

  -- 7. Gear that is not back blocks open-endedly (T24, T25); expired holds do not.
  update public.equipment_bookings set status = 'disputed' where id = b1;
  if public.rental_units_blocked(cam, '2030-03-01', '2030-03-02') <> 1 then raise exception 'FAIL: disputed gear did not block later dates'; end if;
  update public.equipment_bookings set status = 'overdue' where id = b1;
  if public.rental_units_blocked(cam, '2031-01-01', '2031-01-02') <> 1 then raise exception 'FAIL: overdue gear did not block later dates'; end if;
  update public.equipment_bookings set status = 'completed' where id = b1;
  if public.rental_units_blocked(cam, '2030-03-01', '2030-03-02') <> 0 then raise exception 'FAIL: completed booking still blocks'; end if;
  raise notice 'PASS: disputed and overdue gear stay unavailable (T24, T25)';

  insert into public.rental_blocks (rental_id, starts_on, reason) values (lens, '2030-01-01', 'repair');
  if public.rental_units_blocked(lens, '2030-06-01', '2030-06-02') <> 1 then raise exception 'FAIL: maintenance block ignored'; end if;
  update public.rental_blocks set lifted_at = now() where rental_id = lens;
  raise notice 'PASS: maintenance blocks take units off sale until lifted';

  -- 8. Late payment after the stock went to someone else → unavailable (T11).
  perform public.reserve_rental_order(
    jsonb_build_array(jsonb_build_object('user_id', u1, 'rental_id', lens, 'checkout_group_id', g3,
      'start_date', '2030-04-01', 'end_date', '2030-04-02', 'total_price', 1000, 'quantity', 1)),
    jsonb_build_object('reference', g3::text, 'provider', 'paystack', 'expected_amount_cents', 100000, 'hire_cents', 100000, 'deposit_cents', 0),
    30);
  update public.equipment_bookings set hold_expires_at = now() - interval '1 minute' where checkout_group_id = g3;
  update public.rental_payment_intents set hold_expires_at = now() - interval '1 minute' where checkout_group_id = g3;
  n := public.expire_rental_holds();
  if (select status from public.equipment_bookings where checkout_group_id = g3) <> 'cancelled' then raise exception 'FAIL: hold did not expire'; end if;
  perform public.reserve_rental_order(
    jsonb_build_array(jsonb_build_object('user_id', u2, 'rental_id', lens, 'checkout_group_id', g4,
      'start_date', '2030-04-01', 'end_date', '2030-04-02', 'total_price', 1000, 'quantity', 1)), null, 30);
  outcome := public.confirm_rental_payment(g3::text, 'tx-late', 100000, true,
    jsonb_build_object('idempotencyKey', 'payment:tx-late', 'kind', 'payment_captured', 'memo', 't', 'lines', jsonb_build_array(
      jsonb_build_object('account', 'cash_at_provider', 'debitCents', 100000, 'creditCents', 0),
      jsonb_build_object('account', 'unearned_hire', 'debitCents', 0, 'creditCents', 100000))), '[]');
  if outcome <> 'unavailable' then raise exception 'FAIL: late payment with stock gone gave %', outcome; end if;
  if exists (select 1 from public.ledger_journals where idempotency_key = 'payment:tx-late') then raise exception 'FAIL: unavailable confirm still booked money'; end if;
  raise notice 'PASS: late payment never double-books (T11)';

  outcome := public.record_unallocated_payment(g3::text, 'tx-late', 100000, 'refund_due', 'late_payment_no_stock',
    jsonb_build_object('key', 'refund:late_payment:tx-late', 'reason', 'late_payment', 'amountCents', 100000),
    jsonb_build_object('idempotencyKey', 'unallocated:tx-late', 'kind', 'unallocated_receipt', 'memo', 't', 'lines', jsonb_build_array(
      jsonb_build_object('account', 'cash_at_provider', 'debitCents', 100000, 'creditCents', 0),
      jsonb_build_object('account', 'unallocated_receipts', 'debitCents', 0, 'creditCents', 100000))), '[]');
  if outcome <> 'recorded' then raise exception 'FAIL: unallocated gave %', outcome; end if;
  outcome := public.record_unallocated_payment(g3::text, 'tx-late', 100000, 'refund_due', 'late_payment_no_stock',
    jsonb_build_object('key', 'refund:late_payment:tx-late', 'reason', 'late_payment', 'amountCents', 100000),
    jsonb_build_object('idempotencyKey', 'unallocated:tx-late', 'kind', 'unallocated_receipt', 'memo', 't', 'lines', '[]'::jsonb), '[]');
  if outcome <> 'duplicate' then raise exception 'FAIL: unallocated replay gave %', outcome; end if;
  select count(*) into n from public.refund_obligations where transaction_reference = 'tx-late';
  if n <> 1 then raise exception 'FAIL: % refund obligations for one late payment', n; end if;
  raise notice 'PASS: one refund obligation per late payment, replay-safe';

  -- 9. Refunds can never exceed the charge (T14); the same obligation twice is a no-op (T13).
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference)
  values ('refund:deposit_settlement:x', 'deposit_settlement', 250000, 700000, 'tx-1');
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference)
  values ('refund:deposit_settlement:x', 'deposit_settlement', 250000, 700000, 'tx-1') on conflict (obligation_key) do nothing;
  select count(*) into n from public.refund_obligations where transaction_reference = 'tx-1';
  if n <> 1 then raise exception 'FAIL: duplicate obligation created'; end if;
  begin
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference)
    values ('refund:manual:y', 'manual', 450001, 700000, 'tx-1');
    raise exception 'FAIL: refunds above the charge accepted';
  exception when sqlstate '23514' then
    raise notice 'PASS: refunds cannot exceed the charge (T13, T14)';
  end;
  -- A failed refund can still be processed later by the provider, so it keeps its share.
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, state)
  values ('refund:manual:f1', 'manual', 600000, 700000, 'tx-2', 'failed');
  begin
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference)
    values ('refund:manual:f2', 'manual', 200000, 700000, 'tx-2');
    raise exception 'FAIL: a failed refund was left out of the charge cap';
  exception when sqlstate '23514' then null;
  end;
  update public.refund_obligations set state = 'eligible' where obligation_key = 'refund:manual:f1';
  raise notice 'PASS: failed refunds stay in the charge cap; reopening the same one is allowed';

  -- 10. Refund transitions are compare-and-set.
  select refund_transition(id, array['eligible'], 'claimed', '{"claim": true}', null, '[]') into ok from public.refund_obligations where obligation_key = 'refund:deposit_settlement:x';
  if not ok then raise exception 'FAIL: first claim refused'; end if;
  select refund_transition(id, array['eligible'], 'claimed', '{"claim": true}', null, '[]') into ok from public.refund_obligations where obligation_key = 'refund:deposit_settlement:x';
  if ok then raise exception 'FAIL: second worker claimed the same refund'; end if;
  raise notice 'PASS: only one worker can claim a refund';

  -- 11. Guarded booking transitions.
  update public.equipment_bookings set status = 'confirmed' where id = b1;
  n := public.transition_rental_booking(array[b1], array['confirmed'], 'active', 'staff', u2, 'handover',
    jsonb_build_object('handover', jsonb_build_object('id_checked', true)), null, null, null, '[]');
  if n <> 1 then raise exception 'FAIL: handover moved % rows', n; end if;
  n := public.transition_rental_booking(array[b1], array['confirmed'], 'active', 'staff', u2, 'handover', null, null, null, null, '[]');
  if n <> 0 then raise exception 'FAIL: repeated handover gave %', n; end if;
  n := public.transition_rental_booking(array[b1], array['pending'], 'confirmed', 'system', null, 'x', null, null, null, null, '[]');
  if n <> -1 then raise exception 'FAIL: stale transition gave %', n; end if;
  if not exists (select 1 from public.booking_status_history where booking_id = b1 and to_status = 'active') then raise exception 'FAIL: no history'; end if;
  raise notice 'PASS: transitions are guarded, idempotent and recorded (T06)';

  -- 12. One payout per booking, one transfer reference.
  n := public.transition_rental_booking(array[b1], array['active'], 'return_pending', 'staff', u2, 'returned', null, null, null, null, '[]');
  n := public.transition_rental_booking(array[b1], array['return_pending'], 'completed', 'staff', u2, 'clean', null, null, null,
    jsonb_build_array(jsonb_build_object('bookingId', b1, 'ownerId', u2, 'grossCents', 450000, 'platformCents', 90000, 'ownerCents', 360000,
      'transferReference', 'tvpo_test_' || replace(b1::text, '-', ''), 'scheduledAt', now() + interval '48 hours')), '[]');
  begin
    insert into public.owner_payouts (booking_id, owner_id, gross_rental_amount_cents, platform_commission_cents, owner_amount_cents, transfer_reference, scheduled_at)
    values (b1, u2, 450000, 90000, 360000, 'tvpo_other', now());
    raise exception 'FAIL: second payout for one booking';
  exception when unique_violation then
    raise notice 'PASS: one payout per booking (T16)';
  end;

  -- 12b. An old notification that was just claimed is not handed to a second dispatcher.
  insert into public.notification_outbox (dedupe_key, kind, channel, user_id, created_at)
  values ('lease-test', 'staff_alert', 'in_app', 'staff', now() - interval '1 day');
  select count(*) into n from public.claim_outbox(100) where dedupe_key = 'lease-test';
  if n <> 1 then raise exception 'FAIL: first claim got % rows', n; end if;
  select count(*) into n from public.claim_outbox(100) where dedupe_key = 'lease-test';
  if n <> 0 then raise exception 'FAIL: a row being sent was claimed again'; end if;
  update public.notification_outbox set claimed_at = now() - interval '11 minutes' where dedupe_key = 'lease-test';
  select count(*) into n from public.claim_outbox(100) where dedupe_key = 'lease-test';
  if n <> 1 then raise exception 'FAIL: an abandoned send was not reclaimed'; end if;
  raise notice 'PASS: outbox lease follows the last claim, not the creation time';
end $$;

-- 12b. One open dispute per disputed return (open_return_dispute). The
-- disputes table predates the numbered migrations; a stand-in is created
-- here only if it is missing (rolled back with everything else).
do $$
begin
  if to_regclass('public.disputes') is null then
    create table public.disputes (
      id uuid primary key default gen_random_uuid(),
      dispute_type text not null, booking_id uuid, equipment_booking_id uuid,
      filed_by uuid not null, reason text not null, evidence_photos jsonb default '[]',
      evidence_notes text, status text not null default 'open', created_at timestamptz not null default now());
  end if;
end $$;
do $$
declare
  b uuid;
  u uuid;
  d1 uuid;
  d2 uuid;
begin
  select id, user_id into b, u from public.equipment_bookings order by created_at desc limit 1;
  d1 := public.open_return_dispute(b, u, 'test', '[]'::jsonb, null);
  d2 := public.open_return_dispute(b, u, 'test again', '[]'::jsonb, null);
  if d1 is null or d1 <> d2 then raise exception 'FAIL: a second dispute was opened for one return'; end if;
  if (select count(*) from public.disputes where equipment_booking_id = b and status = 'open') <> 1 then
    raise exception 'FAIL: more than one open dispute for one return';
  end if;
  raise notice 'PASS: one open dispute per disputed return';
end $$;

-- 13. Clients cannot call the money functions or write the money tables.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.confirm_rental_payment('x', 'y', 1, false, null, '[]');
    raise exception 'FAIL: authenticated executed confirm_rental_payment';
  exception when insufficient_privilege then
    raise notice 'PASS: clients cannot execute money RPCs';
  end;
  begin
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference) values ('k', 'manual', 1, 1, 't');
    raise exception 'FAIL: authenticated inserted a refund obligation';
  exception when insufficient_privilege then
    raise notice 'PASS: clients cannot write refund obligations';
  end;
  if exists (select 1 from public.rental_payment_intents) then
    raise exception 'FAIL: a stranger can read payment intents';
  end if;
  raise notice 'PASS: a stranger sees no payment intents (T27)';
end $$;
reset role;

select 'ALL 070 CHECKS PASSED' as result;
rollback;
