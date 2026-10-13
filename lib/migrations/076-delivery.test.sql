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
--   14. review fixes: a delivery-fee refund is capped at what is LEFT of the
--       ORDER's charge, counting hire and staff refunds filed under the
--       provider's transaction id as production does (round 2); never above
--       the charge in total; a payment with no verified charge gets no
--       provider refund (staff alert)
--   15. a paid quote with no leg is refunded once (delivery_refund_quote); a
--       refunded quote cannot be made into a shipment
--   16. the address purge refuses while a live shipment uses the address
--   17. custody accepts the system's deemed_accepted (D-48); quotes accept 'refunded'
--   18. clients read events without actor/note, custody and incidents without
--       evidence or staff ids; an owner reads an incident only when every line
--       on it is theirs
--   19. round 2: custody accepts the staff decision 'staff_confirmed_received'
--   20. round 2: the deemed-acceptance list leaves out legs with a renter
--       exception or an open incident, before the limit
--   21. round 2: the cancelled-order sweep lists only fully cancelled orders
--       that still hold a cancellable leg or an unused paid quote
--   22. round 3: the sweep skips an order held for staff (legacy cancel) and a
--       return pickup kept because the renter has the gear; it lists orders it
--       never tried before ones it already tried (a leg the provider will not
--       cancel never clogs the batch)
--   23. round 3: the deemed-acceptance list leaves out a leg whose fee was
--       refunded or whose booking lines are all cancelled
--   24. round 3: the 070 cap trigger is order-wide: a hire refund filed under
--       the provider's transaction id is capped by a delivery-fee obligation
--       filed under the intent reference; a reference with no paid intent (and
--       a refund of money that arrived apart) is capped exactly as before

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
  insert into public.smart_rentals (id, slug, title, quantity, is_published, price_per_day, replacement_value, owner_id, owner_type, category) values
    (cam, 'p4-cam-' || cam, 'P4 camera', 1, true, 500, 15000, owner_a, 'community', 'cameras-optics'),
    (lens, 'p4-lens-' || lens, 'P4 lens', 1, true, 300, 8000, owner_b, 'community', 'cameras-optics'),
    (other_cam, 'p4-oc-' || other_cam, 'P4 other', 1, true, 300, 8000, owner_b, 'community', 'cameras-optics');
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

-- 14–17 run as the server (service role in production; the test owner here).
do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000760a1';
  stranger uuid := '00000000-0000-4000-8000-0000000760a2';
  grp uuid := '00000000-0000-4000-8000-0000000760d1';
  bk1 uuid := '00000000-0000-4000-8000-0000000760e1';
  bk2 uuid := '00000000-0000-4000-8000-0000000760e2';
  cam uuid := '00000000-0000-4000-8000-0000000760c1';
  office uuid := '00000000-0000-4000-8000-0000000760f1';
  home uuid := '00000000-0000-4000-8000-0000000760f2';
  strangers_home uuid := '00000000-0000-4000-8000-0000000760f3';
  q3 uuid := '00000000-0000-4000-8000-000000076103';
  s1 uuid;
  n integer;
  res text;
  ok boolean;
