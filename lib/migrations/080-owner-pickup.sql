-- 080 — Collect gear from the owner's address (Phase 8, 2026-10-10)
--
-- WARNING (R-87): 080 replaces 076 functions and 076's grant on
--   delivery_quotes. Re-running 076 after 080 puts the 076 versions back:
--   re-run 080 straight after it. Code from the Phase 8 branch reads and
--   writes 080's columns and calls 080's functions: apply 080 BEFORE that
--   code is deployed.
--
-- WHY
--   Until now every delivery leg ran between OUR SITE and the renter
--   (076): community owners keep their gear at home and had to bring it to
--   the studio first. The founder wants gear collected from (and returned to)
--   the owner's address. An order mixing studio gear and gear from several
--   owners now has one outbound leg per origin and one return leg back to
--   each origin. Own vehicle first; couriers stay off (D-41) and plug in
--   through the same DeliveryPort.
--
-- WHAT
--   1. delivery_addresses
--        - purpose gains 'owner_pickup': an owner's saved pickup address,
--          verified on the server (AddressPort), with driver contact and
--          instructions. Must name its owner (user_id).
--        - retired_at: a replaced or removed pickup address is retired, not
--          deleted (legs that used it keep their record); retention purges it
--          once nothing live uses it.
--        - at most ONE active (not retired, not redacted) owner_pickup row per
--          owner (unique index).
--        Access is unchanged and is the point: RLS lets only the person whose
--        address it is read it (D21). The renter of an order never reads the
--        owner's address (they see the suburb at most, through the server);
--        staff read it only through the audited reveal (server, service role);
--        other users never (D-88).
--   2. delivery_quotes.origin_owner_id, delivery_shipments.origin_owner_id
--        null = our site (every row before 080), else the owner whose pickup
--        address is the gear's end of the leg (outbound origin, return
--        destination). Not granted to clients on delivery_shipments (column
--        grants from 076 are unchanged).
--   3. Uniqueness per origin: the shipment's (order, leg, attempt) and
--        "one live attempt per leg" become per (order, leg, origin, attempt)
--        and per (order, leg, origin). Our site is one origin, so a
--        studio-only order is constrained exactly as before.
--   4. delivery_create_shipment (076) replaced: stores origin_owner_id and
--        finds the existing row of the SAME origin on a conflict.
--   5. delivery_redact_address (076) replaced: also redacts a RETIRED
--        owner_pickup address once nothing live uses it (an active pickup
--        address is the owner's standing choice and is not purged while
--        active; retention starts when it is replaced or removed).
--   6. listing_private.owner_pickup (default false): the owner opts a
--        listing in to "available for pickup from my address" (D-86). Written
--        by the server only (listing_private has no client write grant).
--   7. notifications.type gains rental_owner_pickup_scheduled,
--        rental_owner_pickup_collected, rental_owner_gear_returned (notices to
--        the OWNER; read and extended like 076, every existing value kept).
--
-- REVIEW FIXES (2026-10-10, before 080 was applied anywhere)
--   8. delivery_quotes: the renter reads their own quotes through a COLUMN
--        grant (076 granted the whole table). Left out: the provider's side
--        (quote_amount_cents, provider_cost_cents, platform_fee_cents,
--        provider_quote_ref) and where the gear is (origin_owner_id,
--        origin_address_id, destination_address_id). No client reads
--        delivery_quotes directly (the server uses service_role); the
--        renter's own fee is customer_fee_cents. An owner-origin fee is
--        priced from a ~2 km grid cell, never the owner's exact point (D-93).
--   9. delivery_cancelled_orders_to_settle (076) replaced: "the renter may
--        still have the gear" is decided PER ORIGIN, as the server does
--        (deliveryCancellationPlan): an owner's scheduled return is kept
--        while that owner's gear is with the renter, whatever happened to
--        the studio's gear (R-84).
--  10. delivery_save_owner_pickup: retire the owner's active pickup address
--        and store the new one in ONE statement's transaction, so a failed
--        insert never leaves the owner with no address (the unique index
--        allows one active row, so the new row cannot go in first).
--        SECURITY DEFINER, pinned search_path, service_role only. Refuses
--        while a leg from or back to the address is under way, checked under
--        a per-owner lock that delivery_create_shipment also takes (R-91).
--
-- SAFETY
--   One transaction (a failure leaves nothing applied). Additive and
--   re-runnable (IF NOT EXISTS / CREATE OR REPLACE / constraint found by
--   definition). No existing row changes: every existing quote and shipment
--   is our site (origin_owner_id null). Code built before 080 keeps working on
--   an 080 database (it never sends an origin, so every leg is our site).
--   Code built WITH 080 reads origin_owner_id and calls
--   delivery_save_owner_pickup, so apply 080 together with 076–079, before
--   that code is deployed (docs/operations/launch-checklist.md).
--
-- APPLY: DEV first, then 080-owner-pickup.test.sql and rls-coverage.test.sql
--        (both end in ROLLBACK). PROD after founder approval, after 079.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ── 1. Owner pickup addresses ────────────────────────────────────────────────

