-- Demo role profiles for the owner to look at. DEV ONLY (thabangvision-dev).
-- NEVER run on production.
--
-- 9 clearly synthetic people across the 4 live roles at different levels:
-- every display name ends "(demo)", every email is roles-demo-N@example.com,
-- every person_roles / role_evidence row has is_demo = true, and every image
-- is a local SVG that says SAMPLE (public/roles/demo/).
--
-- Guard: refuses to run unless the roles_v1 flag is ON. It is off or absent
-- in production, so this script stops there.
--
-- Triggers are switched off for this transaction only
-- (session_replication_role = replica): no signup webhook, no welcome
-- message, no profile trigger. The demo accounts have no password and cannot
-- sign in.
--
-- Remove everything with scripts/roles/remove-demo.sql. Safe to run again
-- (it removes the old demo rows first).

begin;

do $$
begin
  if not exists (select 1 from public.feature_flags where key = 'roles_v1' and enabled) then
    raise exception 'roles_v1 is not on: this looks like production. Demo data is for dev only.';
  end if;
end $$;

-- Start clean.
delete from public.person_roles where is_demo;
delete from public.profiles where id in (select id from auth.users where email like 'roles-demo-%@example.com');
delete from auth.users where email like 'roles-demo-%@example.com';

set local session_replication_role = replica;

