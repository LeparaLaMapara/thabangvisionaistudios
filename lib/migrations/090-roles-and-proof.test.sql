-- 090 test: roles and proof. One transaction, rolled back. Raises on the
-- first failure.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/090-roles-and-proof.test.sql
--
-- Rows are found by a unique headline, not user_id: since 091 browsers may
-- not read person_roles.user_id (equal chance).

begin;

-- Fixtures, as the owner.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000900a1', 't090-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000900b1', 't090-b@example.invalid');
insert into public.profiles (id) values
  ('00000000-0000-4000-8000-0000000900a1'), ('00000000-0000-4000-8000-0000000900b1')
on conflict (id) do nothing;

do $$
declare
  n integer;
begin
  -- 1. The catalogue: 4 live roles, 7 coming soon, model is 18+.
  select count(*) into n from public.roles where status = 'live';
  if n <> 4 then raise exception 'FAIL 1: expected 4 live roles, found %', n; end if;
  select count(*) into n from public.roles where status = 'coming_soon';
  if n <> 7 then raise exception 'FAIL 1: expected 7 coming-soon roles, found %', n; end if;
  if (select min_age from public.roles where slug = 'model') is distinct from 18 then
    raise exception 'FAIL 1: model min_age is not 18';
  end if;
  raise notice 'PASS 1: 4 live roles, 7 coming soon, model 18+';

  -- 2. Every live role has proof steps, guidelines and a typical price.
  select count(*) into n from public.roles
   where status = 'live' and (jsonb_array_length(proof_task) = 0 or length(guidelines) < 40
                              or (suggested_price_cents ->> 'typical') is null);
  if n <> 0 then raise exception 'FAIL 2: % live roles miss proof, guidelines or a price', n; end if;
  raise notice 'PASS 2: live roles are complete';

  -- 3. The driver role asks only legal documents (plus the one platform rule, labelled).
  select count(*) into n from public.roles r, jsonb_array_elements(r.legal_requirements) e
   where r.slug = 'driver-with-vehicle' and e ->> 'basis' not in ('law', 'platform');
  if n <> 0 then raise exception 'FAIL 3: a driver requirement has no basis'; end if;
  raise notice 'PASS 3: every requirement says whether the law or the platform asks for it';

  -- 4. The flag exists and is off.
  if to_regclass('public.feature_flags') is not null
     and (select enabled from public.feature_flags where key = 'roles_v1') is distinct from false then
    raise exception 'FAIL 4: roles_v1 missing or on';
  end if;
  raise notice 'PASS 4: roles_v1 is off';

  -- 5. anon cannot write any of the new tables.
  if has_table_privilege('anon', 'public.roles', 'insert')
     or has_table_privilege('anon', 'public.person_roles', 'insert')
     or has_table_privilege('anon', 'public.role_evidence', 'insert')
     or has_table_privilege('anon', 'public.role_interest', 'insert')
     or has_table_privilege('authenticated', 'public.role_interest', 'insert')
     or has_table_privilege('authenticated', 'public.roles', 'update') then
    raise exception 'FAIL 5: anon or authenticated can write a table they must not';
  end if;
  -- A person cannot write their own level, note or legal check.
  if has_column_privilege('authenticated', 'public.person_roles', 'evidence_level', 'update')
     or has_column_privilege('authenticated', 'public.person_roles', 'reviewer_note', 'update')
     or has_column_privilege('authenticated', 'public.person_roles', 'legal_verified_at', 'update')
     or has_column_privilege('authenticated', 'public.role_evidence', 'verified_by', 'insert') then
    raise exception 'FAIL 5: a person can set their own level, note, legal check or verification';
  end if;
  raise notice 'PASS 5: grants';
end $$;

-- 6. As person A: make a draft, add proof, submit; cannot approve.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000900a1', 'role', 'authenticated')::text, true);

insert into public.person_roles (user_id, role_slug, headline, price_cents)
values ('00000000-0000-4000-8000-0000000900a1', 'makeup-artist', 't090 soft glam', 65000);

-- Proof is written by the server (service role) after its checks since 094.
reset role;
insert into public.role_evidence (person_role_id, step_key, kind, source, storage_provider, storage_ref, url)
select id, 'angles', 'photo', 'captured_in_app', 'cloudinary', 'x/y', 'https://res.cloudinary.com/demo/image/upload/x.jpg'
  from public.person_roles where headline = 't090 soft glam';
set local role authenticated;

do $$
begin
  -- A person cannot claim a job.
  begin
    insert into public.role_evidence (person_role_id, kind, source)
    select id, 'booking', 'booking' from public.person_roles where headline = 't090 soft glam';
    raise exception 'FAIL 6: a person added a booking as evidence';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- Nor a public legal document.
  begin
    insert into public.role_evidence (person_role_id, kind, source, is_public)
    select id, 'document', 'uploaded', true from public.person_roles where headline = 't090 soft glam';
    raise exception 'FAIL 6: a public document was accepted';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- Nor approve themselves.
  begin
    update public.person_roles set status = 'approved' where headline = 't090 soft glam';
    if exists (select 1 from public.person_roles where headline = 't090 soft glam' and status = 'approved') then
      raise exception 'FAIL 6: a person approved themselves';
    end if;
  exception when insufficient_privilege or check_violation then null;
  end;

  update public.person_roles set status = 'submitted' where headline = 't090 soft glam';
  if (select submitted_at from public.person_roles where headline = 't090 soft glam') is null then
    raise exception 'FAIL 6: submitting did not stamp submitted_at';
  end if;
  raise notice 'PASS 6: a person drafts, adds proof and submits, and nothing more';
end $$;

-- 7. As person B: sees nothing of A's draft.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000900b1', 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.person_roles where headline = 't090 soft glam')
     or exists (select 1 from public.role_evidence e join public.person_roles pr on pr.id = e.person_role_id
                 where pr.headline = 't090 soft glam') then
    raise exception 'FAIL 7: another person can read a submitted draft or its proof';
  end if;
  raise notice 'PASS 7: drafts are private';
end $$;

-- 8. Approved by a reviewer (as owner): the public sees the profile and its
--    public work, never the documents.
reset role;
select set_config('request.jwt.claims', '{}', true);
update public.person_roles set status = 'approved' where headline = 't090 soft glam';
insert into public.role_evidence (person_role_id, kind, source, is_public, legal_code)
select id, 'document', 'uploaded', false, 'drivers_licence' from public.person_roles where headline = 't090 soft glam';

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$
declare
  n integer;
begin
  if not exists (select 1 from public.person_roles where headline = 't090 soft glam' and status = 'approved') then
    raise exception 'FAIL 8: anon cannot read an approved profile';
  end if;
  select count(*) into n from public.role_evidence e join public.person_roles pr on pr.id = e.person_role_id
   where pr.headline = 't090 soft glam';
  if n <> 1 then raise exception 'FAIL 8: anon sees % evidence rows, expected 1 (the photo, not the document)', n; end if;
  if (select approved_at from public.person_roles where headline = 't090 soft glam') is null then
    raise exception 'FAIL 8: approving did not stamp approved_at';
  end if;
  raise notice 'PASS 8: public sees approved work only';
end $$;

reset role;
do $$ begin raise notice '090 OK'; end $$;

rollback;