alter table public.delivery_addresses add column if not exists retired_at timestamptz;

do $$
declare
  c text;
begin
  -- The purpose CHECK, found by what it says (its name may differ between databases).
  for c in
    select conname from pg_constraint
     where conrelid = 'public.delivery_addresses'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%purpose%' and pg_get_constraintdef(oid) like '%renter_address%'
  loop
    execute format('alter table public.delivery_addresses drop constraint %I', c);
  end loop;
end $$;
alter table public.delivery_addresses add constraint delivery_addresses_purpose_check
  check (purpose in ('renter_address', 'owner_handover', 'platform_site', 'owner_pickup'));

alter table public.delivery_addresses drop constraint if exists delivery_addresses_owner_pickup_has_owner;
alter table public.delivery_addresses add constraint delivery_addresses_owner_pickup_has_owner
  check (purpose <> 'owner_pickup' or user_id is not null);

create unique index if not exists uq_delivery_addresses_active_owner_pickup on public.delivery_addresses (user_id)
  where purpose = 'owner_pickup' and retired_at is null and redacted_at is null;

comment on column public.delivery_addresses.retired_at is
  'An owner_pickup address the owner replaced or removed (080). Kept for the legs that used it; purged by retention once nothing live uses it.';

-- ── 2. Origin of a leg ───────────────────────────────────────────────────────

alter table public.delivery_quotes add column if not exists origin_owner_id uuid;
alter table public.delivery_shipments add column if not exists origin_owner_id uuid;
comment on column public.delivery_quotes.origin_owner_id is
  'null = our site; else the owner whose owner_pickup address is the gear''s end of the leg (outbound origin, return destination). 080.';
comment on column public.delivery_shipments.origin_owner_id is
  'null = our site; else the owner whose owner_pickup address is the gear''s end of the leg (outbound origin, return destination). Not granted to clients. 080.';
create index if not exists idx_delivery_shipments_origin_owner on public.delivery_shipments (origin_owner_id) where origin_owner_id is not null;

-- ── 3. One leg per order, leg and origin ─────────────────────────────────────

do $$
declare
  c text;
