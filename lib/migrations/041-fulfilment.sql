-- 041 — Collection or delivery at checkout
--
-- equipment_bookings had no idea how the customer was getting the gear. The
-- Terms described collection and delivery, but the only trace in the product
-- was a free-text "Pickup/delivery notes" box on the cart, which nobody could
-- price, plan a route from, or report on.
--
-- Adds the choice, the delivery address and its coordinates, the distance and
-- fee we calculated, and whether the customer is paying in full now or paying
-- the deposit now and the hire charge on collection.
--
-- Additive and nullable. Existing bookings keep a null fulfilment_method,
-- which reads as "arranged directly", exactly as they were.

alter table public.equipment_bookings
  add column if not exists fulfilment_method     text,
  add column if not exists payment_plan          text,
  add column if not exists delivery_address      text,
  add column if not exists delivery_lat          double precision,
  add column if not exists delivery_lng          double precision,
  add column if not exists delivery_distance_km  numeric,
  add column if not exists delivery_fee          numeric,
  add column if not exists balance_due           numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'equipment_bookings_fulfilment_method_check'
  ) then
    alter table public.equipment_bookings
      add constraint equipment_bookings_fulfilment_method_check
      check (fulfilment_method is null or fulfilment_method in ('collection', 'delivery'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'equipment_bookings_payment_plan_check'
  ) then
    alter table public.equipment_bookings
      add constraint equipment_bookings_payment_plan_check
      check (payment_plan is null or payment_plan in ('full', 'deposit_only'));
  end if;

  -- A delivery without an address cannot be driven to.
  if not exists (
    select 1 from pg_constraint where conname = 'equipment_bookings_delivery_needs_address_check'
  ) then
    alter table public.equipment_bookings
      add constraint equipment_bookings_delivery_needs_address_check
      check (
        fulfilment_method is distinct from 'delivery'
        or (delivery_address is not null and delivery_fee is not null)
      );
  end if;
end $$;

comment on column public.equipment_bookings.fulfilment_method is
  'collection | delivery. Null on bookings made before this was offered.';
comment on column public.equipment_bookings.payment_plan is
  'full = hire and deposit paid online. deposit_only = deposit paid online to hold the gear, hire charge settled at the counter on collection.';
comment on column public.equipment_bookings.delivery_distance_km is
  'One-way road distance we estimated, in km. Recorded so a fee can be justified to the customer afterwards.';
comment on column public.equipment_bookings.balance_due is
  'Outstanding hire charge payable on collection under a deposit_only plan. Null or zero when nothing is owed.';

-- The dispatch list: what has to go out, and what still has to be collected on.
create index if not exists idx_equipment_bookings_fulfilment
  on public.equipment_bookings (fulfilment_method, start_date)
  where fulfilment_method is not null;

create index if not exists idx_equipment_bookings_balance_due
  on public.equipment_bookings (start_date)
  where balance_due is not null and balance_due > 0;
