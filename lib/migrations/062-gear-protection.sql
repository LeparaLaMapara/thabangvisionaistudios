-- 062: gear protection (TASK-067).
--
-- smart_rentals
--   replacement_value  what it costs to replace the item; drives the renter
--                      limits (lib/rental/protection.ts). Null = use deposit.
--   serial_number      recorded so a stolen item can be reported to SAPS and
--                      checked by second-hand dealers (Second-Hand Goods Act).
--   tracker_fitted     a hidden tracker is in the kit bag.
-- equipment_bookings
--   handover           the in-person handover record: who checked the ID,
--                      condition and renter photos, the signed agreement.
-- Additive only. Apply on dev, then production.

alter table public.smart_rentals
  add column if not exists replacement_value numeric,
  add column if not exists serial_number text,
  add column if not exists tracker_fitted boolean not null default false;

alter table public.equipment_bookings
  add column if not exists handover jsonb;
