-- LOCAL REPLICA ONLY: production's signup trigger as recorded in
-- docs/security/phase-0-db-evidence.md (inserts only (id)). The repo's
-- migrations still define the older (id, email) body, which fails after 048.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;
