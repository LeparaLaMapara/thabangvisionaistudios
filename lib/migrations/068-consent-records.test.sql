-- Tests for 068-consent-records.sql. DEV DATABASE ONLY.
--
-- Run in the Supabase SQL editor (as postgres) or psql AFTER applying 068.
-- Everything happens inside one transaction that ends in ROLLBACK, so the
-- two throwaway auth users and their rows never persist.
--
-- The fixture users are inserted straight into auth.users. If a dev trigger
-- on auth.users (e.g. a profile-creation trigger) rejects the minimal row,
-- replace the two UUIDs below with real dev TEST users and delete the
-- fixture insert. Never use production users or credentials.
--
-- Each check prints "PASS n: ..." as a NOTICE. Any failure raises an
-- exception ("FAIL n: ...") and aborts the script.
--
-- Covers:
--   1. a user can insert their own consent
--   2. a user cannot insert a consent for another user
--   3. a user cannot update a consent row
--   4. a user cannot delete a consent row
--   5. a client cannot back-date accepted_at (the database stamps it)
--   6. a user reads only their own rows
--   7. withdrawal is a new row; the earlier acceptance is unchanged
--   8. anon cannot read (or insert)
--   9. the service role can read all rows

begin;

-- ─── Fixtures (as postgres) ────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000c0a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'consent-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000c0b02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'consent-test-b@example.invalid');

-- A row for user B, written as the server would (bypasses RLS).
insert into public.consent_records (user_id, consent_purpose, document_version, source)
values ('00000000-0000-4000-8000-0000000c0b02', 'terms', '2026-10-08', 'signup');

-- ─── As user A (authenticated) ─────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000c0a01","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000c0a01', true);

do $$
begin
  insert into public.consent_records (user_id, consent_purpose, document_version, source)
  values ('00000000-0000-4000-8000-0000000c0a01', 'terms', '2026-10-08', 'oauth_onboarding');
  raise notice 'PASS 1: user can insert own consent';
end $$;

do $$
begin
  begin
    insert into public.consent_records (user_id, consent_purpose, document_version, source)
    values ('00000000-0000-4000-8000-0000000c0b02', 'privacy', '2026-10-08', 'signup');
    raise exception 'FAIL 2: user inserted a consent for another user';
  exception when insufficient_privilege then
    raise notice 'PASS 2: insert for another user rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    update public.consent_records
       set document_version = '2099-01-01'
     where user_id = '00000000-0000-4000-8000-0000000c0a01';
    raise exception 'FAIL 3: user updated a consent row';
  exception when insufficient_privilege then
    raise notice 'PASS 3: update rejected (%)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    delete from public.consent_records
     where user_id = '00000000-0000-4000-8000-0000000c0a01';
    raise exception 'FAIL 4: user deleted a consent row';
  exception when insufficient_privilege then
    raise notice 'PASS 4: delete rejected (%)', sqlerrm;
  end;
end $$;

do $$
declare
  stamped timestamptz;
begin
  insert into public.consent_records (user_id, consent_purpose, document_version, source, accepted_at)
  values ('00000000-0000-4000-8000-0000000c0a01', 'privacy', '2026-10-08', 'oauth_onboarding', '2000-01-01T00:00:00Z')
  returning accepted_at into stamped;
  if stamped < now() - interval '1 minute' then
    raise exception 'FAIL 5: client back-dated accepted_at to %', stamped;
  end if;
  raise notice 'PASS 5: accepted_at stamped by the database (%)', stamped;
end $$;

do $$
declare
  others int;
  mine int;
begin
  select count(*) into others from public.consent_records
   where user_id <> '00000000-0000-4000-8000-0000000c0a01';
  select count(*) into mine from public.consent_records
   where user_id = '00000000-0000-4000-8000-0000000c0a01';
  if others <> 0 then
    raise exception 'FAIL 6: user can see % row(s) belonging to others', others;
  end if;
  if mine < 2 then
    raise exception 'FAIL 6: user cannot see own rows (saw %)', mine;
  end if;
  raise notice 'PASS 6: user sees only own rows (% rows)', mine;
end $$;

do $$
declare
  latest record;
  first_terms record;
begin
  insert into public.consent_records (user_id, consent_purpose, document_version, source, withdrawn_at)
  values ('00000000-0000-4000-8000-0000000c0a01', 'terms', '2026-10-08', 'oauth_onboarding', now());

  select * into latest from public.consent_records
   where user_id = '00000000-0000-4000-8000-0000000c0a01' and consent_purpose = 'terms'
   order by accepted_at desc, withdrawn_at desc nulls last limit 1;
  if latest.withdrawn_at is null then
    raise exception 'FAIL 7: latest terms row is not the withdrawal';
  end if;

  select * into first_terms from public.consent_records
   where user_id = '00000000-0000-4000-8000-0000000c0a01' and consent_purpose = 'terms'
     and withdrawn_at is null;
  if first_terms.id is null then
    raise exception 'FAIL 7: the original acceptance row was lost';
  end if;
  raise notice 'PASS 7: withdrawal recorded as a new row, history kept';
end $$;

-- ─── As anon ───────────────────────────────────────────────────────────────
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  n int;
begin
  begin
    select count(*) into n from public.consent_records;
    raise exception 'FAIL 8: anon read consent_records (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 8a: anon read rejected (%)', sqlerrm;
  end;
  begin
    insert into public.consent_records (user_id, consent_purpose, document_version, source)
    values ('00000000-0000-4000-8000-0000000c0a01', 'terms', '2026-10-08', 'signup');
    raise exception 'FAIL 8: anon inserted a consent row';
  exception when insufficient_privilege then
    raise notice 'PASS 8b: anon insert rejected (%)', sqlerrm;
  end;
end $$;

-- ─── As service_role ───────────────────────────────────────────────────────
reset role;
set local role service_role;

do $$
declare
  n int;
begin
  select count(*) into n from public.consent_records
   where user_id in ('00000000-0000-4000-8000-0000000c0a01', '00000000-0000-4000-8000-0000000c0b02');
  if n < 4 then
    raise exception 'FAIL 9: service role saw only % rows', n;
  end if;
  raise notice 'PASS 9: service role reads all rows (% test rows)', n;
end $$;

reset role;
rollback;
