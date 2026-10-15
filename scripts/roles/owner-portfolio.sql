-- One person, one portfolio, one rate (owner, 2026-10-14).
--
-- Turns the owner's three studio packages into ONE approved photographer
-- profile at his rate, R1 800 per day:
--   1. creates or updates an APPROVED photographer-videographer person_role
--      for the account (price 180000 cents, unit day, area Johannesburg);
--   2. copies each package's cover and gallery images in as work evidence
--      (source 'uploaded', public), one album per package, remembering the
--      package (source_production_id) so People stops listing the package and
--      its old address redirects to the profile;
--   3. "Verified" on the profile follows the account's own ID check (nothing
--      to set here; the result line reports it);
--   4. removes any old embedding so the profile is re-embedded: at once with
--      "Rebuild embeddings" on /admin/roles/match, or by the daily job.
--
-- Needs migrations 090, 091 and 092. Idempotent: run it again and nothing is
-- duplicated (images are matched by URL). Edit the two values below.
-- Production: run ONCE after 092 is applied and the release is live.

begin;

create temporary table _owner_settings on commit drop as
select 'thabangvisionstudios@gmail.com'::text as email,
       180000::int as price_cents,
       'day'::text as unit,
       'Johannesburg'::text as area,
       'Portraits, maternity, family and events'::text as headline;

-- Package title -> album label. A package not listed keeps its own title.
create temporary table _owner_albums (title text primary key, album text, ord int) on commit drop;
insert into _owner_albums values
  ('Studio Maternity Portraits', 'Maternity', 1),
  ('Family Birthday', 'Family and events', 2),
  ('Professional Portraits', 'Portraits', 3);

do $$
declare
  s record;
  v_user uuid;
  v_pr uuid;
  v_added int := 0;
  v_packages int := 0;
  v_verified boolean;
begin
  select * into s from _owner_settings;
  select id into v_user from auth.users where lower(email) = lower(s.email);
  if v_user is null then
    raise exception 'No account with that email.';
  end if;
  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  -- 1. The approved profile (the stamp trigger allows this: no auth.uid() here).
  insert into public.person_roles (user_id, role_slug, status, evidence_level, headline, area, price_cents, pricing_unit, reviewed_at, submitted_at)
  values (v_user, 'photographer-videographer', 'approved', 'shown', s.headline, s.area, s.price_cents, s.unit, now(), now())
  on conflict (user_id, role_slug) do update
     set status = 'approved',
         headline = excluded.headline,
         area = excluded.area,
         price_cents = excluded.price_cents,
         pricing_unit = excluded.pricing_unit,
         reviewed_at = now()
  returning id into v_pr;

  -- 2. Each package's images as work, one album per package.
  insert into public.role_evidence (person_role_id, step_key, kind, media_kind, source, storage_provider, storage_ref, url, is_public, album, source_production_id, created_at)
  select v_pr, 'work', 'photo', 'image', 'uploaded',
         case when img.url like 'https://res.cloudinary.com/%' then 'cloudinary' else 'local' end,
         left(coalesce(img.public_id, img.url), 400), img.url, true,
         left(coalesce(a.album, p.title), 40), p.id,
         -- Albums keep the order above, images their order in the package.
         now() + ((coalesce(a.ord, 9) * 100 + img.ord) * interval '1 millisecond')
    from public.smart_productions p
    left join _owner_albums a on a.title = p.title
    cross join lateral (
      select p.thumbnail_url as url, p.cover_public_id as public_id, 0 as ord where p.thumbnail_url is not null
      union all
      select g ->> 'url', g ->> 'public_id', n::int
        from jsonb_array_elements(case when jsonb_typeof(p.gallery) = 'array' then p.gallery else '[]'::jsonb end) with ordinality as x(g, n)
    ) img
   where p.title in (select title from _owner_albums)
     and p.is_published and p.deleted_at is null and p.creator_id is null
     and img.url is not null and (img.url like 'https://%' or img.url like '/%') and length(img.url) <= 600
     and not exists (select 1 from public.role_evidence e where e.person_role_id = v_pr and e.url = img.url);
  get diagnostics v_added = row_count;

  select count(*) into v_packages from public.smart_productions p
   where p.title in (select title from _owner_albums) and p.is_published and p.deleted_at is null and p.creator_id is null;

  -- 4. Re-embed: drop the old vector; the next rebuild makes a new one.
  delete from public.person_role_embeddings where person_role_id = v_pr;

  select verification_status = 'verified' into v_verified from public.profiles where id = v_user;
  raise notice 'owner portfolio: profile %, % packages, % images added, verified=%', v_pr, v_packages, v_added, coalesce(v_verified, false);
end $$;

select pr.id as profile_id, pr.profile_code, pr.status, pr.price_cents, pr.pricing_unit, pr.area,
       (select count(*) from public.role_evidence e where e.person_role_id = pr.id) as work_items,
       (select string_agg(distinct e.album, ', ') from public.role_evidence e where e.person_role_id = pr.id) as albums
  from public.person_roles pr
  join auth.users u on u.id = pr.user_id
 where lower(u.email) = (select lower(email) from _owner_settings)
   and pr.role_slug = 'photographer-videographer';

commit;