begin
  select id into s1 from public.delivery_shipments where merchant_reference = 'tvd_test_o1';

  -- 15. A paid quote with no leg: refunded once, with its obligation.
  insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents,
    platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at, status, paid_reference, line_snapshot)
  values (q3, renter, grp, 'return', 'manual', 'own_fleet', 5000, 5000, 0, 5000, array[cam], home, office, now() - interval '1 hour', 'paid', 'p4-pay-1',
          jsonb_build_array(jsonb_build_object('rentalId', cam, 'quantity', 1, 'startDate', '2030-02-01', 'endDate', '2030-02-03')));
  res := public.delivery_refund_quote(jsonb_build_object('quoteId', q3, 'bookingGroupId', grp, 'journals', '[]'::jsonb, 'notices', '[]'::jsonb,
    'refund', jsonb_build_object('key', 'refund:cancellation:delivery-quote-' || q3, 'amountCents', 5000, 'paidReference', 'p4-pay-1', 'userId', renter, 'bookingIds', jsonb_build_array(bk1))));
  if res <> 'applied' then raise exception 'FAIL 15: unused paid quote refund was %', res; end if;
  if (select status from public.delivery_quotes where id = q3) <> 'refunded'
     or (select amount_cents from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-quote-' || q3) <> 5000 then
    raise exception 'FAIL 15: quote not refunded with its obligation';
  end if;
  res := public.delivery_refund_quote(jsonb_build_object('quoteId', q3, 'bookingGroupId', grp, 'journals', '[]'::jsonb, 'notices', '[]'::jsonb,
    'refund', jsonb_build_object('key', 'refund:cancellation:delivery-quote-again', 'amountCents', 5000, 'paidReference', 'p4-pay-1', 'userId', renter, 'bookingIds', '[]'::jsonb)));
  if res <> 'conflict' or exists (select 1 from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-quote-again') then
    raise exception 'FAIL 15: a refunded quote was refunded again';
  end if;
  begin
    perform public.delivery_create_shipment(
      jsonb_build_object('bookingGroupId', grp, 'leg', 'return', 'attempt', 1, 'renterId', renter,
        'items', jsonb_build_array(jsonb_build_object('bookingId', bk1, 'rentalId', cam, 'ownerId', null, 'serialNumber', null)),
        'providerId', 'manual', 'providerKind', 'own_fleet', 'quoteId', q3, 'merchantReference', 'tvd_test_r1', 'quoteAmountCents', 5000,
        'customerFeeCents', 5000, 'platformFeeCents', 0, 'replacementValueCents', 0, 'originAddressId', home, 'destinationAddressId', office, 'window', '{}'::jsonb),
      jsonb_build_object('merchantReference', 'tvd_test_r1', 'idempotencyKey', 'delivery-dispatch:test:return:1', 'providerId', 'manual'));
    raise exception 'FAIL 15: a shipment was made from a refunded quote';
  exception when raise_exception then
    if sqlerrm not like 'delivery_quote_not_active%' then raise; end if;
  end;
  raise notice 'PASS 15: a paid quote with no leg is refunded once; a refunded quote is never dispatched';

  -- 14. The cap is what is LEFT of the ORDER's charge (300000 on p4-pay-1). As in
  -- production, the payment's provider transaction id is on the intent and on the
  -- lines (payfast_payment_id), and hire, deposit and staff refunds are filed under
  -- THAT id, while delivery-fee refunds are filed under the intent reference.
  update public.rental_payment_intents set provider_transaction_id = 'p4-tx-1' where reference = 'p4-pay-1';
  update public.equipment_bookings set payfast_payment_id = 'p4-tx-1' where checkout_group_id = grp;
  select coalesce(sum(amount_cents), 0) into n from public.refund_obligations where transaction_reference in ('p4-pay-1', 'p4-tx-1') or booking_group_id = grp;
  -- A hire refund (renter cancelled a line) and a staff refund take the order down to 8000 left.
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id, booking_ids)
  values ('refund:cancellation:' || bk2, 'cancellation', 40000, 300000, 'p4-tx-1', grp, array[bk2]),
         ('refund:manual:staff-cancel:test', 'manual', 300000 - n - 40000 - 8000, 300000, 'p4-tx-1', grp, array[bk1]);
  n := public.delivery_insert_fee_refund(jsonb_build_object('key', 'refund:cancellation:delivery-cap-1', 'amountCents', 12000, 'paidReference', 'p4-pay-1',
    'userId', renter, 'bookingIds', jsonb_build_array(bk1)), grp, '{}'::jsonb);
  if n <> 8000 or (select amount_cents from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-cap-1') <> 8000 then
    raise exception 'FAIL 14: the delivery refund was not capped at what is left of the order (got %; hire and staff refunds on the transaction id were not counted)', n;
  end if;
  if (select sum(amount_cents) from public.refund_obligations where transaction_reference in ('p4-pay-1', 'p4-tx-1')) <> 300000 then
    raise exception 'FAIL 14: refunds on the order do not add up to the charge';
  end if;
  n := public.delivery_insert_fee_refund(jsonb_build_object('key', 'refund:cancellation:delivery-cap-2', 'amountCents', 12000, 'paidReference', 'p4-pay-1',
    'userId', renter, 'bookingIds', '[]'::jsonb), grp, '{}'::jsonb);
  if n <> 0 or exists (select 1 from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-cap-2') then
    raise exception 'FAIL 14: a refund was owed on a fully refunded charge';
  end if;
  if not exists (select 1 from public.notification_outbox where dedupe_key = 'staff_alert:in_app:staff:delivery:delivery_refund_capped:refund:cancellation:delivery-cap-2') then
    raise exception 'FAIL 14: no staff alert for a capped refund';
  end if;
  -- A delivery refund filed under the transaction id finds the same order and the same cap.
  n := public.delivery_insert_fee_refund(jsonb_build_object('key', 'refund:cancellation:delivery-cap-tx', 'amountCents', 100, 'paidReference', 'p4-tx-1',
    'userId', renter, 'bookingIds', '[]'::jsonb), grp, '{}'::jsonb);
  if n <> 0 or exists (select 1 from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-cap-tx') then
    raise exception 'FAIL 14: a refund under the transaction id went above the order''s charge';
  end if;
  -- Through a transition too: the cap applies, and the transition still commits.
  res := public.delivery_apply_transition(jsonb_build_object(
    'shipmentId', s1, 'from', jsonb_build_array('failed'), 'to', 'failed', 'patch', '{}'::jsonb,
    'event', jsonb_build_object('source', 'system', 'dedupeKey', 'test:cap-transition', 'occurredAt', now()),
    'refund', jsonb_build_object('key', 'refund:cancellation:delivery-cap-3', 'amountCents', 500, 'paidReference', 'p4-pay-1', 'userId', renter, 'bookingIds', '[]'::jsonb)));
  if res <> 'applied' or exists (select 1 from public.refund_obligations where obligation_key = 'refund:cancellation:delivery-cap-3') then
    raise exception 'FAIL 14: a transition refund went above the charge (%)', res;
  end if;
  -- No verified charge on record: no provider refund at all, staff refund by hand.
  n := public.delivery_insert_fee_refund(jsonb_build_object('key', 'refund:cancellation:delivery-nocharge', 'amountCents', 1000, 'paidReference', 'no-such-charge',
    'userId', renter, 'bookingIds', '[]'::jsonb), grp, '{}'::jsonb);
  if n <> 0 or exists (select 1 from public.refund_obligations where transaction_reference = 'no-such-charge')
     or not exists (select 1 from public.notification_outbox where dedupe_key like 'staff_alert:in_app:staff:delivery:delivery_refund_unverified_charge:%') then
    raise exception 'FAIL 14: a refund was owed without a verified charge';
  end if;
  raise notice 'PASS 14: delivery refunds are capped at what is left of the charge; none without a verified charge';

  -- 16. Purge re-check at write time: the stranger's shipment (prepared) still uses their address.
  ok := public.delivery_redact_address(strangers_home, jsonb_build_object('formatted_address', 'Rosebank, Johannesburg', 'lat', -26.14, 'lng', 28.04), now());
  if ok or (select redacted_at from public.delivery_addresses where id = strangers_home) is not null then
    raise exception 'FAIL 16: an address in use by a live shipment was redacted';
  end if;
  update public.delivery_shipments set status = 'cancelled' where merchant_reference = 'tvd_test2_o1';
  ok := public.delivery_redact_address(strangers_home, jsonb_build_object('formatted_address', 'Rosebank, Johannesburg', 'lat', -26.14, 'lng', 28.04), now());
  if not ok or (select contact_phone from public.delivery_addresses where id = strangers_home) <> '' then
    raise exception 'FAIL 16: a closed address was not redacted';
  end if;
  raise notice 'PASS 16: the purge re-checks live use in the same write';

  -- 17. Deemed acceptance and the refunded status are stored.
  insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, actor_id, occurred_at, dedupe_key)
  values (s1, grp, bk1, cam, 'deemed_accepted', 'system', null, now(), 'deemed_accepted:test');
  raise notice 'PASS 17: custody records the system''s deemed acceptance; quotes can be refunded';

  -- Incidents for 18: one on both lines (the whole order), one on the lens only (owner B).
  insert into public.delivery_incidents (id, shipment_id, booking_group_id, booking_ids, leg, kind, reported_by_kind, reported_by_id, description, evidence, dedupe_key)
  values (gen_random_uuid(), s1, grp, array[bk1, bk2], 'outbound', 'delayed', 'renter', renter::text, 'both late', '[{"kind":"photo","ref":"https://x/door.jpg"}]', 'incident:test:both'),
         (gen_random_uuid(), s1, grp, array[bk2], 'outbound', 'damaged', 'owner', 'owner-b', 'lens chipped', '[]', 'incident:test:lens');
  insert into public.delivery_events (shipment_id, from_status, to_status, source, actor_id, dedupe_key, occurred_at, note)
  values (s1, 'failed', 'failed', 'staff', 'staff-1', 'test:staff-note', now(), 'internal: renter was rude');
end $$;

-- 18 as the renter, then each owner.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760a1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_events where to_status is not null;
  if n = 0 then raise exception 'FAIL 18: the renter cannot read their delivery history'; end if;
  begin
    perform actor_id from public.delivery_events;
    raise exception 'FAIL 18: the renter can read who acted (actor_id)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform note from public.delivery_events;
    raise exception 'FAIL 18: the renter can read staff notes';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.delivery_incidents where kind is not null;
  if n <> 3 then raise exception 'FAIL 18: the renter sees % incidents (expected 3)', n; end if;
  begin
    perform reported_by_id from public.delivery_incidents;
    raise exception 'FAIL 18: incident reporter ids are readable';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 18a: the renter reads history and incidents without staff ids or notes';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760b1', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  begin
    perform evidence from public.delivery_custody_events;
    raise exception 'FAIL 18: an owner can read custody evidence (photos at the renter''s door)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform evidence from public.delivery_incidents;
    raise exception 'FAIL 18: an owner can read incident evidence';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.delivery_incidents where kind is not null;
  if n <> 1 then raise exception 'FAIL 18: owner A sees % incidents (expected only the one on their camera alone)', n; end if;
  raise notice 'PASS 18b: owner A sees no evidence links and no incident that covers another owner''s line';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000760b2', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.delivery_incidents where kind is not null;
  if n <> 1 then raise exception 'FAIL 18: owner B sees % incidents (expected only the one on their lens)', n; end if;
  raise notice 'PASS 18c: owner B sees only the incident on their own line';
end $$;
reset role;

-- 19–21 (review fixes, round 2) run as the server.
do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000760a1';
  owner_a uuid := '00000000-0000-4000-8000-0000000760b1';
  cam uuid := '00000000-0000-4000-8000-0000000760c1';
  office uuid := '00000000-0000-4000-8000-0000000760f1';
  home uuid := '00000000-0000-4000-8000-0000000760f2';
  g_ok uuid := '00000000-0000-4000-8000-000000076201';
  g_exc uuid := '00000000-0000-4000-8000-000000076202';
  g_inc uuid := '00000000-0000-4000-8000-000000076203';
  g_cx_leg uuid := '00000000-0000-4000-8000-000000076204';
  g_cx_quote uuid := '00000000-0000-4000-8000-000000076205';
  g_open uuid := '00000000-0000-4000-8000-000000076206';
  g_cx_moving uuid := '00000000-0000-4000-8000-000000076207';
  g uuid;
  i integer := 0;
  q uuid;
  s uuid;
  b uuid;
  items jsonb;
  ids uuid[];
  st text;
begin
  -- One renter, one listing per order; each order gets its own quote, line and (maybe) leg.
  foreach g in array array[g_ok, g_exc, g_inc, g_cx_leg, g_cx_quote, g_open, g_cx_moving] loop
    q := gen_random_uuid();
    b := gen_random_uuid();
    i := i + 1;
    st := case when g in (g_cx_leg, g_cx_quote, g_cx_moving) then 'cancelled' else 'confirmed' end;
    insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id)
    values (b, renter, cam, date '2031-03-01' + i * 7, date '2031-03-02' + i * 7, 100, st, g, owner_a);
    insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents,
      platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at, status, paid_reference)
    values (q, renter, g, 'outbound', 'manual', 'own_fleet', 5000, 5000, 0, 5000, array[cam], office, home, now() + interval '1 hour', 'paid', g::text);
    if g = g_cx_quote then
      continue; -- a paid quote no leg was made from
    end if;
    items := jsonb_build_array(jsonb_build_object('bookingId', b, 'rentalId', cam, 'ownerId', owner_a, 'serialNumber', null));
    insert into public.delivery_shipments (booking_group_id, leg, attempt, renter_id, items, provider, provider_kind, quote_id, merchant_reference,
      status, quote_amount_cents, customer_fee_cents, origin_address_id, destination_address_id, delivered_at, paid_reference)
    values (g, 'outbound', 1, renter, items, 'manual', 'own_fleet', q, 'tvd_r2_' || replace(g::text, '-', ''),
      case when g = g_cx_leg then 'scheduled' when g = g_open then 'prepared' when g = g_cx_moving then 'in_transit' else 'delivered' end,
      -- The deemable leg is the NEWEST delivery: without the exclusion, older legs fill a batch of 1.
      5000, 5000, office, home, now() - case when g = g_ok then interval '2 days' else interval '3 days' end, g::text)
    returning id into s;
    if g = g_exc then
      insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, actor_id, occurred_at, discrepancies, dedupe_key)
      values (s, g, b, cam, 'renter_reported_exception', 'renter', renter::text, now() - interval '2 days', '["scratched"]', 'r2-exc:' || s);
    elsif g = g_inc then
      insert into public.delivery_incidents (id, shipment_id, booking_group_id, booking_ids, leg, kind, reported_by_kind, reported_by_id, description, dedupe_key)
      values (gen_random_uuid(), s, g, array[b], 'outbound', 'delayed', 'owner', owner_a::text, 'late', 'r2-inc:' || s);
    end if;
  end loop;

  -- 19. The staff decision is a custody kind (its reason in condition).
  select id into s from public.delivery_shipments where booking_group_id = g_exc;
  select id into b from public.equipment_bookings where checkout_group_id = g_exc;
  insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, kind, actor_kind, actor_id, occurred_at, condition, dedupe_key)
  values (s, g_exc, b, cam, 'staff_confirmed_received', 'thabangvision_staff', 'staff-1', now(), 'renter confirmed by phone', 'r2-staff-confirm:' || s);
  raise notice 'PASS 19: custody records the staff decision staff_confirmed_received';

  -- 20. Only the leg that can be deemed accepted is listed; a limit of 1 still finds it.
  select array_agg(x) into ids from public.delivery_list_awaiting_acceptance(now(), 1) x;
  if ids is null or array_length(ids, 1) <> 1 or ids[1] <> (select id from public.delivery_shipments where booking_group_id = g_ok) then
    raise exception 'FAIL 20: awaiting-acceptance list was % (legs with an exception or open incident must not fill the batch)', ids;
  end if;
  select array_agg(x) into ids from public.delivery_list_awaiting_acceptance(now(), 50) x;
  if (select id from public.delivery_shipments where booking_group_id = g_exc) = any (ids)
     or (select id from public.delivery_shipments where booking_group_id = g_inc) = any (ids) then
    raise exception 'FAIL 20: a leg with an exception or an open incident was listed for deemed acceptance';
  end if;
  raise notice 'PASS 20: legs with a renter exception or an open incident never fill the deemed-acceptance batch';

  -- 21. Fully cancelled orders with a cancellable leg or an unused paid quote; never an open order,
  -- never a cancelled order whose only leg is on the move (staff were alerted for it).
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(50) x;
  if not (g_cx_leg = any (ids)) or not (g_cx_quote = any (ids)) then
    raise exception 'FAIL 21: a fully cancelled order with live delivery money was not listed (%)', ids;
  end if;
  if g_open = any (ids) or g_ok = any (ids) or g_cx_moving = any (ids) then
    raise exception 'FAIL 21: an open order or a moving leg was listed (%)', ids;
  end if;
  raise notice 'PASS 21: the daily sweep lists only fully cancelled orders with a cancellable leg or an unused paid quote';
