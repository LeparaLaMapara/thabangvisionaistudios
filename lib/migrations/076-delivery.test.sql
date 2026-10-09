-- 076 test script. DEV DATABASE ONLY. Runs in ONE transaction and ends in
-- ROLLBACK, so it leaves no trace. Creates its own throwaway users, listings,
-- bookings and deliveries. Run AFTER applying 070 and 076:
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/076-delivery.test.sql
--
-- Every check prints "PASS n: …" as a NOTICE or aborts with "FAIL n: …".
--
-- Covers:
--    1. a shipment and its dispatch intent are created once (same attempt, same
--       merchant reference, or a second live attempt for the leg → existing row)
--    2. the dispatch claim is compare-and-set; a stale claim can be taken over
--    3. a transition applies once per dedupe key (D12); a wrong "from" state is a
--       conflict that leaves NOTHING behind (event, journal, refund) (D13, D24)
--    4. a transition's journal, notice, custody, incident and refund obligation commit
--       together; the refund is capped by the original charge
--    5. events, custody and proofs are append-only, even for the server
--    6. the webhook inbox refuses unverified events (D11) and dedupes (D12);
--       claim skips locked rows and dead-letters after the retry limit
--    7. ledger: the new accounts post; every existing account still does
--    8. notifications accept rental_delivery_* and still accept old types
--    9. marking a quote paid marks its shipments; the quote CAS refuses a second payer
--   10. D21: addresses are readable by their owner only — not the other party, not owners
--   11. D22: an owner sees only shipments carrying their gear, without address,
--       tracking link or money columns; a stranger sees nothing
--   12. clients cannot write delivery tables or execute delivery functions
--   13. custody and incidents are readable by the renter and the item's owner only

begin;

do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000760a1';
  stranger uuid := '00000000-0000-4000-8000-0000000760a2';
  owner_a uuid := '00000000-0000-4000-8000-0000000760b1';
  owner_b uuid := '00000000-0000-4000-8000-0000000760b2';
  cam uuid := '00000000-0000-4000-8000-0000000760c1';
  lens uuid := '00000000-0000-4000-8000-0000000760c2';
  other_cam uuid := '00000000-0000-4000-8000-0000000760c3';
  grp uuid := '00000000-0000-4000-8000-0000000760d1';
  grp2 uuid := '00000000-0000-4000-8000-0000000760d2';
  bk1 uuid := '00000000-0000-4000-8000-0000000760e1';
  bk2 uuid := '00000000-0000-4000-8000-0000000760e2';
  bk3 uuid := '00000000-0000-4000-8000-0000000760e3';
  office uuid := '00000000-0000-4000-8000-0000000760f1';
  home uuid := '00000000-0000-4000-8000-0000000760f2';
  strangers_home uuid := '00000000-0000-4000-8000-0000000760f3';
  q1 uuid := '00000000-0000-4000-8000-000000076101';
  q2 uuid := '00000000-0000-4000-8000-000000076102';
  r jsonb;
  s1 uuid;
  s2 uuid;
  n integer;
  ok boolean;
  res text;
  items jsonb;
