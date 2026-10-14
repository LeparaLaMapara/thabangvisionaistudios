-- Backfill: existing creator accounts get a prefilled DRAFT role profile.
-- TASK-085. Needs migration 090. Idempotent: run it as often as you like.
--
-- Nobody redoes anything:
--   - An account with creator data (onboarding finished, portfolio photos,
--     marked available for hire, or a crew page) gets a DRAFT person_roles row
--     for the photographer or videographer role (the old creator flow was photo
--     and video), prefilled from the profile: area, a headline from the
--     specialisations, the bio, and the hourly rate (kept inside the role's
--     price band). Their name and photo stay on the profile, where every role
--     profile reads them.
--   - Their portfolio photos become evidence for "Your best work", marked
--     source = 'uploaded' (they were not taken in the app), at most 6.
--   - It is NEVER approved here: a person on the team still reviews it, and the
--     person still finishes the in-app steps.
--   - Renters and clients (saved intent rent, hire, browse) are not touched.
--   - Accounts with only free-text skills get no draft: the Offer step matches
--     their skills and SUGGESTS a role; it never assigns one.
--   - Gear owners are not touched: gear is a listing, not a role.
--
-- Production (2026-10-14): 39 accounts, 0 finished creator onboarding, 1 with
-- portfolio photos, so about 1 to 3 people would get a draft. NOT run there;
-- the owner decides, after 090 is applied to production.
--
-- Run the first SELECT alone for a dry run (who would be touched).

-- Dry run: who would get a draft, and how many photos would come with them.
select p.id,
       coalesce(p.display_name, '(no name)') as name,
       p.onboarding_completed_at is not null as onboarded,
       coalesce(jsonb_array_length(case when jsonb_typeof(p.portfolio_projects) = 'array' then p.portfolio_projects end), 0) as projects,
       exists (select 1 from public.person_roles pr where pr.user_id = p.id and pr.role_slug = 'photographer-videographer') as already_has_draft
  from public.profiles p
  join auth.users u on u.id = p.id
 where u.email not like 'roles-demo-%@example.com'
   and coalesce(p.role, '') <> 'admin'
   and (p.onboarding_completed_at is not null
        or (jsonb_typeof(p.portfolio_projects) = 'array' and jsonb_array_length(p.portfolio_projects) > 0)
        or p.available_for_hire is true
        or p.crew_slug is not null);

begin;

-- 1. Drafts.
with role as (
  select suggested_price_cents from public.roles where slug = 'photographer-videographer'
), creators as (
  select p.*
    from public.profiles p
    join auth.users u on u.id = p.id
   where u.email not like 'roles-demo-%@example.com'
     and coalesce(p.role, '') <> 'admin'
     and (p.onboarding_completed_at is not null
          or (jsonb_typeof(p.portfolio_projects) = 'array' and jsonb_array_length(p.portfolio_projects) > 0)
          or p.available_for_hire is true
          or p.crew_slug is not null)
), inserted as (
  insert into public.person_roles (user_id, role_slug, status, headline, about, area, price_cents)
  select c.id,
         'photographer-videographer',
         'draft',
         nullif(left(array_to_string(c.specializations[1:3], ', '), 80), ''),
         nullif(left(coalesce(c.crew_bio, c.bio, ''), 600), ''),
         nullif(left(coalesce(c.location, c.city, ''), 80), ''),
         least(greatest(coalesce(c.hourly_rate * 100, (r.suggested_price_cents ->> 'typical')::int),
                        (r.suggested_price_cents ->> 'low')::int),
               (r.suggested_price_cents ->> 'high')::int)
    from creators c cross join role r
  on conflict (user_id, role_slug) do nothing
  returning id
)
select count(*) as drafts_created from inserted;

-- 2. Old portfolio photos as evidence (uploaded), at most 6 per draft, no duplicates.
with photos as (
  select pr.id as person_role_id,
         ph ->> 'url' as url,
         coalesce(ph ->> 'public_id', ph ->> 'url') as ref,
         row_number() over (partition by pr.id order by proj.ord, ph_ord) as n
    from public.person_roles pr
    join public.profiles p on p.id = pr.user_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.portfolio_projects) = 'array' then p.portfolio_projects else '[]'::jsonb end)
         with ordinality as proj(project, ord)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(proj.project -> 'photos') = 'array' then proj.project -> 'photos' else '[]'::jsonb end)
         with ordinality as phs(ph, ph_ord)
   where pr.role_slug = 'photographer-videographer'
     and pr.status in ('draft', 'changes_requested')
     and not pr.is_demo
     and (ph ->> 'url') like 'https://%'
     and length(ph ->> 'url') <= 600
), inserted as (
  insert into public.role_evidence (person_role_id, step_key, kind, source, storage_provider, storage_ref, url, note)
  select f.person_role_id, 'best_work', 'photo', 'uploaded', 'cloudinary', left(f.ref, 400), f.url, 'backfill: old creator portfolio'
    from (select distinct on (person_role_id, url) * from photos order by person_role_id, url, n) f
   where f.n <= 6
     and not exists (select 1 from public.role_evidence e where e.person_role_id = f.person_role_id and e.url = f.url)
  returning 1
)
select count(*) as photos_added from inserted;

commit;

select count(*) filter (where status = 'draft' and not is_demo) as real_drafts,
       count(*) filter (where status = 'approved' and not is_demo) as real_approved
  from public.person_roles;
