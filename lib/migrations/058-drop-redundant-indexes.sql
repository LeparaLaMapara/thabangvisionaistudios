-- 058 — Drop two redundant indexes
--
-- The schema is well indexed; these two are simply duplicates, and a duplicate
-- index is pure cost: it is maintained on every insert and update to the table
-- and occupies storage, while the planner only ever needs one of the pair.
--
-- 1. equipment_bookings has TWO identical indexes on the availability path:
--       idx_bookings_dates
--       idx_equipment_bookings_availability
--    Both are (rental_id, start_date, end_date) WHERE status IN
--    ('pending','confirmed','active'). equipment_bookings is written on every
--    checkout, so this is write amplification on the hottest table. Keep the
--    descriptively-named one that migration 055 created.
--
-- 2. bookings.reference has a plain index AND a unique constraint index:
--       idx_bookings_reference        (plain)
--       bookings_reference_key        (unique)
--    The unique index satisfies every lookup the plain one does. Drop the plain.

drop index if exists public.idx_bookings_dates;
drop index if exists public.idx_bookings_reference;