begin
  insert into auth.users (id, email) values
    (renter, 'p4-renter@example.invalid'), (stranger, 'p4-stranger@example.invalid'),
    (owner_a, 'p4-owner-a@example.invalid'), (owner_b, 'p4-owner-b@example.invalid');
  insert into public.profiles (id) values (renter), (stranger), (owner_a), (owner_b) on conflict (id) do nothing;
  insert into public.smart_rentals (id, slug, title, quantity, is_published, price_per_day, replacement_value, owner_id, owner_type) values
    (cam, 'p4-cam-' || cam, 'P4 camera', 1, true, 500, 15000, owner_a, 'community'),
    (lens, 'p4-lens-' || lens, 'P4 lens', 1, true, 300, 8000, owner_b, 'community'),
    (other_cam, 'p4-oc-' || other_cam, 'P4 other', 1, true, 300, 8000, owner_b, 'community');
  insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id) values
    (bk1, renter, cam, '2030-02-01', '2030-02-03', 1500, 'confirmed', grp, owner_a),
    (bk2, renter, lens, '2030-02-01', '2030-02-03', 900, 'confirmed', grp, owner_b),
    (bk3, stranger, other_cam, '2030-02-01', '2030-02-03', 900, 'confirmed', grp2, owner_b);
  insert into public.rental_payment_intents (checkout_group_id, reference, provider, user_id, expected_amount_cents, hire_cents, deposit_cents, delivery_cents, hold_expires_at, state)
  values (grp, 'p4-pay-1', 'paystack', renter, 300000, 240000, 48000, 12000, now() + interval '1 hour', 'paid');

  insert into public.delivery_addresses (id, user_id, purpose, formatted_address, suburb, city, province, postal_code, lat, lng, contact_name, contact_phone, verified_by) values
    (office, null, 'platform_site', '99 Smith Street, Braamfontein', 'Braamfontein', 'Johannesburg', 'Gauteng', '2001', -26.19, 28.03, 'Desk', '0000000000', 'test'),
    (home, renter, 'renter_address', '1 Test Road, Sandton', 'Sandton', 'Johannesburg', 'Gauteng', '2196', -26.10, 28.05, 'Thandi', '0000000001', 'test'),
    (strangers_home, stranger, 'renter_address', '2 Test Road, Rosebank', 'Rosebank', 'Johannesburg', 'Gauteng', '2196', -26.14, 28.04, 'Sipho', '0000000002', 'test');
  insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents, platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at)
  values (q1, renter, grp, 'outbound', 'fake_courier', 'courier', 12000, 12000, 0, 12000, array[cam, lens], office, home, now() + interval '30 minutes'),
         (q2, stranger, grp2, 'outbound', 'manual', 'own_fleet', 15000, 15000, 0, 15000, array[other_cam], office, strangers_home, now() + interval '30 minutes');

  -- A quote whose fee does not add up is refused.
  begin
    insert into public.delivery_quotes (renter_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents, platform_fee_cents, customer_fee_cents, origin_address_id, destination_address_id, expires_at)
    values (renter, 'outbound', 'x', 'courier', 100, 100, 10, 100, office, home, now());
    raise exception 'FAIL 0: a quote with customer fee <> cost + fee was stored';
  exception when check_violation then
    raise notice 'PASS 0: customer fee = provider cost + platform fee is enforced';
  end;

  -- 1. Create once.
  items := jsonb_build_array(
    jsonb_build_object('bookingId', bk1, 'rentalId', cam, 'ownerId', owner_a, 'serialNumber', 'SN1'),
    jsonb_build_object('bookingId', bk2, 'rentalId', lens, 'ownerId', owner_b, 'serialNumber', 'SN2'));
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 1, 'renterId', renter, 'items', items, 'providerId', 'fake_courier',
      'providerKind', 'courier', 'quoteId', q1, 'merchantReference', 'tvd_test_o1', 'quoteAmountCents', 12000, 'customerFeeCents', 12000,
      'platformFeeCents', 0, 'replacementValueCents', 2300000, 'coverageVerified', true, 'insuranceReference', 'POL-1',
      'originAddressId', office, 'destinationAddressId', home, 'window', jsonb_build_object('start', '2030-02-01T07:00:00Z', 'end', null), 'paidReference', null),
    jsonb_build_object('merchantReference', 'tvd_test_o1', 'idempotencyKey', 'delivery-dispatch:test:outbound:1', 'providerId', 'fake_courier'));
  if not (r ->> 'created')::boolean then raise exception 'FAIL 1: first create did not create'; end if;
  s1 := (r ->> 'shipment_id')::uuid;
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 1, 'renterId', renter, 'items', items, 'providerId', 'fake_courier',
      'providerKind', 'courier', 'quoteId', q1, 'merchantReference', 'tvd_test_o1', 'quoteAmountCents', 12000, 'customerFeeCents', 12000,
      'platformFeeCents', 0, 'replacementValueCents', 2300000, 'originAddressId', office, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_test_o1', 'idempotencyKey', 'delivery-dispatch:test:outbound:1', 'providerId', 'fake_courier'));
  if (r ->> 'created')::boolean or (r ->> 'shipment_id')::uuid <> s1 then raise exception 'FAIL 1: a repeated create made a second shipment'; end if;
  -- A second live attempt for the same leg returns the live one.
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp, 'leg', 'outbound', 'attempt', 2, 'renterId', renter, 'items', items, 'providerId', 'fake_courier',
      'providerKind', 'courier', 'quoteId', q1, 'merchantReference', 'tvd_test_o2', 'quoteAmountCents', 12000, 'customerFeeCents', 12000,
      'platformFeeCents', 0, 'replacementValueCents', 2300000, 'originAddressId', office, 'destinationAddressId', home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_test_o2', 'idempotencyKey', 'delivery-dispatch:test:outbound:2', 'providerId', 'fake_courier'));
  if (r ->> 'created')::boolean or (r ->> 'shipment_id')::uuid <> s1 then raise exception 'FAIL 1: a second live attempt was created for the leg'; end if;
  select count(*) into n from public.delivery_dispatch_intents where shipment_id = s1;
  if n <> 1 then raise exception 'FAIL 1: % dispatch intents', n; end if;
  if (select owner_ids from public.delivery_shipments where id = s1) @> array[owner_a, owner_b] is not true then raise exception 'FAIL 1: owner_ids not derived'; end if;
  raise notice 'PASS 1: one shipment and one dispatch intent per order, leg and attempt';

  -- 2. Claim.
  select public.delivery_claim_dispatch((select id from public.delivery_dispatch_intents where shipment_id = s1), array['pending', 'unknown', 'claimed'], now(), now() - interval '10 minutes') into ok;
  if not ok then raise exception 'FAIL 2: first claim lost'; end if;
  select public.delivery_claim_dispatch((select id from public.delivery_dispatch_intents where shipment_id = s1), array['pending', 'unknown', 'claimed'], now(), now() - interval '10 minutes') into ok;
  if ok then raise exception 'FAIL 2: a live claim was taken twice'; end if;
  select public.delivery_claim_dispatch((select id from public.delivery_dispatch_intents where shipment_id = s1), array['pending', 'unknown', 'claimed'], now() + interval '11 minutes', now() + interval '1 minute') into ok;
  if not ok then raise exception 'FAIL 2: a stale claim could not be taken over'; end if;
  if (select attempts from public.delivery_dispatch_intents where shipment_id = s1) <> 2 then raise exception 'FAIL 2: attempts not counted'; end if;
  raise notice 'PASS 2: the dispatch claim is compare-and-set; a stale claim can be reclaimed';

  -- 3/4. Transition with everything attached.
  res := public.delivery_apply_transition(jsonb_build_object(
    'shipmentId', s1, 'from', jsonb_build_array('prepared'), 'to', 'booking', 'patch', '{}'::jsonb,
    'event', jsonb_build_object('source', 'system', 'actorId', null, 'dedupeKey', 'test:dispatch:1', 'providerState', null, 'occurredAt', now(), 'note', null)));
  if res <> 'applied' then raise exception 'FAIL 3: prepared → booking: %', res; end if;
  res := public.delivery_apply_transition(jsonb_build_object(
    'shipmentId', s1, 'from', jsonb_build_array('prepared'), 'to', 'booking', 'patch', '{}'::jsonb,
    'event', jsonb_build_object('source', 'system', 'dedupeKey', 'test:dispatch:1', 'occurredAt', now())));
  if res <> 'duplicate' then raise exception 'FAIL 3: replay was %', res; end if;
  select count(*) into n from public.delivery_events where shipment_id = s1;
  -- Wrong "from": a conflict, and its journal, event and refund must not survive.
  res := public.delivery_apply_transition(jsonb_build_object(
    'shipmentId', s1, 'from', jsonb_build_array('delivered'), 'to', 'cancelled', 'patch', '{}'::jsonb,
    'event', jsonb_build_object('source', 'staff', 'dedupeKey', 'test:conflict', 'occurredAt', now()),
    'journals', jsonb_build_array(jsonb_build_object('idempotencyKey', 'test-conflict-journal', 'kind', 'courier_cost', 'bookingGroupId', grp, 'memo', 'x',
      'lines', jsonb_build_array(jsonb_build_object('account', 'courier_costs', 'debitCents', 1, 'creditCents', 0), jsonb_build_object('account', 'delivery_payable', 'debitCents', 0, 'creditCents', 1)))),
    'refund', jsonb_build_object('key', 'refund:cancellation:delivery-conflict', 'amountCents', 100, 'paidReference', 'p4-pay-1', 'userId', renter, 'bookingIds', jsonb_build_array(bk1))));
  if res <> 'conflict' then raise exception 'FAIL 3: wrong from state was %', res; end if;
  if exists (select 1 from public.ledger_journals where idempotency_key = 'test-conflict-journal')
     or exists (select 1 from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-conflict')
     or (select count(*) from public.delivery_events where shipment_id = s1) <> n then
    raise exception 'FAIL 3: a conflicting transition left something behind';
  end if;
  raise notice 'PASS 3: one change per dedupe key; a conflict leaves nothing behind (D12, D13)';

  res := public.delivery_apply_transition(jsonb_build_object(
    'shipmentId', s1, 'from', jsonb_build_array('booking'), 'to', 'failed',
    'patch', jsonb_build_object('providerReference', 'job-1', 'accruedCostCents', 0),
    'event', jsonb_build_object('source', 'system', 'dedupeKey', 'test:rejected', 'occurredAt', now(), 'note', 'address refused'),
    'custody', '[]'::jsonb, 'proofs', '[]'::jsonb,
    'incidents', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'shipmentId', s1, 'bookingGroupId', grp, 'bookingIds', jsonb_build_array(bk1),
      'leg', 'outbound', 'kind', 'failed_attempt', 'providerCaused', null, 'reportedBy', jsonb_build_object('kind', 'provider', 'id', 'fake_courier'),
      'description', 'x', 'evidence', '[]'::jsonb, 'dedupeKey', 'incident:test:1')),
    'journals', jsonb_build_array(jsonb_build_object('idempotencyKey', 'delivery-cancel:test', 'kind', 'delivery_cancelled', 'bookingGroupId', grp, 'memo', 'Delivery leg cancelled',
      'lines', jsonb_build_array(jsonb_build_object('account', 'unearned_hire', 'debitCents', 12000, 'creditCents', 0), jsonb_build_object('account', 'refunds_payable', 'debitCents', 0, 'creditCents', 12000)))),
    'notices', jsonb_build_array(jsonb_build_object('dedupeKey', 'delivery_fee_refund:in_app:test', 'kind', 'delivery_fee_refund', 'channel', 'in_app', 'userId', renter::text, 'bookingIds', jsonb_build_array(bk1), 'data', '{}'::jsonb)),
    'refund', jsonb_build_object('key', 'refund:cancellation:delivery-test', 'amountCents', 12000, 'paidReference', 'p4-pay-1', 'userId', renter, 'bookingIds', jsonb_build_array(bk1, bk2)),
    'quoteStatus', jsonb_build_object('quoteId', q1, 'to', 'consumed')));
  if res <> 'applied' then raise exception 'FAIL 4: failure transition was %', res; end if;
  if (select status from public.delivery_shipments where id = s1) <> 'failed'
     or (select provider_reference from public.delivery_shipments where id = s1) <> 'job-1'
     or not exists (select 1 from public.ledger_journals where idempotency_key = 'delivery-cancel:test')
     or not exists (select 1 from public.notification_outbox where dedupe_key = 'delivery_fee_refund:in_app:test')
     or not exists (select 1 from public.delivery_incidents where dedupe_key = 'incident:test:1' and liability = 'undetermined' and provider_caused is null)
     or (select charged_cents from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-test') <> 300000
     or (select status from public.delivery_quotes where id = q1) <> 'consumed' then
    raise exception 'FAIL 4: the failure, its journal, notice, incident, refund and quote did not commit together';
  end if;
  raise notice 'PASS 4: a failed dispatch and the delivery-fee refund commit together (D24)';

  -- 5. Append-only.
  begin
    update public.delivery_events set note = 'rewritten' where shipment_id = s1;
    raise exception 'FAIL 5: delivery_events was updated';
  exception when insufficient_privilege then
    raise notice 'PASS 5a: delivery events cannot be rewritten';
  end;
  insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, actor_id, occurred_at, dedupe_key, evidence)
  values (s1, grp, bk1, cam, 'handed_to_courier', 'owner', owner_a::text, now(), 'custody:test:1', '[{"kind":"photo","ref":"p1"}]');
  insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, actor_id, occurred_at, dedupe_key)
  values (s1, grp, bk2, lens, 'handed_to_courier', 'owner', owner_b::text, now(), 'custody:test:2');
  begin
    delete from public.delivery_custody_events where dedupe_key = 'custody:test:1';
    raise exception 'FAIL 5: custody was deleted';
  exception when insufficient_privilege then
    raise notice 'PASS 5b: custody events cannot be deleted';
  end;
  begin
    insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, occurred_at, dedupe_key)
    values (s1, grp, bk1, cam, 'teleported', 'owner', now(), 'custody:test:bad');
    raise exception 'FAIL 5: an unknown custody kind was stored';
  exception when check_violation then
    raise notice 'PASS 5c: custody kinds are a closed list';
  end;

  -- 6. Inbox.
  begin
    insert into public.delivery_provider_events (provider, dedupe_key, event_type, payload, signature_verified)
    values ('fake_courier', 'unverified-1', 'collected', '{}', false);
    raise exception 'FAIL 6: an unverified webhook was stored';
  exception when check_violation then
    raise notice 'PASS 6a: an unverified webhook cannot be stored (D11)';
  end;
  insert into public.delivery_provider_events (provider, dedupe_key, event_type, payload, signature_verified) values ('fake_courier', 'evt-1', 'collected', '{}', true);
  insert into public.delivery_provider_events (provider, dedupe_key, event_type, payload, signature_verified) values ('fake_courier', 'evt-1', 'collected', '{}', true)
  on conflict (dedupe_key) do nothing;
  insert into public.delivery_provider_events (provider, dedupe_key, event_type, payload, signature_verified, processing_status, retry_count)
  values ('fake_courier', 'evt-dead', 'collected', '{}', true, 'failed', 8);
  select count(*) into n from public.claim_delivery_provider_events(10, 8);
  if n <> 1 then raise exception 'FAIL 6: claimed % events (expected the one live one)', n; end if;
  if (select processing_status from public.delivery_provider_events where dedupe_key = 'evt-dead') <> 'dead' then raise exception 'FAIL 6: no dead letter'; end if;
  select count(*) into n from public.claim_delivery_provider_events(10, 8);
  if n <> 0 then raise exception 'FAIL 6: a claimed event was claimed again at once'; end if;
  raise notice 'PASS 6b: the inbox dedupes, claims once and dead-letters after the retry limit (D12)';

  -- 7. Ledger accounts.
  ok := public.ledger_post(jsonb_build_object('idempotencyKey', 'courier-cost:test:dispatch', 'kind', 'courier_cost', 'bookingGroupId', grp, 'memo', 'x',
    'lines', jsonb_build_array(jsonb_build_object('account', 'courier_costs', 'debitCents', 500, 'creditCents', 0), jsonb_build_object('account', 'delivery_payable', 'debitCents', 0, 'creditCents', 500))));
  ok := public.ledger_post(jsonb_build_object('idempotencyKey', 'test-old-accounts', 'kind', 'chargeback', 'bookingGroupId', grp, 'memo', 'x',
    'lines', jsonb_build_array(jsonb_build_object('account', 'chargebacks', 'debitCents', 1, 'creditCents', 0), jsonb_build_object('account', 'cash_at_provider', 'debitCents', 0, 'creditCents', 1))));
  begin
    ok := public.ledger_post(jsonb_build_object('idempotencyKey', 'test-bad-account', 'kind', 'x', 'bookingGroupId', grp, 'memo', 'x',
      'lines', jsonb_build_array(jsonb_build_object('account', 'made_up', 'debitCents', 1, 'creditCents', 0), jsonb_build_object('account', 'cash_at_provider', 'debitCents', 0, 'creditCents', 1))));
    raise exception 'FAIL 7: an unknown account was accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'PASS 7: courier_costs and delivery_payable post; existing accounts still post; unknown ones do not';

  -- 8. Notification types.
  insert into public.notifications (user_id, type, title, body) values (renter, 'rental_delivery_booked', 't', 'b'), (renter, 'gig_request', 't', 'b'), (renter, 'rental_staff_alert', 't', 'b');
  begin
    insert into public.notifications (user_id, type, title, body) values (renter, 'rental_delivery_made_up', 't', 'b');
    raise exception 'FAIL 8: an unknown notification type was accepted';
  exception when check_violation then
    raise notice 'PASS 8: rental_delivery_* notification types accepted, old types kept';
  end;

  -- 9. Quote paid → shipments paid.
  r := public.delivery_create_shipment(
    jsonb_build_object('bookingGroupId', grp2, 'leg', 'outbound', 'attempt', 1, 'renterId', stranger,
      'items', jsonb_build_array(jsonb_build_object('bookingId', bk3, 'rentalId', other_cam, 'ownerId', owner_b, 'serialNumber', null)),
      'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q2, 'merchantReference', 'tvd_test2_o1', 'quoteAmountCents', 15000,
      'customerFeeCents', 15000, 'platformFeeCents', 0, 'replacementValueCents', 800000, 'originAddressId', office, 'destinationAddressId', strangers_home, 'window', '{}'::jsonb),
    jsonb_build_object('merchantReference', 'tvd_test2_o1', 'idempotencyKey', 'delivery-dispatch:test2:outbound:1', 'providerId', 'manual'));
  s2 := (r ->> 'shipment_id')::uuid;
  if not public.delivery_mark_quote_paid(q2, array['active', 'expired'], 'paid', 'p4-pay-2', grp2) then raise exception 'FAIL 9: quote not marked paid'; end if;
  if public.delivery_mark_quote_paid(q2, array['active', 'expired'], 'paid', 'p4-pay-3', grp2) then raise exception 'FAIL 9: a paid quote was paid again'; end if;
  if (select paid_reference from public.delivery_shipments where id = s2) <> 'p4-pay-2' then raise exception 'FAIL 9: shipment not marked paid'; end if;
  raise notice 'PASS 9: marking a quote paid marks its shipments, once';