begin
  -- 076's UNIQUE (booking_group_id, leg, attempt), found by its columns.
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.delivery_shipments'::regclass and con.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
           = array['attempt', 'booking_group_id', 'leg']
  loop
    execute format('alter table public.delivery_shipments drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists uq_delivery_shipments_leg_origin_attempt on public.delivery_shipments
  (booking_group_id, leg, coalesce(origin_owner_id, '00000000-0000-0000-0000-000000000000'::uuid), attempt);
drop index if exists public.uq_delivery_shipments_live_leg;
create unique index if not exists uq_delivery_shipments_live_leg_origin on public.delivery_shipments
  (booking_group_id, leg, coalesce(origin_owner_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status not in ('cancelled', 'failed');

-- ── 4. delivery_create_shipment, origin-aware ────────────────────────────────

create or replace function public.delivery_create_shipment(p_shipment jsonb, p_intent jsonb) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_quote_status text;
  v_origin uuid := nullif(p_shipment ->> 'originOwnerId', '')::uuid;
begin
  -- A leg from (or back to) an owner's address takes the same per-owner lock
  -- as delivery_save_owner_pickup, so a save and a new leg never interleave:
  -- whichever is second sees the other (R-91).
  if v_origin is not null then
    perform pg_advisory_xact_lock(hashtext('delivery_save_owner_pickup'), hashtext(v_origin::text));
  end if;
  -- The quote must still be payable or paid. Locked, so it cannot be refunded
  -- (delivery_refund_quote) while a leg is being made from it.
  select status into v_quote_status from public.delivery_quotes where id = (p_shipment ->> 'quoteId')::uuid for update;
  if v_quote_status is null or v_quote_status not in ('active', 'paid') then
    raise exception 'delivery_quote_not_active: %', coalesce(v_quote_status, 'missing') using errcode = 'P0001';
  end if;
  begin
    insert into public.delivery_shipments (
      booking_group_id, leg, attempt, origin_owner_id, renter_id, owner_ids, items, booking_ids, equipment_ids, provider, provider_kind,
      quote_id, merchant_reference, status, quote_amount_cents, customer_fee_cents, platform_fee_cents,
      replacement_value_cents, coverage_verified, insurance_reference, origin_address_id, destination_address_id,
      window_start, window_end, paid_reference)
    values (
      (p_shipment ->> 'bookingGroupId')::uuid, p_shipment ->> 'leg', (p_shipment ->> 'attempt')::int, v_origin,
      (p_shipment ->> 'renterId')::uuid,
      coalesce((select array_agg(distinct (i ->> 'ownerId')::uuid) from jsonb_array_elements(p_shipment -> 'items') i where i ->> 'ownerId' is not null), '{}'),
      p_shipment -> 'items',
      coalesce((select array_agg((i ->> 'bookingId')::uuid) from jsonb_array_elements(p_shipment -> 'items') i), '{}'),
      coalesce((select array_agg((i ->> 'rentalId')::uuid) from jsonb_array_elements(p_shipment -> 'items') i), '{}'),
      p_shipment ->> 'providerId', p_shipment ->> 'providerKind', (p_shipment ->> 'quoteId')::uuid,
      p_shipment ->> 'merchantReference', 'prepared',
      (p_shipment ->> 'quoteAmountCents')::int, (p_shipment ->> 'customerFeeCents')::int, (p_shipment ->> 'platformFeeCents')::int,
      (p_shipment ->> 'replacementValueCents')::bigint, coalesce((p_shipment ->> 'coverageVerified')::boolean, false),
      p_shipment ->> 'insuranceReference', (p_shipment ->> 'originAddressId')::uuid, (p_shipment ->> 'destinationAddressId')::uuid,
      nullif(p_shipment #>> '{window,start}', '')::timestamptz, nullif(p_shipment #>> '{window,end}', '')::timestamptz,
      p_shipment ->> 'paidReference')
    returning id into v_id;
  exception when unique_violation then
    v_id := null;
  end;

  if v_id is null then
    -- The same merchant reference, or the same order + leg + ORIGIN (same attempt, or its live attempt).
    select id into v_id from public.delivery_shipments
     where merchant_reference = p_shipment ->> 'merchantReference'
        or (booking_group_id = (p_shipment ->> 'bookingGroupId')::uuid and leg = p_shipment ->> 'leg'
            and origin_owner_id is not distinct from v_origin
            and (attempt = (p_shipment ->> 'attempt')::int or status not in ('cancelled', 'failed')))
     order by (merchant_reference = p_shipment ->> 'merchantReference') desc, attempt desc
     limit 1;
    return jsonb_build_object('shipment_id', v_id, 'created', false);
  end if;

  insert into public.delivery_dispatch_intents (shipment_id, merchant_reference, idempotency_key, provider)
  values (v_id, p_intent ->> 'merchantReference', p_intent ->> 'idempotencyKey', p_intent ->> 'providerId');
  return jsonb_build_object('shipment_id', v_id, 'created', true);
end;
$$;

-- ── 5. Retention: a retired owner pickup address is purged like the others ──

create or replace function public.delivery_redact_address(p_address uuid, p_fields jsonb, p_now timestamptz) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.delivery_addresses a
     set formatted_address = coalesce(p_fields ->> 'formatted_address', 'Address removed'),
         contact_name = '',
         contact_phone = '',
         instructions = null,
         lat = (p_fields ->> 'lat')::double precision,
         lng = (p_fields ->> 'lng')::double precision,
         redacted_at = p_now
   where a.id = p_address
     and a.redacted_at is null
     -- 080: an owner's ACTIVE pickup address is never purged; a retired one is.
     and (a.purpose in ('renter_address', 'owner_handover') or (a.purpose = 'owner_pickup' and a.retired_at is not null))
     and not exists (
       select 1 from public.delivery_shipments s
        where (s.origin_address_id = a.id or s.destination_address_id = a.id)
          and not (s.status in ('cancelled', 'failed') or (s.status = 'delivered' and s.accepted_at is not null)))
     and not exists (
       select 1 from public.delivery_incidents i
         join public.delivery_shipments s on s.id = i.shipment_id
        where (s.origin_address_id = a.id or s.destination_address_id = a.id)
          and i.status in ('open', 'investigating'))
     and not exists (
       select 1 from public.delivery_quotes q
        where (q.origin_address_id = a.id or q.destination_address_id = a.id)
          and ((q.status = 'active' and q.expires_at > p_now)
               or (q.status = 'paid' and not exists (select 1 from public.delivery_shipments s2 where s2.quote_id = q.id))));
  return found;
end;
$$;

-- CREATE OR REPLACE keeps the ACL; restate it anyway (service_role only).
revoke all on function public.delivery_create_shipment(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.delivery_create_shipment(jsonb, jsonb) to service_role;
revoke all on function public.delivery_redact_address(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.delivery_redact_address(uuid, jsonb, timestamptz) to service_role;

-- ── 6. Per-listing opt-in ────────────────────────────────────────────────────

alter table public.listing_private add column if not exists owner_pickup boolean not null default false;
comment on column public.listing_private.owner_pickup is
  'The owner offers this listing for collection from (and return to) their own pickup address (080, D-86). Default false: the gear goes from the studio.';

-- ── 7. Notification types: + rental_owner_* ──────────────────────────────────

do $$
declare
  def text;
  types text[];
  wanted text[] := array['rental_owner_pickup_scheduled', 'rental_owner_pickup_collected', 'rental_owner_gear_returned'];
  w text;
  changed boolean := false;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if def is null then
    return; -- No list on this database: nothing to extend.
  end if;
  if def ~ '''\{[^'']*\}''' then
    types := (substring(def from '''(\{[^'']*\})'''))::text[];
  else
    select coalesce(array_agg(m[1]), '{}') into types from regexp_matches(def, '''([^'']+)''', 'g') as m;
  end if;
  if coalesce(array_length(types, 1), 0) = 0 then
    raise exception 'notifications_type_check could not be read; not changed: %', def;
  end if;
  foreach w in array wanted loop
    if not (w = any (types)) then
      types := types || w;
      changed := true;
    end if;
  end loop;
  if not changed then
    return;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]::text[]))',
    (select string_agg(quote_literal(t), ', ' order by ord) from unnest(types) with ordinality as u(t, ord)));
end $$;

-- ── 8. The renter's own quotes: the columns they need, nothing else ─────────

-- Table-level SELECT off (this also clears any column grants), then the
-- renter-facing columns back. Re-runnable. The 076 policy ("Own delivery
-- quotes") still decides WHICH rows.
revoke select on public.delivery_quotes from authenticated;
grant select (id, renter_id, booking_group_id, leg, provider, provider_kind, customer_fee_cents, replacement_value_cents,
  booking_ids, rental_ids, window_start, window_end, expires_at, status, paid_reference, paid_at, line_snapshot,
  requested_at, created_at, updated_at) on public.delivery_quotes to authenticated;

-- ── 9. Cancelled-order sweep, per origin ─────────────────────────────────────

create or replace function public.delivery_cancelled_orders_to_settle(p_limit integer) returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.booking_group_id
    from (
      select s.booking_group_id, s.updated_at as since
        from public.delivery_shipments s
       where s.status in ('requested', 'quoted', 'prepared', 'booking', 'scheduled', 'courier_assigned', 'courier_at_pickup')
         -- A return pickup kept because the renter may still have THIS ORIGIN's gear (080: per origin).
         and not (s.leg = 'return'
                  and exists (select 1 from public.delivery_shipments o
                               where o.booking_group_id = s.booking_group_id and o.leg = 'outbound'
                                 and o.origin_owner_id is not distinct from s.origin_owner_id
                                 and o.status in ('delivered', 'damaged', 'incident_under_review'))
                  and not exists (select 1 from public.delivery_shipments r
                                   where r.booking_group_id = s.booking_group_id and r.leg = 'return'
                                     and r.origin_owner_id is not distinct from s.origin_owner_id
                                     and r.status in ('delivered', 'lost', 'damaged', 'incident_under_review')))
      union all
      select q.booking_group_id, q.updated_at
        from public.delivery_quotes q
       where q.status = 'paid'
         and q.booking_group_id is not null
         and not exists (select 1 from public.delivery_shipments s2 where s2.quote_id = q.id)
    ) g
    left join public.delivery_cancelled_order_notes n on n.booking_group_id = g.booking_group_id
   where exists (select 1 from public.equipment_bookings b where b.checkout_group_id = g.booking_group_id)
     and not exists (select 1 from public.equipment_bookings b where b.checkout_group_id = g.booking_group_id and b.status <> 'cancelled')
     and n.staff_hold is null
   group by g.booking_group_id, n.last_attempt_at
   order by n.last_attempt_at nulls first, min(g.since), g.booking_group_id
   limit greatest(coalesce(p_limit, 0), 0);
$$;
revoke all on function public.delivery_cancelled_orders_to_settle(integer) from public, anon, authenticated;
grant execute on function public.delivery_cancelled_orders_to_settle(integer) to service_role;

-- ── 10. Replace an owner's pickup address atomically ─────────────────────────

create or replace function public.delivery_save_owner_pickup(p_owner uuid, p_address jsonb, p_now timestamptz) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_owner is null then
    raise exception 'delivery_save_owner_pickup: owner required' using errcode = '22004';
  end if;
  -- One save per owner at a time: two racing saves would both retire, and the
  -- second insert would hit the one-active-row index.
  perform pg_advisory_xact_lock(hashtext('delivery_save_owner_pickup'), hashtext(p_owner::text));
  -- Checked again under the lock (the app checks first, outside it): a leg
  -- from or back to this owner's address that is still under way keeps the
  -- address. Same rule as the app's LIVE_LEG (lib/delivery/origins.ts).
  if exists (
    select 1 from public.delivery_shipments
     where origin_owner_id = p_owner
       and status not in ('cancelled', 'failed')
       and not (status = 'delivered' and accepted_at is not null)
  ) then
    raise exception 'delivery_owner_pickup_leg_in_progress' using errcode = 'P0001';
  end if;
  update public.delivery_addresses
     set retired_at = coalesce(p_now, now())
   where user_id = p_owner and purpose = 'owner_pickup' and retired_at is null;
  -- If this insert fails (a check, a bad value), the retirement above is undone with it.
  insert into public.delivery_addresses (user_id, purpose, formatted_address, suburb, city, province, postal_code, lat, lng,
    contact_name, contact_phone, instructions, verified_by)
  values (p_owner, 'owner_pickup', p_address ->> 'formatted_address', p_address ->> 'suburb', p_address ->> 'city',
    p_address ->> 'province', p_address ->> 'postal_code', (p_address ->> 'lat')::double precision, (p_address ->> 'lng')::double precision,
    p_address ->> 'contact_name', p_address ->> 'contact_phone', p_address ->> 'instructions', p_address ->> 'verified_by')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.delivery_save_owner_pickup(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.delivery_save_owner_pickup(uuid, jsonb, timestamptz) to service_role;

-- PostgREST picks up the new columns (delivered at commit).
notify pgrst, 'reload schema';

commit;

-- ── ROLLBACK (manual; only while no leg from an owner's address exists) ─────
--   begin;
--   -- Refuse if any leg or quote has an origin: those orders would lose their legs' identity.
--   do $$ begin
--     if exists (select 1 from public.delivery_shipments where origin_owner_id is not null)
--        or exists (select 1 from public.delivery_quotes where origin_owner_id is not null) then
--       raise exception 'owner-origin legs exist; do not roll back 080';
--     end if;
--   end $$;
--   drop index if exists public.uq_delivery_shipments_live_leg_origin, public.uq_delivery_shipments_leg_origin_attempt,
--     public.idx_delivery_shipments_origin_owner, public.uq_delivery_addresses_active_owner_pickup;
--   alter table public.delivery_shipments add constraint delivery_shipments_booking_group_id_leg_attempt_key unique (booking_group_id, leg, attempt);
--   create unique index uq_delivery_shipments_live_leg on public.delivery_shipments (booking_group_id, leg) where status not in ('cancelled', 'failed');
--   alter table public.delivery_shipments drop column origin_owner_id;
--   alter table public.delivery_quotes drop column origin_owner_id;
--   -- Re-run 076's sections 13 delivery_create_shipment, delivery_redact_address and
--   -- delivery_cancelled_orders_to_settle bodies, and 076's table-wide
--   -- `grant select on public.delivery_quotes to authenticated` (or re-apply 076).
--   drop function if exists public.delivery_save_owner_pickup(uuid, jsonb, timestamptz);
--   -- Owner pickup addresses: delete them (they were never used by a leg), then restore the purpose check:
--   delete from public.delivery_addresses where purpose = 'owner_pickup';
--   alter table public.delivery_addresses drop constraint delivery_addresses_owner_pickup_has_owner;
--   alter table public.delivery_addresses drop constraint delivery_addresses_purpose_check;
--   alter table public.delivery_addresses add constraint delivery_addresses_purpose_check check (purpose in ('renter_address', 'owner_handover', 'platform_site'));
--   alter table public.delivery_addresses drop column retired_at;
--   alter table public.listing_private drop column owner_pickup;
--   -- The rental_owner_* notification types may stay (harmless).
--   commit;