-- People ----------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('de300000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'roles-demo-' || n || '@example.com', '', now(),
       '{"provider":"email","providers":["email"],"demo":true}'::jsonb, '{}'::jsonb, now(), now()
  from generate_series(1, 9) n;

insert into public.profiles (id, display_name, location, verification_status, is_verified, available_for_hire, created_at, updated_at)
values
  ('de300000-0000-4000-8000-000000000001', 'Naledi M. (demo)',  'Soweto',      'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000002', 'Zanele K. (demo)',  'Tembisa',     'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000003', 'Thabo N. (demo)',   'Braamfontein','verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000004', 'Lerato S. (demo)',  'Pretoria',    'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000005', 'Sipho D. (demo)',   'Soshanguve',  'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000006', 'Mpho R. (demo)',    'Midrand',     'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000007', 'Kagiso P. (demo)',  'Fourways',    'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000008', 'Ayanda B. (demo)',  'Alexandra',   'verified', true, false, now(), now()),
  ('de300000-0000-4000-8000-000000000009', 'Precious T. (demo)','Mamelodi',    'verified', true, false, now(), now());

-- Role profiles ----------------------------------------------------------------
insert into public.person_roles (id, user_id, role_slug, status, evidence_level, headline, about, area, price_cents, per_km_cents, answers, reviewer_note, reviewed_at, legal_verified_at, submitted_at, approved_at, is_demo)
values
  -- 1. Brand-new make-up artist, only in-app proof. No jobs yet.
  ('de300000-0000-4000-9000-000000000001', 'de300000-0000-4000-8000-000000000001', 'makeup-artist', 'approved', 'shown',
   'Soft glam and natural looks', 'I learnt from my aunt and do make-up for matric dances and weddings in Soweto. No course, just practice.',
   'Soweto and Joburg south', 55000, null, '{}', null, now() - interval '2 days', null, now() - interval '3 days', now() - interval '2 days', true),
  -- 2. Proven make-up artist: 4 confirmed jobs.
  ('de300000-0000-4000-9000-000000000002', 'de300000-0000-4000-8000-000000000002', 'makeup-artist', 'approved', 'proven',
   'Editorial and music video make-up', 'Bold colour, clean skin, fast on set.', 'East Rand', 85000, null, '{}', null, now() - interval '40 days', null, now() - interval '41 days', now() - interval '40 days', true),
  -- 3. Vouched model: a photographer confirmed him. No ThabangVision jobs yet.
  ('de300000-0000-4000-9000-000000000003', 'de300000-0000-4000-8000-000000000003', 'model', 'approved', 'vouched',
   'Fashion and commercial', 'Tall, easy to direct, on time.', 'Joburg', 50000, null, '{"date_of_birth":"2000-04-12"}', null, now() - interval '10 days', now() - interval '10 days', now() - interval '11 days', now() - interval '10 days', true),
  -- 4. New model, digitals done in the app.
  ('de300000-0000-4000-9000-000000000004', 'de300000-0000-4000-8000-000000000004', 'model', 'approved', 'shown',
   'Natural, friendly, first year modelling', null, 'Pretoria', 35000, null, '{"date_of_birth":"2004-09-30"}', null, now() - interval '1 day', now() - interval '1 day', now() - interval '2 days', now() - interval '1 day', true),
  -- 5. Proven driver with a van: carries crew, PrDP, 5 confirmed jobs.
  ('de300000-0000-4000-9000-000000000005', 'de300000-0000-4000-8000-000000000005', 'driver-with-vehicle', 'approved', 'proven',
   '14-seater van for crew and gear', 'Toyota Quantum, clean, aircon. I wait on set and drive everyone home.', 'Pretoria and Joburg', 220000, 700,
   '{"carries_passengers":true,"seats":"14"}', null, now() - interval '30 days', now() - interval '30 days', now() - interval '31 days', now() - interval '30 days', true),
  -- 6. Driver with a hatchback, gear only (no PrDP needed).
  ('de300000-0000-4000-9000-000000000006', 'de300000-0000-4000-8000-000000000006', 'driver-with-vehicle', 'approved', 'shown',
   'Gear runs, fast and careful', 'I move cases and lights between the studio and the set. I do not carry passengers.', 'Midrand', 140000, 550,
   '{"carries_passengers":false}', null, now() - interval '5 days', now() - interval '5 days', now() - interval '6 days', now() - interval '5 days', true),
  -- 7. Trusted photographer: 12 confirmed jobs.
  ('de300000-0000-4000-9000-000000000007', 'de300000-0000-4000-8000-000000000007', 'photographer-videographer', 'approved', 'trusted',
   'Portraits, events and products', 'Ten years behind the camera. Calm on busy days.', 'Joburg north', 180000, null, '{}', null, now() - interval '200 days', null, now() - interval '201 days', now() - interval '200 days', true),
  -- 8. Waiting for review: shows up in /admin/roles.
  ('de300000-0000-4000-9000-000000000008', 'de300000-0000-4000-8000-000000000008', 'photographer-videographer', 'submitted', 'new',
   'Street and event photos', 'Self-taught on my phone, now on a second-hand camera.', 'Alexandra', 80000, null, '{}', null, null, null, now() - interval '3 hours', null, true),
  -- 9. Sent back with a "how to get there" note.
  ('de300000-0000-4000-9000-000000000009', 'de300000-0000-4000-8000-000000000009', 'makeup-artist', 'changes_requested', 'new',
   'Bridal make-up', null, 'Mamelodi', 60000, null, '{}',
   'Your angles look good. The before and after are in different rooms, so we cannot compare them. Retake both by the same window, same angle, then send again.',
   now() - interval '1 day', null, now() - interval '2 days', null, true);

-- Evidence -------------------------------------------------------------------
-- Work photos (public once approved), captured in the app.
insert into public.role_evidence (person_role_id, step_key, kind, source, storage_provider, url, pair_group, pair_side, captured_at, verified_at, is_demo)
values
  -- 1 Naledi
  ('de300000-0000-4000-9000-000000000001', 'before_after', 'photo', 'captured_in_app', 'local', '/roles/demo/look-after.svg',  'p-demo1', 'after',  now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'before_after', 'photo', 'captured_in_app', 'local', '/roles/demo/look-before.svg', 'p-demo1', 'before', now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-1.svg', null, null, now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-2.svg', null, null, now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-3.svg', null, null, now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'close_up', 'photo', 'captured_in_app', 'local', '/roles/demo/eyes.svg',   null, null, now() - interval '3 days', now() - interval '2 days', true),
  ('de300000-0000-4000-9000-000000000001', 'kit',      'photo', 'captured_in_app', 'local', '/roles/demo/kit.svg',    null, null, now() - interval '3 days', now() - interval '2 days', true),
  -- 2 Zanele
  ('de300000-0000-4000-9000-000000000002', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-3.svg', null, null, now() - interval '41 days', now() - interval '40 days', true),
  ('de300000-0000-4000-9000-000000000002', 'before_after', 'photo', 'captured_in_app', 'local', '/roles/demo/look-before.svg', 'p-demo2', 'before', now() - interval '41 days', now() - interval '40 days', true),
  ('de300000-0000-4000-9000-000000000002', 'before_after', 'photo', 'captured_in_app', 'local', '/roles/demo/look-after.svg',  'p-demo2', 'after',  now() - interval '41 days', now() - interval '40 days', true),
  ('de300000-0000-4000-9000-000000000002', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-1.svg', null, null, now() - interval '41 days', now() - interval '40 days', true),
  ('de300000-0000-4000-9000-000000000002', 'close_up', 'photo', 'captured_in_app', 'local', '/roles/demo/eyes.svg',   null, null, now() - interval '41 days', now() - interval '40 days', true),
  -- 3 Thabo
  ('de300000-0000-4000-9000-000000000003', 'best_work','photo', 'uploaded',        'local', '/roles/demo/model-shoot.svg', null, null, null, null, true),
  ('de300000-0000-4000-9000-000000000003', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-front.svg', null, null, now() - interval '11 days', now() - interval '10 days', true),
  ('de300000-0000-4000-9000-000000000003', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-side.svg',  null, null, now() - interval '11 days', now() - interval '10 days', true),
  ('de300000-0000-4000-9000-000000000003', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-full.svg',  null, null, now() - interval '11 days', now() - interval '10 days', true),
  -- 4 Lerato
  ('de300000-0000-4000-9000-000000000004', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-front.svg', null, null, now() - interval '2 days', now() - interval '1 day', true),
  ('de300000-0000-4000-9000-000000000004', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-side.svg',  null, null, now() - interval '2 days', now() - interval '1 day', true),
  ('de300000-0000-4000-9000-000000000004', 'digitals', 'photo', 'captured_in_app', 'local', '/roles/demo/model-full.svg',  null, null, now() - interval '2 days', now() - interval '1 day', true),
  -- 5 Sipho
  ('de300000-0000-4000-9000-000000000005', 'outside',  'photo', 'captured_in_app', 'local', '/roles/demo/van-front.svg',  null, null, now() - interval '31 days', now() - interval '30 days', true),
  ('de300000-0000-4000-9000-000000000005', 'outside',  'photo', 'captured_in_app', 'local', '/roles/demo/van-side.svg',   null, null, now() - interval '31 days', now() - interval '30 days', true),
  ('de300000-0000-4000-9000-000000000005', 'inside',   'photo', 'captured_in_app', 'local', '/roles/demo/van-inside.svg', null, null, now() - interval '31 days', now() - interval '30 days', true),
  -- 6 Mpho
  ('de300000-0000-4000-9000-000000000006', 'outside',  'photo', 'captured_in_app', 'local', '/roles/demo/car-front.svg', null, null, now() - interval '6 days', now() - interval '5 days', true),
  ('de300000-0000-4000-9000-000000000006', 'inside',   'photo', 'captured_in_app', 'local', '/roles/demo/car-boot.svg',  null, null, now() - interval '6 days', now() - interval '5 days', true),
  ('de300000-0000-4000-9000-000000000006', 'outside',  'photo', 'captured_in_app', 'local', '/roles/demo/car-front.svg', null, null, now() - interval '6 days', now() - interval '5 days', true),
  -- 7 Kagiso
  ('de300000-0000-4000-9000-000000000007', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-1.svg', null, null, null, now() - interval '200 days', true),
  ('de300000-0000-4000-9000-000000000007', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-2.svg', null, null, null, now() - interval '200 days', true),
  ('de300000-0000-4000-9000-000000000007', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-3.svg', null, null, null, now() - interval '200 days', true),
  ('de300000-0000-4000-9000-000000000007', 'live_shot','photo', 'captured_in_app', 'local', '/roles/demo/photo-live.svg', null, null, now() - interval '201 days', now() - interval '200 days', true),
  ('de300000-0000-4000-9000-000000000007', 'kit',      'photo', 'captured_in_app', 'local', '/roles/demo/camera-kit.svg', null, null, now() - interval '201 days', now() - interval '200 days', true),
  -- 8 Ayanda (submitted, not checked yet)
  ('de300000-0000-4000-9000-000000000008', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-2.svg', null, null, null, null, true),
  ('de300000-0000-4000-9000-000000000008', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-3.svg', null, null, null, null, true),
  ('de300000-0000-4000-9000-000000000008', 'best_work','photo', 'uploaded',        'local', '/roles/demo/photo-1.svg', null, null, null, null, true),
  ('de300000-0000-4000-9000-000000000008', 'live_shot','photo', 'captured_in_app', 'local', '/roles/demo/photo-live.svg', null, null, now() - interval '4 hours', null, true),
  ('de300000-0000-4000-9000-000000000008', 'kit',      'photo', 'captured_in_app', 'local', '/roles/demo/camera-kit.svg', null, null, now() - interval '4 hours', null, true),
  -- 9 Precious (sent back)
  ('de300000-0000-4000-9000-000000000009', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-1.svg', null, null, now() - interval '2 days', null, true),
  ('de300000-0000-4000-9000-000000000009', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-2.svg', null, null, now() - interval '2 days', null, true),
  ('de300000-0000-4000-9000-000000000009', 'angles',   'photo', 'captured_in_app', 'local', '/roles/demo/look-3.svg', null, null, now() - interval '2 days', null, true);

-- Legal documents for the drivers: private, checked. No real files (demo).
insert into public.role_evidence (person_role_id, step_key, kind, source, legal_code, is_public, note, verified_at, is_demo)
select pr, code, 'document', 'uploaded', code, false, 'demo: no real document', now() - interval '5 days', true
  from (values
    ('de300000-0000-4000-9000-000000000005'::uuid, 'drivers_licence'), ('de300000-0000-4000-9000-000000000005'::uuid, 'prdp'),
    ('de300000-0000-4000-9000-000000000005'::uuid, 'licence_disc'), ('de300000-0000-4000-9000-000000000005'::uuid, 'roadworthy'),
    ('de300000-0000-4000-9000-000000000005'::uuid, 'commercial_insurance'),
    ('de300000-0000-4000-9000-000000000006'::uuid, 'drivers_licence'), ('de300000-0000-4000-9000-000000000006'::uuid, 'licence_disc'),
    ('de300000-0000-4000-9000-000000000006'::uuid, 'commercial_insurance')
  ) as d(pr, code);

-- Vouches (checked by a person).
insert into public.role_evidence (person_role_id, kind, source, is_public, note, verified_at, is_demo)
values
  ('de300000-0000-4000-9000-000000000003', 'vouch', 'vouched', false, 'demo: photographer who shot his first campaign, 07X XXX XXXX', now() - interval '10 days', true),
  ('de300000-0000-4000-9000-000000000002', 'vouch', 'vouched', false, 'demo: music video director, 07X XXX XXXX', now() - interval '40 days', true);

-- Confirmed ThabangVision jobs (synthetic; no real booking rows are made).
insert into public.role_evidence (person_role_id, kind, source, is_public, note, verified_at, is_demo)
select pr, 'booking', 'booking', true, 'demo job', now() - (g || ' days')::interval, true
  from (values
    ('de300000-0000-4000-9000-000000000002'::uuid, 4),
    ('de300000-0000-4000-9000-000000000005'::uuid, 5),
    ('de300000-0000-4000-9000-000000000007'::uuid, 12)
  ) as j(pr, n), generate_series(1, n) g;

commit;

notify pgrst, 'reload schema';

select p.display_name, pr.role_slug, pr.status, pr.evidence_level,
       (select count(*) from public.role_evidence e where e.person_role_id = pr.id and e.kind = 'booking' and e.verified_at is not null) as jobs
  from public.person_roles pr join public.profiles p on p.id = pr.user_id
 where pr.is_demo order by pr.id;