end $$;

-- 10–13 run as signed-in users.
set local role authenticated;

-- The renter.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760a1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_addresses;
  if n <> 1 then raise exception 'FAIL 10: the renter sees % addresses (expected only their own)', n; end if;
  select count(*) into n from public.delivery_shipments where status is not null;
  if n <> 1 then raise exception 'FAIL 11: the renter sees % shipments', n; end if;
  begin
    perform tracking_url from public.delivery_shipments;
    raise exception 'FAIL 11: tracking_url is readable directly';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.delivery_custody_events;
  if n <> 2 then raise exception 'FAIL 13: the renter sees % custody events (expected 2)', n; end if;
  select count(*) into n from public.delivery_quotes;
  if n <> 1 then raise exception 'FAIL 10: the renter sees % quotes', n; end if;
  raise notice 'PASS 10a: the renter sees their own address, quote, shipment and custody only';
end $$;

-- Owner A (camera on the renter's shipment).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760b1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_addresses;
  if n <> 0 then raise exception 'FAIL 10: an owner can read % delivery addresses (D21)', n; end if;
  select count(*) into n from public.delivery_shipments where id is not null;
  if n <> 1 then raise exception 'FAIL 11: owner A sees % shipments (expected 1)', n; end if;
  begin
    perform destination_address_id from public.delivery_shipments;
    raise exception 'FAIL 11: an owner can read the destination address id';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform customer_fee_cents from public.delivery_shipments;
    raise exception 'FAIL 11: an owner can read money columns';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.delivery_custody_events;
  if n <> 1 then raise exception 'FAIL 13: owner A sees % custody events (expected only their camera)', n; end if;
  select count(*) into n from public.delivery_quotes;
  if n <> 0 then raise exception 'FAIL 11: an owner sees % quotes', n; end if;
  raise notice 'PASS 11a: an owner sees only shipments with their gear, without address, tracking or money (D21, D22)';
end $$;

-- Owner B (lens on the renter's shipment, and the stranger's shipment).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760b2', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_shipments where id is not null;
  if n <> 2 then raise exception 'FAIL 11: owner B sees % shipments (expected 2)', n; end if;
  select count(*) into n from public.delivery_incidents;
  if n <> 0 then raise exception 'FAIL 13: owner B sees an incident about owner A''s camera'; end if;
  raise notice 'PASS 11b: an owner sees each shipment carrying their gear, and not other owners'' incidents';
end $$;

-- A stranger to the renter's order (but a renter of their own).
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760a2', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_shipments where renter_id is not null;
  if n <> 1 then raise exception 'FAIL 11: the stranger sees % shipments (expected only their own)', n; end if;
exception when insufficient_privilege then
  -- renter_id is not a granted column: count by id instead.
  select count(*) into n from public.delivery_shipments where id is not null;
  if n <> 1 then raise exception 'FAIL 11: the stranger sees % shipments (expected only their own)', n; end if;
end $$;
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_addresses where user_id = '00000000-0000-4000-8000-0000000760a1';
  if n <> 0 then raise exception 'FAIL 10: a stranger can read the renter''s address (D21)'; end if;
  select count(*) into n from public.delivery_custody_events;
  if n <> 0 then raise exception 'FAIL 13: a stranger sees custody events'; end if;
  begin
    insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, occurred_at, dedupe_key)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'renter_accepted', 'renter', now(), 'forged');
    raise exception 'FAIL 12: a client wrote a custody event';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.delivery_shipments set status = 'delivered';
    raise exception 'FAIL 12: a client updated a shipment';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delivery_apply_transition('{}'::jsonb);
    raise exception 'FAIL 12: a client executed delivery_apply_transition';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delivery_claim_dispatch(gen_random_uuid(), array['pending'], now(), now());
    raise exception 'FAIL 12: a client executed delivery_claim_dispatch';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.delivery_provider_events;
    raise exception 'FAIL 12: a client read the webhook inbox';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.delivery_dispatch_intents;
    raise exception 'FAIL 12: a client read dispatch intents';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 12: clients cannot write delivery tables, run delivery functions, or read the inbox and intents';
  raise notice 'PASS 10b/11c/13: a stranger sees no one else''s address, shipment or custody';
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.delivery_shipments;
    raise exception 'FAIL 12: anon read shipments';
  exception when insufficient_privilege then
    raise notice 'PASS 12b: anonymous visitors cannot read delivery tables';
  end;
end $$;
reset role;

select 'ALL 076 CHECKS PASSED' as result;
rollback;
