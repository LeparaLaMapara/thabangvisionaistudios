-- 091 test: people complete. One transaction, rolled back. Raises on the
-- first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/091-people-complete.test.sql

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000910a1', 't091-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000910b1', 't091-b@example.invalid');
insert into public.profiles (id) values
  ('00000000-0000-4000-8000-0000000910a1'), ('00000000-0000-4000-8000-0000000910b1')
on conflict (id) do nothing;

do $$
begin
  -- 1. Equal chance: browsers cannot read who a profile belongs to.
  if has_column_privilege('anon', 'public.person_roles', 'user_id', 'select')
     or has_column_privilege('authenticated', 'public.person_roles', 'user_id', 'select')
     or has_column_privilege('anon', 'public.person_roles', 'answers', 'select')
     or has_column_privilege('authenticated', 'public.person_roles', 'reviewer_note', 'select') then
    raise exception 'FAIL 1: a browser can read user_id, answers or the reviewer note';
  end if;
  if not has_column_privilege('anon', 'public.person_roles', 'profile_code', 'select') then
    raise exception 'FAIL 1: anon cannot read the neutral profile code';
  end if;
  raise notice 'PASS 1: identity columns are not readable by browsers';

  -- 2. Faces, requests, embeddings and team signals are never readable by anon,
  --    and only faces (own row, RLS) by signed-in people.
  if has_table_privilege('anon', 'public.person_faces', 'select')
     or has_table_privilege('anon', 'public.role_booking_requests', 'select')
     or has_table_privilege('authenticated', 'public.role_booking_requests', 'select')
     or has_table_privilege('authenticated', 'public.person_role_embeddings', 'select')
     or has_table_privilege('authenticated', 'public.team_signals', 'select')
     or has_function_privilege('anon', 'public.match_person_roles(extensions.vector, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.match_person_roles(extensions.vector, text, integer)', 'execute') then
    raise exception 'FAIL 2: a browser can read faces, requests, embeddings or team signals, or run the matcher';
  end if;
  raise notice 'PASS 2: private tables stay server-only';

  -- 3. Every live role has a proof format and a code prefix.
  if exists (select 1 from public.roles where status = 'live' and (proof_format is null or code_prefix is null)) then
    raise exception 'FAIL 3: a live role misses proof_format or code_prefix';
  end if;
  if (select proof_format from public.roles where slug = 'driver-with-vehicle') <> 'trust'
     or (select proof_format from public.roles where slug = 'sound-recordist') <> 'listen' then
    raise exception 'FAIL 3: proof formats are wrong';
  end if;
  raise notice 'PASS 3: proof formats and code prefixes';
end $$;

-- 4. As person A: a new draft gets a neutral code; evidence can still be added
--    (the insert policy reads user_id without a column grant).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000910a1', 'role', 'authenticated')::text, true);

insert into public.person_roles (user_id, role_slug, headline, price_cents)
values ('00000000-0000-4000-8000-0000000910a1', 'model', 't091 model', 45000);

insert into public.role_evidence (person_role_id, step_key, kind, source, media_kind, url)
select id, 'digitals', 'photo', 'captured_in_app', 'image', 'https://res.cloudinary.com/demo/image/upload/x.jpg'
  from public.person_roles where headline = 't091 model';

do $$
begin
  if (select profile_code from public.person_roles where headline = 't091 model') !~ '^MO-[0-9]+$' then
    raise exception 'FAIL 4: the draft has no neutral MO- code';
  end if;
  begin
    update public.person_roles set facts = '{"skills":["runway"]}'::jsonb where headline = 't091 model';
  exception when others then
    raise exception 'FAIL 4: the person cannot save reviewed facts: %', sqlerrm;
  end;
  if (select facts_reviewed_at from public.person_roles where headline = 't091 model') is null then
    raise exception 'FAIL 4: saving facts did not stamp facts_reviewed_at';
  end if;
  raise notice 'PASS 4: code, evidence and facts work for the owner';
end $$;

-- 5. Person B cannot read A's face row.
reset role;
select set_config('request.jwt.claims', '{}', true);
insert into public.person_faces (user_id, storage_ref) values ('00000000-0000-4000-8000-0000000910a1', 'a/face/x.jpg');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000910b1', 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.person_faces) then
    raise exception 'FAIL 5: another person can read a face row';
  end if;
  raise notice 'PASS 5: faces are private';
end $$;

reset role;
do $$ begin raise notice '091 OK'; end $$;

rollback;
