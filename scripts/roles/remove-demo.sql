-- Removes every demo role profile made by scripts/roles/seed-demo.sql.
-- DEV ONLY. Touches only rows marked as demo:
--   person_roles.is_demo (their role_evidence goes with them, on delete cascade),
--   role_evidence.is_demo (anything left over),
--   the demo accounts roles-demo-N@example.com and their profiles.
-- The sample images in public/roles/demo/ stay in the repo (they are files,
-- not data); delete that folder in a commit when demos are no longer needed.

begin;

delete from public.role_evidence where is_demo;
delete from public.person_roles where is_demo;
delete from public.profiles where id in (select id from auth.users where email like 'roles-demo-%@example.com');
delete from auth.users where email like 'roles-demo-%@example.com';

commit;

notify pgrst, 'reload schema';

select
  (select count(*) from public.person_roles where is_demo) as demo_profiles_left,
  (select count(*) from auth.users where email like 'roles-demo-%@example.com') as demo_accounts_left;
