-- 092: one person, one portfolio, one rate (TASK-085, owner 2026-10-14).
-- Needs 090 and 091. Additive only. Safe to run more than once.
--
--   1. role_evidence.album: an optional label so one profile groups its work
--      into albums (Maternity, Family and events, Portraits).
--   2. role_evidence.source_production_id: the smart_productions package a
--      work item was copied from. A package whose work a profile holds is no
--      longer listed on People, and its old address redirects to the profile.
--   3. person_roles.pricing_unit: a person's own unit (per day) over the
--      role's default (per hour). Readable by browsers like the price.
--   4. role_booking_requests.requested_dates, unit, total_cents: a request
--      for one or more days, and the one price shown before sending.
--
-- ROLLBACK: scripts/db/rollback/092-people-portfolio.sql

begin;

alter table public.role_evidence add column if not exists album text;
alter table public.role_evidence add column if not exists source_production_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.role_evidence'::regclass and conname = 'role_evidence_album_check') then
    alter table public.role_evidence add constraint role_evidence_album_check check (album is null or (length(album) between 1 and 40 and album !~ '[<>]'));
  end if;
end $$;
create index if not exists idx_role_evidence_source_production on public.role_evidence (source_production_id) where source_production_id is not null;
grant insert (album) on public.role_evidence to authenticated;

alter table public.person_roles add column if not exists pricing_unit text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.person_roles'::regclass and conname = 'person_roles_pricing_unit_check') then
    alter table public.person_roles add constraint person_roles_pricing_unit_check
      check (pricing_unit is null or pricing_unit in ('hour', 'half_day', 'day', 'look', 'day_plus_km', 'project'));
  end if;
end $$;
grant select (pricing_unit) on public.person_roles to anon, authenticated;
grant update (pricing_unit) on public.person_roles to authenticated;

do $$
begin
  if to_regclass('public.role_booking_requests') is not null then
    alter table public.role_booking_requests add column if not exists requested_dates date[];
    alter table public.role_booking_requests add column if not exists unit text;
    alter table public.role_booking_requests add column if not exists total_cents integer;
    if not exists (select 1 from pg_constraint where conrelid = 'public.role_booking_requests'::regclass and conname = 'role_booking_requests_total_check') then
      alter table public.role_booking_requests add constraint role_booking_requests_total_check
        check ((total_cents is null or total_cents between 0 and 100000000)
               and (requested_dates is null or cardinality(requested_dates) between 1 and 31));
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
