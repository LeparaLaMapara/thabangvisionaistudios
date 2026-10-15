-- DEV ONLY: copies of production's three owner packages, so
-- scripts/roles/owner-portfolio.sql can be proved on dev. Production already
-- has the real rows ("Studio Maternity Portraits" R1 500, "Family Birthday"
-- R1 500, "Professional Portraits" R1 800, creator_id null, published).
-- The images are dev Cloudinary files and SAMPLE svgs, not the owner's photos.
-- Refuses to run unless roles_v1 is on and the dev QA package exists.

begin;

do $$
begin
  if not exists (select 1 from public.smart_productions where slug = 'qa-production') then
    raise exception 'Not the dev database (no qa-production package). Stop.';
  end if;
end $$;

insert into public.smart_productions (id, slug, title, project_type, sub_category, description, thumbnail_url, gallery, is_published, price, currency, price_unit, creator_id, created_at, updated_at)
values
  ('de300000-0000-4000-b000-000000000001', 'dev-studio-maternity-portraits', 'Studio Maternity Portraits', 'photography', 'portrait', 'Dev copy of the owner package.',
   'https://res.cloudinary.com/dzymetqjr/image/upload/v1791789832/thabangvision_usecase/media/smartproductions/vlolceh1ab5wq2qwqjgo.jpg',
   '[{"url":"/roles/demo/photo-1.svg","public_id":"demo/photo-1"},{"url":"/roles/demo/photo-live.svg","public_id":"demo/photo-live"}]'::jsonb,
   true, 1500, 'ZAR', 'project', null, now(), now()),
  ('de300000-0000-4000-b000-000000000002', 'dev-family-birthday', 'Family Birthday', 'photography', 'lifestyle', 'Dev copy of the owner package.',
   'https://res.cloudinary.com/dzymetqjr/image/upload/v1791789835/thabangvision_usecase/media/smartproductions/rt2ix6r5fvzlldczartd.jpg',
   '[{"url":"/roles/demo/photo-2.svg","public_id":"demo/photo-2"},{"url":"/roles/demo/look-after.svg","public_id":"demo/look-after"}]'::jsonb,
   true, 1500, 'ZAR', 'project', null, now(), now()),
  ('de300000-0000-4000-b000-000000000003', 'dev-professional-portraits', 'Professional Portraits', 'photography', 'portrait', 'Dev copy of the owner package.',
   '/roles/demo/photo-3.svg',
   '[{"url":"/roles/demo/model-front.svg","public_id":"demo/model-front"},{"url":"/roles/demo/model-side.svg","public_id":"demo/model-side"}]'::jsonb,
   true, 1800, 'ZAR', 'project', null, now(), now())
on conflict (id) do nothing;

commit;