end $$;

-- 22–24 (review fixes, round 3) run as the server.
do $$
declare
  renter uuid := '00000000-0000-4000-8000-0000000760a1';
  owner_a uuid := '00000000-0000-4000-8000-0000000760b1';
  cam uuid := '00000000-0000-4000-8000-0000000760c1';
  office uuid := '00000000-0000-4000-8000-0000000760f1';
  home uuid := '00000000-0000-4000-8000-0000000760f2';
  g_ok uuid := '00000000-0000-4000-8000-000000076201';
  g_held uuid := '00000000-0000-4000-8000-000000076301';
  g_gear uuid := '00000000-0000-4000-8000-000000076302';
  g_back uuid := '00000000-0000-4000-8000-000000076303';
  g_refunded uuid := '00000000-0000-4000-8000-000000076304';
  g_cx_delivered uuid := '00000000-0000-4000-8000-000000076305';
  g_cap uuid := '00000000-0000-4000-8000-000000076306';
  g uuid;
  leg text;
  st text;
  i integer := 0;
  q uuid;
  b uuid;
  ids uuid[];
  first_id uuid;
  next_id uuid;
begin
  -- Fully cancelled orders with an outbound and a return leg each:
  --   g_held  both scheduled; the legacy cancel path leaves it to staff
  --   g_gear  outbound delivered (the renter has the gear), return scheduled
  --   g_back  outbound cancelled (never reached the renter), return scheduled
  -- and two orders with a delivered, unaccepted outbound leg for 23:
  --   g_refunded      its fee was refunded (quote refunded), booking confirmed
  --   g_cx_delivered  every line cancelled (only its delivered leg is left)
  foreach g in array array[g_held, g_gear, g_back, g_refunded, g_cx_delivered] loop
    i := i + 1;
    b := gen_random_uuid();
    insert into public.equipment_bookings (id, user_id, rental_id, start_date, end_date, total_price, status, checkout_group_id, owner_id)
    values (b, renter, cam, date '2032-03-01' + i * 7, date '2032-03-02' + i * 7, 100,
            case when g = g_refunded then 'confirmed' else 'cancelled' end, g, owner_a);
    foreach leg in array array['outbound', 'return'] loop
      if leg = 'return' and g in (g_refunded, g_cx_delivered) then
        continue;
      end if;
      st := case
              when leg = 'return' then 'scheduled'
              when g in (g_gear, g_refunded, g_cx_delivered) then 'delivered'
              when g = g_back then 'cancelled'
              else 'scheduled'
            end;
      q := gen_random_uuid();
      insert into public.delivery_quotes (id, renter_id, booking_group_id, leg, provider, provider_kind, quote_amount_cents, provider_cost_cents,
        platform_fee_cents, customer_fee_cents, rental_ids, origin_address_id, destination_address_id, expires_at, status, paid_reference)
      values (q, renter, g, leg, 'manual', 'own_fleet', 5000, 5000, 0, 5000, array[cam],
              case when leg = 'outbound' then office else home end, case when leg = 'outbound' then home else office end,
              now() + interval '1 hour', case when g = g_refunded then 'refunded' else 'consumed' end, g::text);
      insert into public.delivery_shipments (booking_group_id, leg, attempt, renter_id, items, provider, provider_kind, quote_id, merchant_reference,
        status, quote_amount_cents, customer_fee_cents, origin_address_id, destination_address_id, delivered_at, paid_reference)
      values (g, leg, 1, renter, jsonb_build_array(jsonb_build_object('bookingId', b, 'rentalId', cam, 'ownerId', owner_a, 'serialNumber', null)),
              'manual', 'own_fleet', q, 'tvd_r3_' || left(leg, 1) || replace(g::text, '-', ''), st, 5000, 5000,
              case when leg = 'outbound' then office else home end, case when leg = 'outbound' then home else office end,
              case when st = 'delivered' then now() - interval '3 days' end, g::text);
    end loop;
  end loop;

  -- 22. Held orders and kept return pickups are never listed; tried orders go to the back.
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(500) x;
  if not (g_held = any (ids)) or not (g_back = any (ids)) then
    raise exception 'FAIL 22: a fully cancelled order with a cancellable leg was not listed (%)', ids;
  end if;
  if g_gear = any (ids) then
    raise exception 'FAIL 22: a return pickup kept because the renter has the gear was listed for the sweep (it would be cancelled)';
  end if;
  perform public.delivery_note_cancelled_order(g_held, 'legacy_cancel');
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(500) x;
  if g_held = any (ids) then
    raise exception 'FAIL 22: an order the legacy cancel path left to staff was listed for the sweep';
  end if;
  -- A later attempt note never clears the hold.
  perform public.delivery_note_cancelled_order(g_held, null);
  select array_agg(x) into ids from public.delivery_cancelled_orders_to_settle(500) x;
  if g_held = any (ids) then
    raise exception 'FAIL 22: an attempt note cleared a staff hold';
  end if;
  select x into first_id from public.delivery_cancelled_orders_to_settle(1) x;
  perform public.delivery_note_cancelled_order(first_id, null);
  select x into next_id from public.delivery_cancelled_orders_to_settle(1) x;
  if next_id is null or next_id = first_id then
    raise exception 'FAIL 22: an order the sweep already tried stayed at the head of the queue (%)', next_id;
  end if;
  if not (first_id = any (array(select x from public.delivery_cancelled_orders_to_settle(500) x))) then
    raise exception 'FAIL 22: a tried order was dropped instead of moved to the back';
  end if;
  perform public.delivery_note_cancelled_order(first_id, null);
  if (select attempts from public.delivery_cancelled_order_notes where booking_group_id = first_id) <> 2 then
    raise exception 'FAIL 22: attempts were not counted';
  end if;
  raise notice 'PASS 22: the sweep skips held orders and kept return pickups; tried orders go to the back of the queue';

  -- 23. Deemed acceptance never lists a refunded fee or a cancelled booking.
  select array_agg(x) into ids from public.delivery_list_awaiting_acceptance(now(), 500) x;
  if not ((select id from public.delivery_shipments where booking_group_id = g_ok) = any (ids)) then
    raise exception 'FAIL 23: the deemable leg was not listed (%)', ids;
  end if;
  if (select id from public.delivery_shipments where booking_group_id = g_refunded) = any (ids) then
    raise exception 'FAIL 23: a leg whose fee was refunded was listed for deemed acceptance';
  end if;
  if (select id from public.delivery_shipments where booking_group_id = g_cx_delivered) = any (ids) then
    raise exception 'FAIL 23: a leg whose booking is cancelled was listed for deemed acceptance';
  end if;
  raise notice 'PASS 23: deemed acceptance skips refunded fees and cancelled bookings';

  -- 24. The 070 cap trigger is order-wide for an order's own charge.
  insert into public.rental_payment_intents (checkout_group_id, reference, provider, user_id, expected_amount_cents, hire_cents, deposit_cents,
    delivery_cents, hold_expires_at, state, provider_transaction_id)
  values (g_cap, 'p4r3-pay', 'paystack', renter, 100000, 70000, 0, 30000, now() + interval '1 hour', 'paid', 'p4r3-tx');
  -- The delivery fee owed back, filed under the intent reference.
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id)
  values ('r3:delivery', 'cancellation', 30000, 100000, 'p4r3-pay', g_cap);
  begin
    -- A hire refund under the transaction id: 30000 + 80000 > 100000.
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id)
    values ('r3:hire-over', 'cancellation', 80000, 100000, 'p4r3-tx', g_cap);
    raise exception 'FAIL 24: a hire refund under the transaction id ignored the delivery-fee obligation under the intent reference';
  exception when check_violation then
    null;
  end;
  begin
    -- Without the order id on it, the reference still ties it to the order.
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference)
    values ('r3:hire-no-order', 'manual', 80000, 100000, 'p4r3-tx');
    raise exception 'FAIL 24: a refund under the transaction id without the order id ignored the order';
  exception when check_violation then
    null;
  end;
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id)
  values ('r3:hire', 'cancellation', 70000, 100000, 'p4r3-tx', g_cap);
  begin
    update public.refund_obligations set amount_cents = 70001 where obligation_key = 'r3:hire';
    raise exception 'FAIL 24: raising an obligation above what is left of the order was allowed';
  exception when check_violation then
    null;
  end;
  -- No paid intent for the reference: capped exactly as before (its own reference only).
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id)
  values ('r3:elsewhere', 'manual', 50000, 50000, 'p4r3-elsewhere', g_cap);
  begin
    insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id)
    values ('r3:elsewhere-2', 'manual', 1, 50000, 'p4r3-elsewhere', g_cap);
    raise exception 'FAIL 24: the per-reference cap no longer holds for a reference with no paid intent';
  exception when check_violation then
    null;
  end;
  -- Money that arrived apart from the order's charge: capped exactly as before.
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, booking_group_id, from_unallocated)
  values ('r3:stray', 'overpayment', 1000, 200000, 'p4r3-pay', g_cap, true);
  if not exists (select 1 from pg_proc p where p.proname = 'refund_obligations_cap' and p.prosecdef
                 and p.proconfig @> array['search_path=public, pg_temp']) then
    raise exception 'FAIL 24: the cap trigger lost SECURITY DEFINER or its pinned search_path';
  end if;
  raise notice 'PASS 24: the refund cap trigger counts the whole order; unmatched references are capped as before';
end $$;

select 'ALL 076 CHECKS PASSED' as result;
rollback;
