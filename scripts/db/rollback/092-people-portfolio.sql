-- Rollback for lib/migrations/092-people-portfolio.sql. Albums, the person's
-- own rate unit and multi-day request totals are lost; profiles fall back to
-- the role's unit. Not in lib/migrations on purpose.

begin;

drop index if exists public.idx_role_evidence_source_production;
alter table public.role_evidence drop column if exists album, drop column if exists source_production_id;
alter table public.person_roles drop column if exists pricing_unit;
do $$
begin
  if to_regclass('public.role_booking_requests') is not null then
    alter table public.role_booking_requests
      drop column if exists requested_dates, drop column if exists unit, drop column if exists total_cents;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
