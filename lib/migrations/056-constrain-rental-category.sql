-- 056 — Constrain smart_rentals.category to the slugs the routes actually serve
--
-- `category` was free text with no constraint, and it is a URL segment:
-- /rentals/[category]/[slug]. So a typo does not fail, it publishes an item to
-- an address nobody can reach.
--
-- Both things that go wrong had already happened.
--
-- 1. PRODUCTION: "Baofeng UHF Radio" sat in 'crew-services'. That is not one of
--    the eight categories in RENTAL_CATEGORIES, and worse, the rental detail
--    page opens with:
--
--        if (category === 'crew-services') redirect('/studio');
--
--    So a published item at R100/day sent every visitor to the Studio page
--    instead of showing itself. It is production support comms rather than
--    audio production gear, so it moves to specialized-solutions.
--
-- 2. DEV: had drifted to display labels entirely — 'Cameras & Optics',
--    'Lighting', 'Drones', 'Monitors', 'Rigging', 'Stabilisation', 'Support'.
--    Those produce URLs like /rentals/Cameras & Optics/sony-a7iv. Remapped to
--    the canonical slugs before this constraint is applied.
--
-- The constraint is the actual fix. Aligning the rows once only holds until the
-- next hand-typed value.

update public.smart_rentals
   set category = 'specialized-solutions',
       updated_at = now()
 where category = 'crew-services';

-- Display labels, seen on dev. Harmless where they do not exist.
update public.smart_rentals set category = 'cameras-optics'        where category = 'Cameras & Optics';
update public.smart_rentals set category = 'audio'                 where category = 'Audio';
update public.smart_rentals set category = 'lighting-power'        where category in ('Lighting', 'Lighting & Power');
update public.smart_rentals set category = 'aerial-support'        where category = 'Drones';
update public.smart_rentals set category = 'grip-motion'           where category in ('Stabilisation', 'Support', 'Rigging', 'Grip & Motion');
update public.smart_rentals set category = 'data-storage'          where category in ('Monitors', 'Data & Storage');
update public.smart_rentals set category = 'specialized-solutions' where category = 'Specialized Solutions';
update public.smart_rentals set category = 'sound-reinforcement'   where category = 'Sound Reinforcement';

-- Anything still unrecognised is parked somewhere reachable rather than left at
-- a dead URL. Better a wrong shelf than no shelf.
update public.smart_rentals
   set category = 'specialized-solutions'
 where category is not null
   and category not in (
     'cameras-optics', 'lighting-power', 'audio', 'grip-motion',
     'data-storage', 'specialized-solutions', 'aerial-support', 'sound-reinforcement'
   );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'smart_rentals_category_check'
  ) then
    alter table public.smart_rentals
      add constraint smart_rentals_category_check
      check (category in (
        'cameras-optics', 'lighting-power', 'audio', 'grip-motion',
        'data-storage', 'specialized-solutions', 'aerial-support', 'sound-reinforcement'
      ));
  end if;
end $$;

comment on column public.smart_rentals.category is
  'Rental category slug. This is a URL segment (/rentals/[category]/[slug]) and must
   stay in step with RENTAL_CATEGORIES in lib/constants.ts. Adding a category means
   updating both the constant and this constraint.';
