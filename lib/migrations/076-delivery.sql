-- 076 — Delivery, logistics and reverse logistics (Phase 4, 2026-10-09)
--
-- WHY
--   Phase 4 adds courier and own-vehicle delivery legs with a chain of custody.
--   Before this there was one delivery fee column per booking line, no record
--   of who held the gear in transit, and no way to tell a provider's
--   "delivered" from a renter's receipt.
--
-- WHAT
--   1. delivery_addresses          verified addresses + driver contact. Server
--                                  only, plus the person whose address it is.
--                                  Never readable by owners or other users.
--   2. delivery_quotes             expiring quotes; provider cost and customer
--                                  fee stored apart.
--   3. delivery_shipments          ONE ROW PER (order, leg, attempt). Legs are
--                                  folded into shipments: a leg is (order,
--                                  outbound|return); each dispatch attempt is
--                                  its own row with its own merchant reference,
--                                  so retries, failures and history are never
--                                  overwritten. At most one live (not
--                                  cancelled/failed) attempt per leg.
--   4. delivery_dispatch_intents   durable intent per shipment: unique merchant
--                                  reference and idempotency key; claimed by
--                                  compare-and-set before any provider call.
--   5. delivery_events             canonical state changes (append-only),
--                                  unique dedupe key per provider event.
--   6. delivery_custody_events     per-item chain of custody (append-only).
--   7. delivery_proofs             evidence references (append-only).
--   8. delivery_incidents          lost / damaged / stolen / delayed / failed
--                                  attempt / driver no-show.
--   9. delivery_provider_events    webhook inbox: what the provider said, kept
--                                  apart from our canonical state. Only
--                                  signature-verified events can be stored.
--  10. delivery_reconciliation     provider invoice vs what we booked.
--  11. delivery_manual_tasks       our own-vehicle "dispatch" (a staff task).
--  12. Ledger accounts courier_costs (expense) and delivery_payable
--      (liability); notification types rental_delivery_*; feature flag
--      delivery_courier (off).
--  13. Functions (SECURITY DEFINER, pinned search_path, service_role only):
--      delivery_create_shipment, delivery_claim_dispatch,
--      delivery_apply_transition, delivery_mark_quote_paid,
--      delivery_open_incident, delivery_save_reconciliation, delivery_post,
--      claim_delivery_provider_events, delivery_insert_fee_refund,
--      delivery_refund_quote, delivery_redact_address.
--
-- REVIEW FIXES (2026-10-09, before 076 was applied anywhere)
--   - Every delivery-fee refund obligation is capped at what is LEFT of the
--     original charge (charge less every obligation already on it), not at
--     the refund itself; a payment with no verified charge on record gets no
--     provider refund (staff alert). delivery_insert_fee_refund.
--   - A paid quote whose leg never ran can be refunded atomically
--     (delivery_refund_quote); quotes gain status 'refunded', the line
--     snapshot they were priced for (line_snapshot) and requested_at.
--   - delivery_create_shipment refuses a quote that is no longer payable
--     (refunded, consumed, superseded), so a refunded fee is never dispatched.
--   - Custody gains the system event 'deemed_accepted' (D-48).
--   - Address purge re-checks, in the same UPDATE, that nothing live uses the
--     address (delivery_redact_address).
--   - Clients read events without actor or note, custody and incidents without
--     evidence (photo links) or staff ids; an owner reads an incident only when
--     every line it concerns is theirs.
--   Provider configuration stays in code/env (lib/delivery/ports.ts,
--   DELIVERY_POLICY), reviewed like any other change; there is no
--   delivery_provider_config table.
--
-- SAFETY
--   Additive and re-runnable (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF
--   EXISTS). No existing row changes. The ledger account and notification type
--   lists are read and EXTENDED (every existing value is kept).
--   Depends on 070 (ledger_post, outbox_enqueue, ledger_refuse_change,
--   refund_obligations, rental_payment_intents). feature_flags (030) is
--   optional: the flag row is seeded only when the table exists.
--
-- APPLY: DEV first, then run 076-delivery.test.sql. PROD only after founder
--        approval. No code path writes to these tables until the checkout
--        integration lands, so applying early is harmless.

begin;

-- ── 1. Addresses (restricted) ────────────────────────────────────────────────

create table if not exists public.delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  -- Whose address this is. Null = one of our own sites.
  user_id uuid references auth.users(id) on delete set null,
  purpose text not null check (purpose in ('renter_address', 'owner_handover', 'platform_site')),
  formatted_address text not null,
  suburb text,
  city text,
  province text,
  postal_code text,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- For the driver only: first name (or business name) and phone. No ID numbers.
  contact_name text not null,
  contact_phone text not null,
  instructions text,
  -- The AddressPort adapter that verified it (never the browser's coordinates).
  verified_by text not null,
  verified_at timestamptz not null default now(),
  -- Purpose-based retention: after this the address is reduced to suburb level.
  retain_until timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_delivery_addresses_user on public.delivery_addresses (user_id);
comment on table public.delivery_addresses is
  'Verified delivery addresses and driver contact details. Server (service_role) and the person whose address it is only. Never exposed to owners or other users.';

-- ── 2. Quotes ────────────────────────────────────────────────────────────────

create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null,
  booking_group_id uuid,
  leg text not null check (leg in ('outbound', 'return')),
  provider text not null,
  provider_kind text not null check (provider_kind in ('courier', 'own_fleet')),
  provider_quote_ref text,
  quote_amount_cents integer not null check (quote_amount_cents >= 0),
  provider_cost_cents integer not null check (provider_cost_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  customer_fee_cents integer not null check (customer_fee_cents >= 0),
  replacement_value_cents bigint not null default 0 check (replacement_value_cents >= 0),
  booking_ids uuid[] not null default '{}',
  rental_ids uuid[] not null default '{}',
  origin_address_id uuid not null references public.delivery_addresses(id),
  destination_address_id uuid not null references public.delivery_addresses(id),
  window_start timestamptz,
  window_end timestamptz,
  expires_at timestamptz not null,
  status text not null default 'active'
    constraint delivery_quotes_status_check check (status in ('active', 'paid', 'consumed', 'expired', 'superseded', 'refunded')),
  -- The charge's transaction reference (rental_payment_intents.reference) once paid,
  -- or a manual payment reference ('manual:…') recorded by staff.
  paid_reference text,
  paid_at timestamptz,
  -- What the quote was priced for: [{rentalId, quantity, startDate, endDate}]. A
  -- quote is stale when the cart's units or dates differ.
  line_snapshot jsonb not null default '[]'::jsonb,
  -- A renter asked for this leg during the hire; staff confirm it after payment.
  requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_fee_cents = provider_cost_cents + platform_fee_cents)
);
create index if not exists idx_delivery_quotes_renter on public.delivery_quotes (renter_id, created_at desc);
create index if not exists idx_delivery_quotes_group on public.delivery_quotes (booking_group_id);
-- Re-runnable on a database that already has the first version of this table.
alter table public.delivery_quotes add column if not exists line_snapshot jsonb not null default '[]'::jsonb;
alter table public.delivery_quotes add column if not exists requested_at timestamptz;
alter table public.delivery_quotes drop constraint if exists delivery_quotes_status_check;
alter table public.delivery_quotes add constraint delivery_quotes_status_check
  check (status in ('active', 'paid', 'consumed', 'expired', 'superseded', 'refunded'));

