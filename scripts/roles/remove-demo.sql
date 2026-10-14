-- Removes every demo role profile made by scripts/roles/seed-demo.sql.
-- DEV ONLY. Touches only rows marked as demo:
--   person_roles.is_demo (their role_evidence goes with them, on delete cascade),
--   role_evidence.is_demo (anything left over),
--   the demo accounts roles-demo-N@example.com and their profiles,
--   their faces and demo booking requests (091; scripts/roles/seed-demo-people.sql).
-- The sample ID selfie in the private verifications bucket
-- (demo/roles-demo-8-id-selfie.svg) stays; delete it from the dashboard.
-- The sample images in public/roles/demo/ stay in the repo (they are files,
-- not data); delete that folder in a commit when demos are no longer needed.

begin;

do $$
begin
  -- 091 objects, when present.
  if to_regclass('public.role_booking_requests') is not null then
    delete from public.role_booking_requests where is_demo or person_role_id in (select id from public.person_roles where is_demo);
  end if;
  if to_regclass('public.person_faces') is not null then
    delete from public.person_faces where is_demo;
  end if;
end $$;
delete from public.role_evidence where is_demo;
delete from public.person_roles where is_demo;
delete from public.profiles where id in (select id from auth.users where email like 'roles-demo-%@example.com');
delete from auth.users where email like 'roles-demo-%@example.com';

commit;

notify pgrst, 'reload schema';

select
  (select count(*) from public.person_roles where is_demo) as demo_profiles_left,
  (select count(*) from auth.users where email like 'roles-demo-%@example.com') as demo_accounts_left;
