-- 075 — Hide portfolios of creators whose ID check has not passed
--
-- Phase 3 lets creators build their portfolio before verification (so the
-- work is ready the moment the ID check passes). public_profiles is readable
-- by anyone with the public key and exposed portfolio_projects for every
-- non-suspended profile, so an unverified creator's photos were public through
-- the view (and /creators/[id]) although the product promises nobody sees them
-- until the check passes. The view now returns NULL for portfolio_projects
-- unless verification_status = 'verified'.
--
-- Same column names, order and types as migration 049 (CREATE OR REPLACE VIEW
-- requires it). Stays SECURITY DEFINER, as explained in 049.
--
-- Idempotent. Rollback: re-run the CREATE OR REPLACE VIEW from migration 049.
-- Apply on dev, run 075-public-profiles-mask-unverified-portfolio.test.sql, then production.

begin;

create or replace view public.public_profiles as
  select id, display_name, avatar_url, bio, skills, social_links, location,
         specializations, crew_slug, crew_bio, years_experience, crew_featured,
         hourly_rate, available_for_hire,
         case when verification_status = 'verified' then portfolio_projects end as portfolio_projects,
         is_verified, verification_status, created_at
  from public.profiles
  where is_suspended is not true;

alter view public.public_profiles set (security_invoker = false);

comment on view public.public_profiles is
  'Public creator directory. SECURITY DEFINER by design: it is the column filter over profiles, since RLS cannot restrict columns. Excludes suspended accounts; portfolio_projects only for verified creators (075). Never add a column here without checking it is safe for anonymous readers.';

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

commit;