-- ── 3. Shipments (one per order + leg + attempt) ─────────────────────────────

create table if not exists public.delivery_shipments (
  id uuid primary key default gen_random_uuid(),
  booking_group_id uuid not null,
  leg text not null check (leg in ('outbound', 'return')),
  attempt integer not null check (attempt >= 1),
  renter_id uuid not null,
  -- Owners of the items on the shipment (for owner read access; not granted as a column).
  owner_ids uuid[] not null default '{}',
  -- [{bookingId, rentalId, ownerId, serialNumber}]
  items jsonb not null,
  booking_ids uuid[] not null default '{}',
  equipment_ids uuid[] not null default '{}',
  provider text not null,
  provider_kind text not null check (provider_kind in ('courier', 'own_fleet')),
  quote_id uuid not null references public.delivery_quotes(id),
  merchant_reference text not null unique,
  provider_reference text,
  status text not null default 'prepared' check (status in (
    'requested', 'quoted', 'prepared', 'booking', 'scheduled', 'courier_assigned', 'courier_at_pickup', 'collected',
    'in_transit', 'courier_at_dropoff', 'delivered', 'cancelled', 'failed', 'delivery_attempt_failed', 'return_to_sender',
    'lost', 'damaged', 'incident_under_review')),
  quote_amount_cents integer not null check (quote_amount_cents >= 0),
  customer_fee_cents integer not null check (customer_fee_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  -- Courier cost booked to the ledger so far; the provider's final invoice once reconciled.
  accrued_cost_cents integer not null default 0 check (accrued_cost_cents >= 0),
  provider_cost_cents integer check (provider_cost_cents is null or provider_cost_cents >= 0),
  replacement_value_cents bigint not null default 0 check (replacement_value_cents >= 0),
  coverage_verified boolean not null default false,
  insurance_reference text,
  tracking_reference text,
  tracking_url text,
  courier_name text,
  origin_address_id uuid not null references public.delivery_addresses(id),
  destination_address_id uuid not null references public.delivery_addresses(id),
  window_start timestamptz,
  window_end timestamptz,
  scheduled_at timestamptz,
  collected_at timestamptz,
  delivered_at timestamptz,
  -- Renter accepted every item (outbound) / every item received back (return).
  accepted_at timestamptz,
  last_provider_state_at timestamptz,
  paid_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_group_id, leg, attempt)
);
create unique index if not exists uq_delivery_shipments_live_leg on public.delivery_shipments (booking_group_id, leg)
  where status not in ('cancelled', 'failed');
create index if not exists idx_delivery_shipments_provider_ref on public.delivery_shipments (provider, provider_reference);
create index if not exists idx_delivery_shipments_owner on public.delivery_shipments using gin (owner_ids);
create index if not exists idx_delivery_shipments_open on public.delivery_shipments (status)
  where status not in ('delivered', 'cancelled', 'failed');

-- ── 4. Dispatch intents ──────────────────────────────────────────────────────

create table if not exists public.delivery_dispatch_intents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references public.delivery_shipments(id) on delete restrict,
  merchant_reference text not null unique,
  idempotency_key text not null unique,
  provider text not null,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'succeeded', 'unknown', 'rejected')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  last_error text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5. Canonical events (append-only) ────────────────────────────────────────

create table if not exists public.delivery_events (
  id bigserial primary key,
  shipment_id uuid not null references public.delivery_shipments(id) on delete restrict,
  from_status text not null,
  to_status text not null,
  source text not null check (source in ('provider_webhook', 'provider_poll', 'staff', 'system', 'renter', 'owner')),
  actor_id text,
  -- One canonical change per provider event / confirmation (D12).
  dedupe_key text unique,
  provider_state text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  note text
);
create index if not exists idx_delivery_events_shipment on public.delivery_events (shipment_id, id);

-- ── 6. Chain of custody (append-only) ────────────────────────────────────────

