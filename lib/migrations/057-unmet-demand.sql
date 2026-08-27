-- 057 — Record the demand we could not serve
--
-- The platform has perfect data on what it sold and none at all on what it
-- could not sell. Someone searches for a drone on the 12th, it is booked, they
-- leave, and nothing is written down.
--
-- The unsold half is the more valuable one. It is what tells you which gear to
-- buy next, which dates are worth more, which skills to train for, and
-- eventually what is worth building. A marketplace forgets these moments. This
-- is the table that stops forgetting.
--
-- Deliberately not a log of everything. Three signals only, each one a moment
-- where a person wanted something and the platform said no:
--
--   search_no_results  they asked and the catalogue had nothing
--   unavailable_dates  the item exists but was taken
--   not_in_catalogue   Ubunye was asked for gear we do not carry
--
-- Written on a best-effort basis: recording demand must never be able to fail
-- a checkout. See lib/demand/record.ts.

create table if not exists public.unmet_demand (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in (
                  'search_no_results', 'unavailable_dates', 'not_in_catalogue'
                )),

  -- What they were after. Normalised (trimmed, lowercased, collapsed spaces)
  -- so that "Sony A7" and "sony  a7 " aggregate into one row rather than two.
  query         text not null,

  -- Set when the thing exists but could not be had. Null for the kinds where
  -- there is no item to point at.
  rental_id     uuid references public.smart_rentals(id) on delete set null,
  start_date    date,
  end_date      date,

  -- How many units were wanted vs how many were free, for 'unavailable_dates'.
  requested     integer,
  available     integer,

  -- Who, when known. Null for signed-out visitors, which is most of them.
  user_id       uuid references public.profiles(id) on delete set null,

  -- Where the signal came from: 'search' | 'checkout' | 'ubunye'.
  source        text not null,

  created_at    timestamptz not null default now()
);

comment on table public.unmet_demand is
  'Moments where someone wanted something and the platform said no. The buying
   signal that ordinary marketplace analytics throws away. Aggregate, never
   per-person: this is inventory research, not user tracking.';

create index if not exists idx_unmet_demand_kind_created
  on public.unmet_demand (kind, created_at desc);

create index if not exists idx_unmet_demand_query
  on public.unmet_demand (query);

create index if not exists idx_unmet_demand_rental
  on public.unmet_demand (rental_id)
  where rental_id is not null;

alter table public.unmet_demand enable row level security;

-- Service role only. Nobody reads this from the browser, and it is written
-- through the admin client from server routes. An anon SELECT policy here would
-- publish what customers are searching for.
drop policy if exists "unmet_demand service only" on public.unmet_demand;
create policy "unmet_demand service only"
  on public.unmet_demand
  for all
  using (false)
  with check (false);

-- What the founder actually wants to look at: what is being asked for that we
-- cannot supply, most wanted first.
create or replace view public.unmet_demand_summary
with (security_invoker = true) as
select
  kind,
  query,
  count(*)                                as times,
  count(distinct coalesce(user_id::text, id::text)) as people,
  max(created_at)                         as last_asked,
  min(created_at)                         as first_asked
from public.unmet_demand
group by kind, query
order by times desc, last_asked desc;

comment on view public.unmet_demand_summary is
  'Unmet demand grouped by what was asked for. security_invoker so it inherits
   the base table RLS rather than bypassing it.';
