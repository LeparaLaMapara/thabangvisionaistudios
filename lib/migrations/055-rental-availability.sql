-- 055 — Make availability count units, and stop abandoned checkouts holding stock
--
-- TWO DEFECTS.
--
-- 1. smart_rentals.quantity was never consulted. The availability check ran
--    .in('status', ['pending','confirmed','active']).limit(1) and refused the
--    booking if ANY overlapping row existed. So a listing with two cameras
--    still only ever rented ONE at a time, and the second customer was told
--    "unavailable for selected dates" while a camera sat on the shelf.
--
--    Fixing it needs a unit count on the booking, which did not exist: a cart
--    line of three units became one equipment_bookings row with no record of
--    how many. total_price was quantity-aware, nothing else was.
--
-- 2. A hold was created at CHECKOUT, before payment, and never expired. Walk
--    away at the payment page and those dates were blocked forever. There is a
--    cron that cancels unpaid service bookings after 72h; equipment had no
--    equivalent. On production this had already cost five date ranges, the
--    oldest unsellable for 161 days.

alter table public.equipment_bookings
  add column if not exists quantity integer not null default 1;

-- Existing rows each represented one cart line. The line's unit count was only
-- ever reflected in total_price, so 1 is the best available assumption and the
-- default keeps them valid.
comment on column public.equipment_bookings.quantity is
  'Units of this listing on the booking. Availability sums this across overlapping bookings and compares against smart_rentals.quantity.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'equipment_bookings_quantity_positive'
  ) then
    alter table public.equipment_bookings
      add constraint equipment_bookings_quantity_positive check (quantity >= 1);
  end if;
end $$;

-- The availability query filters by rental and overlapping dates on every
-- checkout, so it is worth an index.
create index if not exists idx_equipment_bookings_availability
  on public.equipment_bookings (rental_id, start_date, end_date)
  where status in ('pending', 'confirmed', 'active');

-- Release the holds that are already stuck. These are unpaid, months old, and
-- have been silently removing inventory from sale.
update public.equipment_bookings
   set status = 'cancelled',
       cancelled_at = now(),
       updated_at = now(),
       notes = coalesce(notes || ' | ', '')
               || 'Auto-released: unpaid checkout hold expired (migration 055).'
 where status = 'pending'
   and payfast_payment_id is null
   and created_at < now() - interval '30 minutes';