create table if not exists public.delivery_custody_events (
  id bigserial primary key,
  shipment_id uuid not null references public.delivery_shipments(id) on delete restrict,
  booking_group_id uuid not null,
  booking_id uuid not null,
  rental_id uuid not null,
  serial_number text,
  kind text not null constraint delivery_custody_events_kind_check check (kind in ('handed_to_courier', 'collected_by_courier',
    'delivered_to_renter', 'renter_accepted', 'renter_reported_exception', 'deemed_accepted', 'handed_to_return_courier',
    'received_by_owner', 'inspected')),
  -- 'system' records only deemed_accepted (D-48).
  actor_kind text not null constraint delivery_custody_events_actor_kind_check check (actor_kind in ('owner', 'thabangvision_staff', 'courier', 'renter', 'system')),
  -- A user id, or the provider id for a courier.
  actor_id text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  evidence jsonb not null default '[]'::jsonb,
  accessories jsonb not null default '[]'::jsonb,
  serial_confirmed boolean not null default false,
  condition text,
  discrepancies jsonb not null default '[]'::jsonb,
  incident_id uuid,
  dedupe_key text not null unique
);
create index if not exists idx_delivery_custody_shipment on public.delivery_custody_events (shipment_id, booking_id, rental_id, id);
alter table public.delivery_custody_events drop constraint if exists delivery_custody_events_kind_check;
alter table public.delivery_custody_events add constraint delivery_custody_events_kind_check check (kind in ('handed_to_courier',
  'collected_by_courier', 'delivered_to_renter', 'renter_accepted', 'renter_reported_exception', 'deemed_accepted',
  'handed_to_return_courier', 'received_by_owner', 'inspected'));
alter table public.delivery_custody_events drop constraint if exists delivery_custody_events_actor_kind_check;
alter table public.delivery_custody_events add constraint delivery_custody_events_actor_kind_check
  check (actor_kind in ('owner', 'thabangvision_staff', 'courier', 'renter', 'system'));
create index if not exists idx_delivery_custody_booking on public.delivery_custody_events (booking_id);

-- ── 7. Proofs (append-only) ──────────────────────────────────────────────────

create table if not exists public.delivery_proofs (
  id bigserial primary key,
  shipment_id uuid not null references public.delivery_shipments(id) on delete restrict,
  booking_id uuid,
  kind text not null check (kind in ('pin', 'signature', 'photo', 'scan', 'provider_confirmation', 'renter_acceptance')),
  -- A storage key or provider proof id; never the image itself.
  ref text not null,
  source text not null check (source in ('provider', 'staff', 'renter', 'owner')),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (shipment_id, kind, ref)
);

-- ── 8. Incidents ─────────────────────────────────────────────────────────────

create table if not exists public.delivery_incidents (
  id uuid primary key,
  shipment_id uuid not null references public.delivery_shipments(id) on delete restrict,
  booking_group_id uuid not null,
  booking_ids uuid[] not null default '{}',
  leg text not null check (leg in ('outbound', 'return')),
  kind text not null check (kind in ('lost', 'damaged', 'stolen', 'delayed', 'failed_attempt', 'driver_no_show')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  -- true / false / null (not yet attributed: never an automatic late fee).
  provider_caused boolean,
  -- Always 'undetermined' when opened; only a person changes it. No automatic accusation.
  liability text not null default 'undetermined' check (liability in ('undetermined', 'provider', 'renter', 'owner', 'platform', 'none')),
  reported_by_kind text not null check (reported_by_kind in ('provider', 'staff', 'renter', 'owner', 'system')),
  reported_by_id text,
  description text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  dedupe_key text not null unique,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_delivery_incidents_group on public.delivery_incidents (booking_group_id);
create index if not exists idx_delivery_incidents_open on public.delivery_incidents (status) where status in ('open', 'investigating');

-- ── 9. Provider webhook inbox ────────────────────────────────────────────────

create table if not exists public.delivery_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text,
  dedupe_key text not null unique,
  event_type text not null,
  merchant_reference text,
  provider_reference text,
  -- Minimal: ids, states, timestamps. No addresses, names, phone numbers or photos.
  payload jsonb not null,
  -- D11: nothing unverified is ever stored.
  signature_verified boolean not null check (signature_verified),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'dead', 'ignored')),
  retry_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  outcome text
);
create index if not exists idx_delivery_provider_events_todo on public.delivery_provider_events (next_attempt_at)
  where processing_status in ('received', 'failed', 'processing');

-- ── 10. Reconciliation ───────────────────────────────────────────────────────

create table if not exists public.delivery_reconciliation (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.delivery_shipments(id) on delete restrict,
  provider text not null,
  provider_invoice_ref text not null,
  quoted_cents integer not null,
  accrued_cents integer not null,
  invoiced_cents integer not null check (invoiced_cents >= 0),
  difference_cents integer not null,
  status text not null check (status in ('matched', 'over', 'under')),
  checked_at timestamptz not null default now(),
  checked_by uuid,
  unique (shipment_id, provider_invoice_ref)
);

-- ── 11. Own-vehicle staff tasks (manual adapter) ─────────────────────────────

