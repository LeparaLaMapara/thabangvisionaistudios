-- Rollback for lib/migrations/090-roles-and-proof.sql.
--
-- Removes the roles tables, their data (every person_roles row, every piece
-- of evidence, every "leave your number"), the roles_v1 flag and the private
-- role-documents bucket. Files already in that bucket must be emptied first
-- (Storage refuses to drop a bucket that holds objects): delete them from the
-- Supabase dashboard, or run scripts/roles/remove-demo.sql when only demo
-- data is there.
--
-- Not in lib/migrations on purpose: rebuild-local.sh applies every .sql file
-- there in name order.

begin;

drop table if exists public.role_interest;
drop table if exists public.role_evidence;
drop trigger if exists person_roles_stamp on public.person_roles;
drop table if exists public.person_roles;
drop function if exists public.person_roles_stamp();
drop table if exists public.roles;

do $$
begin
  if to_regclass('public.feature_flags') is not null then
    delete from public.feature_flags where key = 'roles_v1';
  end if;
  if to_regclass('storage.buckets') is not null then
    begin
      delete from storage.buckets where id = 'role-documents'
        and not exists (select 1 from storage.objects where bucket_id = 'role-documents');
    exception when others then
      -- Newer Supabase refuses direct deletes on storage tables: delete the
      -- bucket from the dashboard (Storage) instead.
      raise notice 'role-documents bucket not removed (%); delete it from the dashboard', sqlerrm;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
