-- 093: studios as a rental category, with a half-day price.
--
-- Needs 056 (smart_rentals_category_check). One transaction, safe to run twice.
--
-- WHAT THIS DOES
--   1. Adds 'studios' to smart_rentals_category_check. The category is a URL
--      segment and must stay in step with RENTAL_CATEGORIES in
--      lib/constants.ts (056). The owner's studio in Dainfern, Fourways is the
--      first listing (scripts/rentals/studio-listing.sql, run after this).
--   2. smart_rentals.price_per_half_day: the half-day price in RANDS, like the
--      other smart_rentals prices (docs/database/schema.md "Money: cents or
--      rands"). Null means no half-day option; the site shows it only for a
--      place (ON_SITE_RENTAL). Bookings are still whole days, so a half day is
--      offered as "ask us" on WhatsApp, never charged from this column.
--
-- ROLLBACK (only once no row uses 'studios')
--   alter table public.smart_rentals drop column if exists price_per_half_day;
--   alter table public.smart_rentals drop constraint if exists smart_rentals_category_check;
--   alter table public.smart_rentals add constraint smart_rentals_category_check
--     check (category in ('cameras-optics', 'lighting-power', 'audio', 'grip-motion',
--       'data-storage', 'specialized-solutions', 'aerial-support', 'sound-reinforcement'));

begin;

alter table public.smart_rentals drop constraint if exists smart_rentals_category_check;
alter table public.smart_rentals add constraint smart_rentals_category_check
  check (category in (
    'cameras-optics', 'lighting-power', 'audio', 'grip-motion',
    'data-storage', 'specialized-solutions', 'aerial-support', 'sound-reinforcement',
    'studios'
  ));

alter table public.smart_rentals add column if not exists price_per_half_day numeric;

alter table public.smart_rentals drop constraint if exists smart_rentals_price_per_half_day_check;
alter table public.smart_rentals add constraint smart_rentals_price_per_half_day_check
  check (price_per_half_day is null or price_per_half_day > 0);

comment on column public.smart_rentals.price_per_half_day is
  'Half-day price in rands (like price_per_day). Null = no half-day option. Shown for places (the studios category) only; bookings are whole days, so a half day is arranged on WhatsApp.';

commit;
