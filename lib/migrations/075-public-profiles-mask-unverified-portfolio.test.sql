-- Tests for 075. Run after applying 075 on a database with profiles.
-- Everything is rolled back.
begin;

do $$
declare
  v uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  got jsonb;
begin
  insert into auth.users (id) values (v), (u) on conflict do nothing;
  insert into public.profiles (id, verification_status, portfolio_projects)
    values (v, 'verified', '[{"title":"shown"}]'::jsonb), (u, 'pending', '[{"title":"hidden"}]'::jsonb)
    on conflict (id) do update set verification_status = excluded.verification_status, portfolio_projects = excluded.portfolio_projects;

  select portfolio_projects into got from public.public_profiles where id = v;
  if got is null then raise exception 'FAIL: verified portfolio hidden'; end if;
  raise notice 'PASS: a verified creator''s portfolio is shown';

  select portfolio_projects into got from public.public_profiles where id = u;
  if got is not null then raise exception 'FAIL: unverified portfolio exposed'; end if;
  raise notice 'PASS: an unverified creator''s portfolio is not shown';

  if not exists (select 1 from public.public_profiles where id = u) then
    raise exception 'FAIL: unverified profile row disappeared (only the portfolio should be hidden)';
  end if;
  raise notice 'PASS: the rest of the profile row is unchanged';
end $$;

rollback;