create table if not exists public.delivery_manual_tasks (
  id uuid primary key default gen_random_uuid(),
  merchant_reference text not null unique,
  provider_reference text not null unique,
  leg text not null check (leg in ('outbound', 'return')),
  state text not null default 'pending',
  window_start timestamptz,
  window_end timestamptz,
  item_count integer not null default 1,
  assigned_to uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Append-only guards ───────────────────────────────────────────────────────

drop trigger if exists delivery_events_append_only on public.delivery_events;
create trigger delivery_events_append_only before update or delete on public.delivery_events
  for each row execute function public.ledger_refuse_change();
drop trigger if exists delivery_custody_append_only on public.delivery_custody_events;
create trigger delivery_custody_append_only before update or delete on public.delivery_custody_events
  for each row execute function public.ledger_refuse_change();
drop trigger if exists delivery_proofs_append_only on public.delivery_proofs;
create trigger delivery_proofs_append_only before update or delete on public.delivery_proofs
  for each row execute function public.ledger_refuse_change();

-- ── 12a. Ledger accounts: + courier_costs, delivery_payable ─────────────────
-- Read the current list and append; every existing account is kept.

do $$
declare
  def text;
  accts text[];
  wanted text[] := array['courier_costs', 'delivery_payable'];
  w text;
  changed boolean := false;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.ledger_lines'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%account%'
     and pg_get_constraintdef(c.oid) like '%cash_at_provider%'
   limit 1;
  if def is null then
    raise exception 'ledger_lines account check not found; apply 070 first';
  end if;
  select coalesce(array_agg(m[1]), '{}') into accts from regexp_matches(def, '''([^'']+)''', 'g') as m;
  if coalesce(array_length(accts, 1), 0) < 14 then
    raise exception 'ledger_lines account check could not be read; not changed: %', def;
  end if;
  foreach w in array wanted loop
    if not (w = any (accts)) then
      accts := accts || w;
      changed := true;
    end if;
  end loop;
  if not changed then
    return;
  end if;
  execute (select format('alter table public.ledger_lines drop constraint %I', c.conname)
             from pg_constraint c
            where c.conrelid = 'public.ledger_lines'::regclass and c.contype = 'c'
              and pg_get_constraintdef(c.oid) = def
            limit 1);
  execute format('alter table public.ledger_lines add constraint ledger_lines_account_check check (account = any (array[%s]::text[]))',
    (select string_agg(quote_literal(a), ', ' order by ord) from unnest(accts) with ordinality as u(a, ord)));
end $$;

-- ── 12b. Notification types: + rental_delivery_* ─────────────────────────────

do $$
declare
  def text;
  types text[];
  wanted text[] := array[
    'rental_delivery_quote_ready', 'rental_delivery_booked', 'rental_delivery_courier_assigned',
    'rental_delivery_courier_at_pickup', 'rental_delivery_collected', 'rental_delivery_in_transit',
    'rental_delivery_delivered', 'rental_delivery_attempt_failed', 'rental_delivery_return_reminder',
    'rental_delivery_return_courier_assigned', 'rental_delivery_return_collected',
    'rental_delivery_returned_for_inspection', 'rental_delivery_incident', 'rental_delivery_cancelled',
    'rental_delivery_fee_refund'];
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

-- ── 12c. Feature flag: delivery_courier (off) ────────────────────────────────

do $$
begin
  if to_regclass('public.feature_flags') is not null then
    insert into public.feature_flags (key, enabled, description)
    values ('delivery_courier', false, 'Automated third-party courier delivery (Phase 4). Off until transit cover and the value threshold are approved.')
    on conflict (key) do nothing;
  end if;
end $$;

-- ── 13. Functions ────────────────────────────────────────────────────────────

-- Create a shipment and its dispatch intent together. On a conflict (same
-- order + leg + attempt, same merchant reference, or another live attempt
-- for the leg) returns the existing row with created = false.
create or replace function public.delivery_create_shipment(p_shipment jsonb, p_intent jsonb) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_quote_status text;
begin
  -- The quote must still be payable or paid. Locked, so it cannot be refunded
  -- (delivery_refund_quote) while a leg is being made from it.
  select status into v_quote_status from public.delivery_quotes where id = (p_shipment ->> 'quoteId')::uuid for update;
  if v_quote_status is null or v_quote_status not in ('active', 'paid') then
    raise exception 'delivery_quote_not_active: %', coalesce(v_quote_status, 'missing') using errcode = 'P0001';
  end if;
  begin
    insert into public.delivery_shipments (
      booking_group_id, leg, attempt, renter_id, owner_ids, items, booking_ids, equipment_ids, provider, provider_kind,
      quote_id, merchant_reference, status, quote_amount_cents, customer_fee_cents, platform_fee_cents,
      replacement_value_cents, coverage_verified, insurance_reference, origin_address_id, destination_address_id,
      window_start, window_end, paid_reference)
    values (
      (p_shipment ->> 'bookingGroupId')::uuid, p_shipment ->> 'leg', (p_shipment ->> 'attempt')::int,
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
    select id into v_id from public.delivery_shipments
     where merchant_reference = p_shipment ->> 'merchantReference'
        or (booking_group_id = (p_shipment ->> 'bookingGroupId')::uuid and leg = p_shipment ->> 'leg'
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

-- Compare-and-set claim of a dispatch intent. Exactly one caller wins.
create or replace function public.delivery_claim_dispatch(p_intent uuid, p_from text[], p_now timestamptz, p_stale_before timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.delivery_dispatch_intents
     set state = 'claimed', claimed_at = p_now, attempts = attempts + 1, updated_at = now()
   where id = p_intent
     and ((state <> 'claimed' and state = any (p_from))
          or (state = 'claimed' and 'claimed' = any (p_from) and (claimed_at is null or claimed_at < p_stale_before)));
  return found;
end;
$$;

-- A delivery-fee refund obligation, capped at what is LEFT of the original
-- charge: the paid intent's expected amount less every obligation already on
-- that transaction (any reason: a staff cancellation, a hire refund, another
-- leg). The obligation is never larger than the refund asked for, and never
-- takes the total above the charge. A reference with no verified charge on
-- record (no paid intent) gets NO provider refund: staff are alerted to
-- refund it by hand. A cut-down or skipped refund alerts staff too (the
-- ledger journal then shows more refunds_payable than the obligation, which
-- a person reconciles). Returns the cents the obligation holds (0 = none).
create or replace function public.delivery_insert_fee_refund(p_refund jsonb, p_group uuid, p_evidence jsonb) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := p_refund ->> 'key';
  v_ref text := p_refund ->> 'paidReference';
  v_want integer := (p_refund ->> 'amountCents')::int;
  v_charged integer;
  v_provider text;
  v_already bigint;
  v_amount integer;
  v_alert text;
begin
  if p_refund is null or p_refund = 'null'::jsonb or coalesce(v_want, 0) <= 0 then
    return 0;
  end if;
  -- A replay of the same obligation changes nothing.
  if exists (select 1 from public.refund_obligations where obligation_key = v_key) then
    return 0;
  end if;
  select expected_amount_cents, provider into v_charged, v_provider
    from public.rental_payment_intents
   where reference = v_ref and state in ('paid', 'refund_due', 'refunded');
  if v_charged is null then
    v_alert := 'delivery_refund_unverified_charge';
    v_amount := 0;
  else
    perform pg_advisory_xact_lock(hashtext('refund:' || v_ref));
    select coalesce(sum(amount_cents), 0) into v_already from public.refund_obligations where transaction_reference = v_ref;
    v_amount := least(v_want, greatest(v_charged - v_already, 0))::int;
    if v_amount < v_want then
      v_alert := 'delivery_refund_capped';
    end if;
  end if;
  if v_alert is not null then
    perform public.outbox_enqueue(jsonb_build_array(jsonb_build_object(
      'dedupeKey', 'staff_alert:in_app:staff:delivery:' || v_alert || ':' || v_key,
      'kind', 'staff_alert', 'channel', 'in_app', 'userId', 'staff', 'bookingIds', '[]'::jsonb,
      'data', jsonb_build_object('what', v_alert, 'reference', v_key, 'askedCents', v_want, 'allowedCents', v_amount))));
  end if;
  if v_amount <= 0 then
    return 0;
  end if;
  insert into public.refund_obligations (obligation_key, reason, amount_cents, charged_cents, transaction_reference, provider,
    user_id, booking_group_id, booking_ids, evidence)
  values (v_key, 'cancellation', v_amount, v_charged, v_ref, coalesce(v_provider, 'paystack'), (p_refund ->> 'userId')::uuid,
          p_group, coalesce(array(select jsonb_array_elements_text(p_refund -> 'bookingIds'))::uuid[], '{}'), p_evidence)
  on conflict (obligation_key) do nothing;
  return v_amount;
end;
$$;

-- Post journals and enqueue notices together (idempotent by key).
create or replace function public.delivery_post(p_journals jsonb, p_notices jsonb) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j jsonb;
begin
  if p_journals is not null and jsonb_typeof(p_journals) = 'array' then
    for j in select * from jsonb_array_elements(p_journals) loop
      perform public.ledger_post(j);
    end loop;
  end if;
  perform public.outbox_enqueue(p_notices);
end;
$$;

-- One atomic change to a shipment: CAS on status, canonical event (unique
-- dedupe key), custody events, proofs, incidents, journals, notices, the
-- delivery-fee refund obligation and the quote status. All or nothing.
-- Returns 'applied', 'duplicate' (event already applied) or 'conflict'
-- (status was not in p_from).
create or replace function public.delivery_apply_transition(p jsonb) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ev bigint;
  v_patch jsonb := coalesce(p -> 'patch', '{}'::jsonb);
  v_from text;
  v_group uuid;
  v_refund jsonb := p -> 'refund';
begin
  begin
    select status, booking_group_id into v_from, v_group from public.delivery_shipments
     where id = (p ->> 'shipmentId')::uuid for update;
    if not found then
      raise exception 'delivery_conflict';
    end if;

    insert into public.delivery_events (shipment_id, from_status, to_status, source, actor_id, dedupe_key, provider_state, occurred_at, note)
    values ((p ->> 'shipmentId')::uuid, v_from, p ->> 'to', p #>> '{event,source}', p #>> '{event,actorId}',
            p #>> '{event,dedupeKey}', p #>> '{event,providerState}', (p #>> '{event,occurredAt}')::timestamptz, p #>> '{event,note}')
    on conflict (dedupe_key) do nothing
    returning id into v_ev;
    if v_ev is null then
      return 'duplicate';
    end if;

    update public.delivery_shipments s set
      status = p ->> 'to',
      provider_reference = case when v_patch ? 'providerReference' then v_patch ->> 'providerReference' else s.provider_reference end,
      tracking_reference = case when v_patch ? 'trackingReference' then v_patch ->> 'trackingReference' else s.tracking_reference end,
      tracking_url = case when v_patch ? 'trackingUrl' then v_patch ->> 'trackingUrl' else s.tracking_url end,
      courier_name = case when v_patch ? 'courierName' then v_patch ->> 'courierName' else s.courier_name end,
      scheduled_at = case when v_patch ? 'scheduledAt' then (v_patch ->> 'scheduledAt')::timestamptz else s.scheduled_at end,
      collected_at = case when v_patch ? 'collectedAt' then (v_patch ->> 'collectedAt')::timestamptz else s.collected_at end,
      delivered_at = case when v_patch ? 'deliveredAt' then (v_patch ->> 'deliveredAt')::timestamptz else s.delivered_at end,
      accepted_at = case when v_patch ? 'acceptedAt' then (v_patch ->> 'acceptedAt')::timestamptz else s.accepted_at end,
      last_provider_state_at = case when v_patch ? 'lastProviderStateAt' then (v_patch ->> 'lastProviderStateAt')::timestamptz else s.last_provider_state_at end,
      provider_cost_cents = case when v_patch ? 'providerCostCents' then (v_patch ->> 'providerCostCents')::int else s.provider_cost_cents end,
      accrued_cost_cents = case when v_patch ? 'accruedCostCents' then (v_patch ->> 'accruedCostCents')::int else s.accrued_cost_cents end,
      updated_at = now()
     where s.id = (p ->> 'shipmentId')::uuid
       and s.status in (select jsonb_array_elements_text(p -> 'from'));
    if not found then
      raise exception 'delivery_conflict';
    end if;

    insert into public.delivery_custody_events (shipment_id, booking_group_id, booking_id, rental_id, serial_number, kind,
      actor_kind, actor_id, occurred_at, evidence, accessories, serial_confirmed, condition, discrepancies, incident_id, dedupe_key)
    select (c ->> 'shipmentId')::uuid, (c ->> 'bookingGroupId')::uuid, (c ->> 'bookingId')::uuid, (c ->> 'rentalId')::uuid,
           c ->> 'serialNumber', c ->> 'kind', c #>> '{actor,kind}', c #>> '{actor,id}', (c ->> 'occurredAt')::timestamptz,
           coalesce(c -> 'evidence', '[]'), coalesce(c -> 'accessories', '[]'), coalesce((c ->> 'serialConfirmed')::boolean, false),
           c ->> 'condition', coalesce(c -> 'discrepancies', '[]'), nullif(c ->> 'incidentId', '')::uuid, c ->> 'dedupeKey'
      from jsonb_array_elements(coalesce(p -> 'custody', '[]')) c
    on conflict (dedupe_key) do nothing;

    insert into public.delivery_proofs (shipment_id, booking_id, kind, ref, source, captured_at)
    select (x ->> 'shipmentId')::uuid, nullif(x ->> 'bookingId', '')::uuid, x ->> 'kind', x ->> 'ref', x ->> 'source', (x ->> 'capturedAt')::timestamptz
      from jsonb_array_elements(coalesce(p -> 'proofs', '[]')) x
    on conflict (shipment_id, kind, ref) do nothing;

    insert into public.delivery_incidents (id, shipment_id, booking_group_id, booking_ids, leg, kind, status, provider_caused,
      liability, reported_by_kind, reported_by_id, description, evidence, dedupe_key, created_at)
    select (i ->> 'id')::uuid, (i ->> 'shipmentId')::uuid, (i ->> 'bookingGroupId')::uuid,
           coalesce(array(select jsonb_array_elements_text(i -> 'bookingIds'))::uuid[], '{}'),
           i ->> 'leg', i ->> 'kind', 'open', (i ->> 'providerCaused')::boolean, 'undetermined',
           i #>> '{reportedBy,kind}', i #>> '{reportedBy,id}', coalesce(i ->> 'description', ''), coalesce(i -> 'evidence', '[]'),
           i ->> 'dedupeKey', coalesce((i ->> 'createdAt')::timestamptz, now())
      from jsonb_array_elements(coalesce(p -> 'incidents', '[]')) i
    on conflict (dedupe_key) do nothing;

    perform public.delivery_post(p -> 'journals', p -> 'notices');

    -- Capped at what is left of the charge (never above what was charged in total).
    perform public.delivery_insert_fee_refund(v_refund, v_group, jsonb_build_object('delivery_shipment_id', p ->> 'shipmentId'));

    if p -> 'quoteStatus' is not null and p -> 'quoteStatus' <> 'null'::jsonb then
      update public.delivery_quotes set status = p #>> '{quoteStatus,to}', updated_at = now()
       where id = (p #>> '{quoteStatus,quoteId}')::uuid;
    end if;
    return 'applied';
  exception when raise_exception then
    if sqlerrm = 'delivery_conflict' then
      return 'conflict';
    end if;
    raise;
  end;
end;
$$;

-- Mark a quote paid (compare-and-set) and every shipment made from it.
create or replace function public.delivery_mark_quote_paid(p_quote uuid, p_from text[], p_to text, p_paid_reference text, p_booking_group uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.delivery_quotes
     set status = p_to,
         paid_reference = coalesce(p_paid_reference, paid_reference),
         paid_at = case when p_paid_reference is not null then now() else paid_at end,
         booking_group_id = coalesce(p_booking_group, booking_group_id),
         updated_at = now()
   where id = p_quote and status = any (p_from);
  if not found then
    return false;
  end if;
  if p_paid_reference is not null then
    update public.delivery_shipments set paid_reference = p_paid_reference, updated_at = now() where quote_id = p_quote;
  end if;
  return true;
end;
$$;

-- A paid quote whose leg never ran: paid -> refunded (compare-and-set, and only
-- while no live shipment uses it), its journal, notices and the capped refund
-- obligation, all or nothing. Returns 'applied' or 'conflict'.
create or replace function public.delivery_refund_quote(p jsonb) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := (p ->> 'quoteId')::uuid;
  v_status text;
  v_group uuid;
begin
  select status, booking_group_id into v_status, v_group from public.delivery_quotes where id = v_id for update;
  if v_status is distinct from 'paid' then
    return 'conflict';
  end if;
  if exists (select 1 from public.delivery_shipments where quote_id = v_id and status not in ('cancelled', 'failed')) then
    return 'conflict';
  end if;
  update public.delivery_quotes set status = 'refunded', updated_at = now() where id = v_id;
  perform public.delivery_post(p -> 'journals', p -> 'notices');
  perform public.delivery_insert_fee_refund(p -> 'refund', coalesce(v_group, (p ->> 'bookingGroupId')::uuid), jsonb_build_object('delivery_quote_id', v_id));
  return 'applied';
end;
$$;

-- Reduce an address to suburb level (R-41, D-46), only if nothing live uses it
-- AT THE MOMENT OF WRITING: no open shipment (anything but cancelled, failed,
-- or delivered and accepted/received), no open incident on a shipment using
-- it, no live quote, no paid quote still to be dispatched. The job decides
-- first; this re-check closes the gap between that decision and the write.
-- Returns true when this call redacted it.
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
     and a.purpose in ('renter_address', 'owner_handover')
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

-- An incident outside a state change, with its notices. Returns false on a duplicate.
create or replace function public.delivery_open_incident(p_incident jsonb, p_notices jsonb) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.delivery_incidents (id, shipment_id, booking_group_id, booking_ids, leg, kind, status, provider_caused,
    liability, reported_by_kind, reported_by_id, description, evidence, dedupe_key, created_at)
  values ((p_incident ->> 'id')::uuid, (p_incident ->> 'shipmentId')::uuid, (p_incident ->> 'bookingGroupId')::uuid,
          coalesce(array(select jsonb_array_elements_text(p_incident -> 'bookingIds'))::uuid[], '{}'),
          p_incident ->> 'leg', p_incident ->> 'kind', 'open', (p_incident ->> 'providerCaused')::boolean, 'undetermined',
          p_incident #>> '{reportedBy,kind}', p_incident #>> '{reportedBy,id}', coalesce(p_incident ->> 'description', ''),
          coalesce(p_incident -> 'evidence', '[]'), p_incident ->> 'dedupeKey', coalesce((p_incident ->> 'createdAt')::timestamptz, now()))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  perform public.outbox_enqueue(p_notices);
  return true;
end;
$$;

-- A reconciliation row with its adjusting journals, notices and shipment cost. Returns false on a duplicate.
create or replace function public.delivery_save_reconciliation(p_record jsonb, p_journals jsonb, p_notices jsonb) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.delivery_reconciliation (shipment_id, provider, provider_invoice_ref, quoted_cents, accrued_cents,
    invoiced_cents, difference_cents, status, checked_at, checked_by)
  values ((p_record ->> 'shipmentId')::uuid, p_record ->> 'providerId', p_record ->> 'providerInvoiceRef',
          (p_record ->> 'quotedCents')::int, (p_record ->> 'accruedCents')::int, (p_record ->> 'invoicedCents')::int,
          (p_record ->> 'differenceCents')::int, p_record ->> 'status', coalesce((p_record ->> 'checkedAt')::timestamptz, now()),
          nullif(p_record ->> 'checkedBy', '')::uuid)
  on conflict (shipment_id, provider_invoice_ref) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  update public.delivery_shipments
     set provider_cost_cents = (p_record ->> 'invoicedCents')::int,
         accrued_cost_cents = (p_record ->> 'invoicedCents')::int,
         updated_at = now()
   where id = (p_record ->> 'shipmentId')::uuid;
  perform public.delivery_post(p_journals, p_notices);
  return true;
end;
$$;

create or replace function public.claim_delivery_provider_events(p_limit integer, p_max_retries integer default 8)
returns setof public.delivery_provider_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Give up on events that keep failing: a person looks at the dead letters.
  update public.delivery_provider_events
     set processing_status = 'dead'
   where processing_status in ('failed', 'processing') and retry_count >= p_max_retries;

  return query
  update public.delivery_provider_events e
     set processing_status = 'processing',
         retry_count = e.retry_count + 1,
         next_attempt_at = now() + interval '10 minutes'
   where e.id in (
     select id from public.delivery_provider_events
      where processing_status in ('received', 'failed', 'processing')
        and next_attempt_at <= now()
      order by received_at
      limit p_limit
      for update skip locked)
  returning e.*;
end;
$$;

-- ── 14. Access ───────────────────────────────────────────────────────────────

alter table public.delivery_addresses enable row level security;
alter table public.delivery_quotes enable row level security;
alter table public.delivery_shipments enable row level security;
alter table public.delivery_dispatch_intents enable row level security;
alter table public.delivery_events enable row level security;
alter table public.delivery_custody_events enable row level security;
alter table public.delivery_proofs enable row level security;
alter table public.delivery_incidents enable row level security;
alter table public.delivery_provider_events enable row level security;
alter table public.delivery_reconciliation enable row level security;
alter table public.delivery_manual_tasks enable row level security;

revoke all on public.delivery_addresses, public.delivery_quotes, public.delivery_shipments, public.delivery_dispatch_intents,
  public.delivery_events, public.delivery_custody_events, public.delivery_proofs, public.delivery_incidents,
  public.delivery_provider_events, public.delivery_reconciliation, public.delivery_manual_tasks
  from public, anon, authenticated;

-- Signed-in users read only their own rows (policies below). Shipments: only
-- the columns that carry no address, tracking link or money detail.
grant select on public.delivery_addresses, public.delivery_quotes to authenticated;
grant select (id, booking_group_id, leg, attempt, provider, provider_kind, status, window_start, window_end,
  scheduled_at, collected_at, delivered_at, accepted_at, created_at, updated_at) on public.delivery_shipments to authenticated;
-- History without who did it or staff notes (actor_id, note).
grant select (id, shipment_id, from_status, to_status, source, provider_state, occurred_at, recorded_at)
  on public.delivery_events to authenticated;
-- Custody without the evidence (photo links taken at the renter's door or at
-- an owner's handover) or the actor's id.
grant select (id, shipment_id, booking_group_id, booking_id, rental_id, serial_number, kind, actor_kind, occurred_at, recorded_at,
  accessories, serial_confirmed, condition, discrepancies, incident_id) on public.delivery_custody_events to authenticated;
-- Incidents without evidence, reporter/resolver ids or the staff resolution note.
grant select (id, shipment_id, booking_group_id, booking_ids, leg, kind, status, provider_caused, liability, reported_by_kind,
  description, resolved_at, created_at, updated_at) on public.delivery_incidents to authenticated;

grant all on public.delivery_addresses, public.delivery_quotes, public.delivery_shipments, public.delivery_dispatch_intents,
  public.delivery_incidents, public.delivery_provider_events, public.delivery_reconciliation, public.delivery_manual_tasks
  to service_role;
-- Evidence and history: service_role may insert and read, never change.
grant select, insert on public.delivery_events, public.delivery_custody_events, public.delivery_proofs to service_role;
revoke update, delete, truncate on public.delivery_events, public.delivery_custody_events, public.delivery_proofs from service_role;
grant usage on sequence public.delivery_events_id_seq, public.delivery_custody_events_id_seq, public.delivery_proofs_id_seq to service_role;

-- D21: an address is readable by the person it belongs to. Owners and other users never.
drop policy if exists "Own delivery addresses" on public.delivery_addresses;
create policy "Own delivery addresses" on public.delivery_addresses for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Own delivery quotes" on public.delivery_quotes;
create policy "Own delivery quotes" on public.delivery_quotes for select to authenticated
  using (renter_id = auth.uid() or public.is_admin());

-- D22: the renter, the owners of gear on the shipment, and admins. Nobody else.
drop policy if exists "Renter or owner reads shipment" on public.delivery_shipments;
create policy "Renter or owner reads shipment" on public.delivery_shipments for select to authenticated
  using (renter_id = auth.uid() or auth.uid() = any (owner_ids) or public.is_admin());

-- Policy helpers. SECURITY DEFINER so a policy can look at the shipment's
-- renter and item owners without granting those columns to clients. They
-- answer only "may the CALLER read this?" for the caller's own auth.uid().
create or replace function public.delivery_is_renter(p_shipment uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.delivery_shipments s where s.id = p_shipment and s.renter_id = auth.uid());
$$;

create or replace function public.delivery_owns_any(p_shipment uuid, p_bookings uuid[]) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.delivery_shipments s, jsonb_array_elements(s.items) i
     where s.id = p_shipment
       and (i ->> 'ownerId') = auth.uid()::text
       and (i ->> 'bookingId')::uuid = any (p_bookings));
$$;

-- The caller owns EVERY booking line in p_bookings on this shipment (and there is at least one).
create or replace function public.delivery_owns_all(p_shipment uuid, p_bookings uuid[]) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_length(p_bookings, 1), 0) > 0
     and not exists (
       select 1 from unnest(p_bookings) b
        where not exists (
          select 1 from public.delivery_shipments s, jsonb_array_elements(s.items) i
           where s.id = p_shipment
             and (i ->> 'ownerId') = auth.uid()::text
             and (i ->> 'bookingId')::uuid = b));
$$;

drop policy if exists "Renter reads delivery events" on public.delivery_events;
create policy "Renter reads delivery events" on public.delivery_events for select to authenticated
  using (public.is_admin() or public.delivery_is_renter(shipment_id));

-- Custody: the renter of the shipment, the owner of THAT item, admins.
drop policy if exists "Party reads custody" on public.delivery_custody_events;
create policy "Party reads custody" on public.delivery_custody_events for select to authenticated
  using (public.is_admin() or public.delivery_is_renter(shipment_id) or public.delivery_owns_any(shipment_id, array[booking_id]));

drop policy if exists "Party reads incidents" on public.delivery_incidents;
-- An owner reads an incident only when every line it concerns is theirs: a
-- report about another owner's item, or the whole order, is not theirs to read.
create policy "Party reads incidents" on public.delivery_incidents for select to authenticated
  using (public.is_admin() or public.delivery_is_renter(shipment_id) or public.delivery_owns_all(shipment_id, booking_ids));

revoke all on function public.delivery_is_renter(uuid), public.delivery_owns_any(uuid, uuid[]), public.delivery_owns_all(uuid, uuid[]) from public, anon;
grant execute on function public.delivery_is_renter(uuid), public.delivery_owns_any(uuid, uuid[]), public.delivery_owns_all(uuid, uuid[]) to authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.delivery_create_shipment(jsonb, jsonb)',
    'public.delivery_claim_dispatch(uuid, text[], timestamptz, timestamptz)',
    'public.delivery_post(jsonb, jsonb)',
    'public.delivery_apply_transition(jsonb)',
    'public.delivery_mark_quote_paid(uuid, text[], text, text, uuid)',
    'public.delivery_open_incident(jsonb, jsonb)',
    'public.delivery_save_reconciliation(jsonb, jsonb, jsonb)',
    'public.claim_delivery_provider_events(integer, integer)',
    'public.delivery_insert_fee_refund(jsonb, uuid, jsonb)',
    'public.delivery_refund_quote(jsonb)',
    'public.delivery_redact_address(uuid, jsonb, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

-- ── ROLLBACK (manual; only before any delivery has been dispatched) ──────────
--   begin;
--   drop policy if exists "Party reads custody" on public.delivery_custody_events;
--   drop policy if exists "Party reads incidents" on public.delivery_incidents;
--   drop policy if exists "Renter reads delivery events" on public.delivery_events;
--   drop function if exists public.delivery_owns_all(uuid, uuid[]), public.delivery_owns_any(uuid, uuid[]),
--     public.delivery_is_renter(uuid);
--   drop function if exists public.delivery_redact_address(uuid, jsonb, timestamptz), public.delivery_refund_quote(jsonb),
--     public.delivery_insert_fee_refund(jsonb, uuid, jsonb);
--   drop function if exists public.claim_delivery_provider_events(integer, integer),
--     public.delivery_save_reconciliation(jsonb, jsonb, jsonb), public.delivery_open_incident(jsonb, jsonb),
--     public.delivery_mark_quote_paid(uuid, text[], text, text, uuid), public.delivery_apply_transition(jsonb),
--     public.delivery_post(jsonb, jsonb), public.delivery_claim_dispatch(uuid, text[], timestamptz, timestamptz),
--     public.delivery_create_shipment(jsonb, jsonb);
--   drop table if exists public.delivery_manual_tasks, public.delivery_reconciliation, public.delivery_provider_events,
--     public.delivery_incidents, public.delivery_proofs, public.delivery_custody_events, public.delivery_events,
--     public.delivery_dispatch_intents, public.delivery_shipments, public.delivery_quotes, public.delivery_addresses;
--   delete from public.feature_flags where key = 'delivery_courier';   -- if 030 is applied
--   -- The added ledger accounts and rental_delivery_* notification types may stay (harmless).
--   -- To remove them, re-create ledger_lines_account_check / notifications_type_check without them,
--   -- ONLY if no ledger line or notification uses them.
--   commit;
-- Once a delivery fee or courier cost is in the ledger, do NOT drop these tables:
-- custody events and delivery journals are part of the financial and evidential record.
