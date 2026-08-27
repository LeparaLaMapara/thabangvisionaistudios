-- 049 — Hide suspended accounts from the public creator directory
--
-- public_profiles is the anonymous-facing projection of profiles. It exposed
-- every row, including suspended accounts. Suspension already de-lists their
-- gear (daily-maintenance section 10); it should hide the profile too.
--
-- Column ORDER must match the existing view exactly or CREATE OR REPLACE fails
-- with "cannot change name of view column".
create or replace view public.public_profiles as
  select id, display_name, avatar_url, bio, skills, social_links, location,
         specializations, crew_slug, crew_bio, years_experience, crew_featured,
         hourly_rate, available_for_hire, portfolio_projects, is_verified,
         verification_status, created_at
  from public.profiles
  where is_suspended is not true;

-- Stays SECURITY DEFINER deliberately. The Supabase linter reports this as an
-- ERROR and the linter is wrong for this case: the view exists precisely to
-- expose a safe COLUMN subset to anonymous readers, and RLS is row-level, not
-- column-level. Switching to security_invoker would need a public SELECT policy
-- on profiles itself, which is the whole-table PII leak migration 036 closed.
-- The view is the column filter; the WHERE clause is now the row filter.
alter view public.public_profiles set (security_invoker = false);

comment on view public.public_profiles is
  'Public creator directory. SECURITY DEFINER by design: it is the column filter over profiles, since RLS cannot restrict columns. Excludes suspended accounts. Never add a column here without checking it is safe for anonymous readers.';

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
