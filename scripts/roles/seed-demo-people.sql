-- Demo People data for the blind, three-screen shape (migration 091).
-- DEV ONLY. Run after scripts/roles/seed-demo.sql. Refuses to run unless
-- roles_v1 is ON (it is off or absent in production).
--
-- For the 9 demo people (roles-demo-N@example.com, names ending "(demo)"):
--   - a private face photo (a SAMPLE FACE svg), revealed only on a confirmed booking;
--   - no date of birth in answers (models confirm 18+ with an ID photo now);
--   - reviewed facts (no personal details), comes with, days available;
--   - media_kind on their work.
-- Plus one demo sound recordist (Listen format, a sample tone) and an ID
-- selfie sample for Ayanda so the admin side-by-side can be seen.
-- Remove everything with scripts/roles/remove-demo.sql.

begin;

do $$
begin
  if not exists (select 1 from public.feature_flags where key = 'roles_v1' and enabled) then
    raise exception 'roles_v1 is not on: this looks like production. Demo data is for dev only.';
  end if;
end $$;

set local session_replication_role = replica;

-- A 10th demo person: a sound recordist (Listen).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('de300000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roles-demo-10@example.com', '', now(),
        '{"provider":"email","providers":["email"],"demo":true}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, display_name, location, verification_status, is_verified, available_for_hire, created_at, updated_at)
values ('de300000-0000-4000-8000-000000000010', 'Bongani S. (demo)', 'Germiston', 'verified', true, false, now(), now())
on conflict (id) do nothing;
insert into public.person_roles (id, user_id, role_slug, status, evidence_level, headline, area, price_cents, answers, reviewed_at, submitted_at, approved_at, is_demo)
values ('de300000-0000-4000-9000-000000000010', 'de300000-0000-4000-8000-000000000010', 'sound-recordist', 'approved', 'shown',
        'Clean dialogue in noisy places', 'Germiston and East Rand', 250000, '{}', now() - interval '3 days', now() - interval '4 days', now() - interval '3 days', true)
on conflict (id) do nothing;
insert into public.role_evidence (person_role_id, step_key, kind, media_kind, source, storage_provider, url, verified_at, is_demo)
select 'de300000-0000-4000-9000-000000000010', 'listen', 'video', 'audio', 'uploaded', 'local', '/roles/demo/sample-sound.wav', now() - interval '3 days', true
 where not exists (select 1 from public.role_evidence where person_role_id = 'de300000-0000-4000-9000-000000000010' and step_key = 'listen');

-- Codes for any demo row still without one.
update public.person_roles pr
   set profile_code = coalesce(r.code_prefix, 'PR') || '-' || nextval('public.person_role_code_seq')
  from public.roles r where r.slug = pr.role_slug and pr.is_demo and pr.profile_code is null;

-- Faces (private; SAMPLE FACE images).
insert into public.person_faces (user_id, storage_ref, captured_at, face_check, is_demo)
select ('de300000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '/roles/demo/face-' || n || '.svg', now() - interval '3 days',
       case when n = 8 then 'to_compare' else 'no_id_selfie' end, true
  from generate_series(1, 10) n
on conflict (user_id) do update set storage_ref = excluded.storage_ref, face_check = excluded.face_check, is_demo = true;

-- Ayanda (waiting for review) has an ID-check selfie sample, for the side-by-side.
update public.profiles set selfie_with_id_path = 'demo/roles-demo-8-id-selfie.svg'
 where id = 'de300000-0000-4000-8000-000000000008';

-- No date of birth kept in answers.
update public.person_roles set answers = '{}'::jsonb where is_demo;

-- Media kinds.
update public.role_evidence set media_kind = case when kind = 'photo' then 'image' when kind = 'video' and media_kind is null then 'video' else media_kind end
 where is_demo and kind in ('photo', 'video');

-- On time for the demo jobs (the record line "N jobs, on time N/N").
update public.role_evidence set on_time = true where is_demo and kind = 'booking';

-- Reviewed facts, comes with, days available.
update public.person_roles set
  facts = v.facts::jsonb, facts_source = 'text', available_days = v.days::text[], comes_with = v.comes::jsonb
from (values
  ('de300000-0000-4000-9000-000000000001', '{"roles":["make-up artist"],"skills":["soft glam","natural looks","matric dance make-up"],"years_experience":3,"job_kinds":["weddings","matric dances"],"areas":["Soweto","Joburg south"],"languages":["isiZulu","English"],"equipment":["own kit"],"vehicles":[],"credits":[],"certifications":[]}', '{fri,sat,sun}', '{}'),
  ('de300000-0000-4000-9000-000000000002', '{"roles":["make-up artist"],"skills":["editorial make-up","bold colour","SFX basics"],"years_experience":6,"job_kinds":["music videos","fashion shoots"],"areas":["East Rand","Joburg"],"languages":["Sesotho","English"],"equipment":["own kit","airbrush"],"vehicles":[],"credits":[{"project":"Music video shoot","role":"Key make-up","year":2025}],"certifications":[]}', '{mon,tue,wed,thu,fri,sat}', '{}'),
  ('de300000-0000-4000-9000-000000000003', '{"roles":["model"],"skills":["runway","commercial"],"years_experience":2,"job_kinds":["campaigns","music videos"],"areas":["Joburg"],"languages":["isiXhosa","English"],"equipment":[],"vehicles":[],"credits":[{"project":"Clothing campaign","role":"Model","year":2025}],"certifications":[]}', '{mon,wed,fri,sat}', '{}'),
  ('de300000-0000-4000-9000-000000000004', '{"roles":["model"],"skills":["commercial","lifestyle"],"years_experience":null,"job_kinds":["brand shoots"],"areas":["Pretoria"],"languages":["Setswana","English"],"equipment":[],"vehicles":[],"credits":[],"certifications":[]}', '{sat,sun}', '{}'),
  ('de300000-0000-4000-9000-000000000005', '{"roles":["driver"],"skills":["crew transport","waiting on set","long distance"],"years_experience":9,"job_kinds":["film crews","wedding guests"],"areas":["Pretoria","Joburg"],"languages":["Sepedi","English","Afrikaans"],"equipment":[],"vehicles":["Toyota Quantum, 14 seats"],"credits":[],"certifications":["PrDP (P)"]}', '{mon,tue,wed,thu,fri,sat,sun}', '{"label":"Toyota Quantum, 14 seats"}'),
  ('de300000-0000-4000-9000-000000000006', '{"roles":["driver"],"skills":["gear runs","careful loading"],"years_experience":4,"job_kinds":["gear transport"],"areas":["Midrand"],"languages":["isiZulu","English"],"equipment":[],"vehicles":["VW Polo hatchback"],"credits":[],"certifications":[]}', '{mon,tue,wed,thu,fri}', '{"label":"VW Polo, boot fits 4 gear cases"}'),
  ('de300000-0000-4000-9000-000000000007', '{"roles":["photographer","videographer"],"skills":["portraits","events","product"],"years_experience":10,"job_kinds":["weddings","corporate events","product shoots"],"areas":["Joburg north","Pretoria"],"languages":["English","isiZulu"],"equipment":["two camera bodies","three lenses","lights"],"vehicles":[],"credits":[{"project":"Corporate year-end event","role":"Photographer","year":2025}],"certifications":[]}', '{mon,tue,wed,thu,fri,sat}', '{"label":"Own camera kit: two bodies, three lenses, lights"}'),
  ('de300000-0000-4000-9000-000000000008', '{"roles":["photographer"],"skills":["street","events"],"years_experience":2,"job_kinds":["parties","events"],"areas":["Alexandra"],"languages":["isiZulu","English"],"equipment":["second-hand camera"],"vehicles":[],"credits":[],"certifications":[]}', '{fri,sat,sun}', '{}'),
  ('de300000-0000-4000-9000-000000000009', '{"roles":["make-up artist"],"skills":["bridal make-up"],"years_experience":1,"job_kinds":["weddings"],"areas":["Mamelodi"],"languages":["Sepedi","English"],"equipment":["own kit"],"vehicles":[],"credits":[],"certifications":[]}', '{sat,sun}', '{}'),
  ('de300000-0000-4000-9000-000000000010', '{"roles":["sound recordist"],"skills":["boom","lapel mics","dialogue cleanup"],"years_experience":5,"job_kinds":["short films","interviews"],"areas":["Germiston","East Rand"],"languages":["isiZulu","English"],"equipment":["boom kit","two lapel mics","recorder"],"vehicles":[],"credits":[{"project":"Short film","role":"Sound recordist","year":2024}],"certifications":[]}', '{mon,tue,wed,thu,fri}', '{}')
) as v(id, facts, days, comes)
where person_roles.id = v.id::uuid;

-- Comes with: the vehicle and kit photos.
update public.person_roles pr set comes_with = jsonb_set(pr.comes_with, '{evidence_ids}',
  (select coalesce(jsonb_agg(e.id), '[]'::jsonb) from public.role_evidence e
    where e.person_role_id = pr.id and e.kind = 'photo' and e.step_key in ('outside', 'inside', 'kit')))
 where pr.is_demo and pr.comes_with ? 'label';

-- A reveal demo that stays: a demo client booked the demo driver (DV),
-- confirmed (the DEV stand-in for "booked and paid, payment held"). Open
-- /people/requests/de300000-0000-4000-a000-000000000001 as an admin to see
-- what the client sees after confirmation (face and first name revealed).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('de300000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roles-demo-11@example.com', '', now(),
        '{"provider":"email","providers":["email"],"demo":true}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, display_name, first_name, location, created_at, updated_at)
values ('de300000-0000-4000-8000-000000000011', 'Kgomotso C. (demo client)', 'Kgomotso', 'Soweto', now(), now())
on conflict (id) do nothing;
update public.profiles set first_name = 'Sipho' where id = 'de300000-0000-4000-8000-000000000005';
insert into public.role_booking_requests (id, person_role_id, client_id, requested_date, arrival_time, duration_hours, area, address, note, status, confirmed_at, is_demo)
values ('de300000-0000-4000-a000-000000000001', 'de300000-0000-4000-9000-000000000005', 'de300000-0000-4000-8000-000000000011',
        current_date + 14, '07:30', 8, 'Soweto', '14 Demo Street, Orlando West (demo address)', 'Crew of six and their gear (demo)', 'confirmed', now(), true)
on conflict (id) do update set status = 'confirmed', requested_date = excluded.requested_date, confirmed_at = now();

commit;

notify pgrst, 'reload schema';

select pr.profile_code, pr.role_slug, pr.status, pr.comes_with ->> 'label' as comes_with, f.storage_ref as face
  from public.person_roles pr left join public.person_faces f on f.user_id = pr.user_id
 where pr.is_demo order by pr.profile_code;
