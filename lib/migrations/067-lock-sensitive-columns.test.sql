-- 067 tests — run against the DEV project ONLY, after applying 067.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/067-lock-sensitive-columns.test.sql
--
-- (or paste into the Supabase SQL editor of the DEV project). Never run it with
-- production credentials.
--
-- Everything happens inside one transaction that ends in ROLLBACK, so no row,
-- grant or object it creates survives. It impersonates two existing dev users
-- by switching to the `authenticated` role and setting JWT claims, exactly as
-- PostgREST does for a signed-in request.
--
-- Each check prints NOTICE 'PASS: ...'. Any failure raises an exception
-- 'FAIL: ...' which aborts the script at that point — so "the script ran to
-- the final SELECT" means every check passed. Paste the full output into
-- docs/security/phase-0-db-evidence.md.
--
-- To pin specific users instead of the first two non-admin profiles, replace
-- the two subqueries in step 0 with literal UUIDs.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Fixtures (as the session user, i.e. postgres)
-- ════════════════════════════════════════════════════════════════════════════
reset role;

-- A fresh database (e.g. one rebuilt with scripts/db/rebuild-local.sh) has
-- no users. Create two throwaway non-admin users when fewer than two exist;
-- they are rolled back with everything else. The profile insert covers a
-- database whose signup trigger is missing or still the pre-077 body.
do $$
declare
  n integer;
  v uuid;
begin
  select count(*) into n
    from public.profiles p join auth.users u on u.id = p.id
   where coalesce(p.role, 'user') <> 'admin';
  for i in 1 .. greatest(0, 2 - n) loop
    v := gen_random_uuid();
    insert into auth.users (id, email, created_at)
    values (v, 'tv-067-fixture-' || i || '@example.invalid', now() + make_interval(secs => i));
    insert into public.profiles (id) values (v) on conflict (id) do nothing;
    raise notice 'fixture user % created (no existing non-admin users)', v;
  end loop;
end $$;

select set_config('tv.user_a', (
  select p.id::text from public.profiles p join auth.users u on u.id = p.id
   where coalesce(p.role, 'user') <> 'admin'
   order by u.created_at limit 1), true);
select set_config('tv.user_b', (
  select p.id::text from public.profiles p join auth.users u on u.id = p.id
   where coalesce(p.role, 'user') <> 'admin'
   order by u.created_at offset 1 limit 1), true);

do $$
declare v_review uuid;
begin
  if nullif(current_setting('tv.user_a', true), '') is null
     or nullif(current_setting('tv.user_b', true), '') is null then
    raise exception 'FAIL: need two non-admin users with profiles on dev';
  end if;

  -- Known starting state for both users (rolled back at the end).
  update public.profiles
     set verification_status = 'unverified', is_verified = false,
         verification_attempts = 0, first_name = 'Test', last_name = 'Alpha',
         display_name = 'Test Alpha', bio = 'before'
   where id = current_setting('tv.user_a')::uuid;
  update public.profiles
     set verification_status = 'unverified', is_verified = false,
         verification_attempts = 0, id_document_hash = null
   where id = current_setting('tv.user_b')::uuid;

  -- A banking row for A.
  delete from public.banking_details where user_id = current_setting('tv.user_a')::uuid;
  -- account_number is NOT NULL before 046 and nullable after it; supply it only
  -- where it is still required.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'banking_details'
                and column_name = 'account_number' and is_nullable = 'NO') then
    insert into public.banking_details (user_id, bank_name, bank_code, account_number, account_type, account_holder)
    values (current_setting('tv.user_a')::uuid, 'Test Bank', '000000', '0000', 'cheque', 'Test Alpha');
  else
    insert into public.banking_details (user_id, bank_name, bank_code, account_type, account_holder)
    values (current_setting('tv.user_a')::uuid, 'Test Bank', '000000', 'cheque', 'Test Alpha');
  end if;

  -- A review written by A about B.
  insert into public.reviews (review_type, reviewer_id, reviewee_id, rating, comment)
  values ('crew', current_setting('tv.user_a')::uuid, current_setting('tv.user_b')::uuid, 4, 'test')
  returning id into v_review;
  perform set_config('tv.review_id', v_review::text, true);

  -- Verification storage objects for A and B.
  insert into storage.buckets (id, name, public) values ('verifications', 'verifications', false)
  on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name)
  values ('verifications', current_setting('tv.user_a') || '/tv-test-067-a'),
         ('verifications', current_setting('tv.user_b') || '/tv-test-067-b');

  raise notice 'fixtures ready: user_a=% user_b=%', current_setting('tv.user_a'), current_setting('tv.user_b');
end $$;

-- Structural checks
do $$
begin
  if exists (select 1 from storage.buckets where id = 'verifications' and public) then
    raise exception 'FAIL: verifications bucket is public';
  end if;
  raise notice 'PASS: verifications bucket is private';

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname = 'Users can update own verification docs') then
    raise exception 'FAIL: storage UPDATE policy on verification docs still exists';
  end if;
  raise notice 'PASS: storage UPDATE (overwrite) policy on verification docs is gone';

  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'is_verified', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'id_document_hash', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'verification_fraud_flags', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'selfie_with_id_path', 'UPDATE') then
    raise exception 'FAIL: authenticated still has UPDATE on a privileged profiles column';
  end if;
  raise notice 'PASS: authenticated has no UPDATE on role / is_verified / id_document_hash / verification_fraud_flags / selfie_with_id_path';

  if has_column_privilege('authenticated', 'public.banking_details', 'is_verified', 'UPDATE')
     or has_column_privilege('authenticated', 'public.banking_details', 'paystack_recipient_code', 'UPDATE')
     or has_column_privilege('authenticated', 'public.banking_details', 'account_holder', 'UPDATE')
     or has_table_privilege('authenticated', 'public.banking_details', 'INSERT') then
    raise exception 'FAIL: authenticated can still write banking_details';
  end if;
  raise notice 'PASS: authenticated cannot write banking_details';

  if has_table_privilege('authenticated', 'public.security_audit_log', 'SELECT')
     or has_table_privilege('anon', 'public.security_audit_log', 'SELECT')
     or has_table_privilege('service_role', 'public.security_audit_log', 'UPDATE')
     or has_table_privilege('service_role', 'public.security_audit_log', 'DELETE') then
    raise exception 'FAIL: security_audit_log privileges too wide';
  end if;
  raise notice 'PASS: security_audit_log: no client access, service_role append/read only';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. As user A (authenticated)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tv.user_a'), 'role', 'authenticated')::text, true);

-- T18a: privileged INSERT rejected
do $$
begin
  begin
    insert into public.profiles (id, role) values (gen_random_uuid(), 'admin');
    raise exception 'FAIL: privileged INSERT (role=admin) succeeded';
  exception when insufficient_privilege then
    raise notice 'PASS: privileged INSERT rejected (%)', sqlerrm;
  end;
  begin
    insert into public.profiles (id, is_verified, verification_status)
    values (auth.uid(), true, 'verified');
    raise exception 'FAIL: privileged INSERT (is_verified) succeeded';
  exception when insufficient_privilege then
    raise notice 'PASS: privileged INSERT of is_verified/verification_status rejected (%)', sqlerrm;
  end;
end $$;

-- T18b: privileged UPDATE rejected, column by column
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('role', '''admin'''),
      ('is_verified', 'true'),
      ('verification_status', '''verified'''),
      ('verification_fraud_flags', '''[]''::jsonb'),
      ('verification_attempts', '0'),
      ('id_document_hash', '''deadbeef'''),
      ('id_front_path', '''x/y'''),
      ('selfie_with_id_path', '''x/y'''),
      ('is_suspended', 'false'),
      ('suspension_reason', 'null'),
      ('no_show_count', '0'),
      ('crew_featured', 'true'),
      ('crew_slug', '''someone-else'''),
      ('phone_verified_at', 'now()')
    ) v(col, val)
    where exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'profiles' and column_name = v.col)
  loop
    begin
      execute format('update public.profiles set %I = %s where id = auth.uid()', r.col, r.val);
      raise exception 'FAIL: user could UPDATE profiles.%', r.col;
    exception when insufficient_privilege then
      raise notice 'PASS: UPDATE profiles.% rejected', r.col;
    end;
  end loop;
end $$;

-- Ownership reassignment rejected
do $$
begin
  begin
    update public.profiles set id = gen_random_uuid() where id = auth.uid();
    raise exception 'FAIL: user could change profiles.id';
  exception when insufficient_privilege then
    raise notice 'PASS: profiles.id reassignment rejected';
  end;
end $$;

-- Legitimate edits succeed, existing row still readable
do $$
declare n int; v text;
begin
  update public.profiles
     set bio = 'after', first_name = 'Test', last_name = 'Alpha-Edit',
         display_name = 'Test Alpha-Edit', city = 'Johannesburg', updated_at = now()
   where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: legitimate profile edit updated % rows', n; end if;
  select bio into v from public.profiles where id = auth.uid();
  if v is distinct from 'after' then raise exception 'FAIL: bio not saved'; end if;
  raise notice 'PASS: legitimate profile edit (bio, unverified name, address) succeeded and is readable';

  select count(*) into n from public.profiles where id = current_setting('tv.user_b')::uuid;
  if n <> 0 then raise exception 'FAIL: user A can read user B''s full profile row'; end if;
  raise notice 'PASS: user A cannot read user B''s profile row';

  update public.profiles set bio = 'hijack' where id = current_setting('tv.user_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated user B''s profile'; end if;
  raise notice 'PASS: user A cannot update user B''s profile (0 rows)';
end $$;

-- T19: banking is_verified / recipient / holder / owner rejected
do $$
declare r record; n int;
begin
  for r in
    select * from (values
      ('is_verified', 'true'),
      ('paystack_recipient_code', '''RCP_fake'''),
      ('account_holder', '''Someone Else'''),
      ('user_id', 'gen_random_uuid()'),
      ('bank_name', '''Other Bank''')
    ) v(col, val)
  loop
    begin
      execute format('update public.banking_details set %I = %s where user_id = auth.uid()', r.col, r.val);
      raise exception 'FAIL: user could UPDATE banking_details.%', r.col;
    exception when insufficient_privilege then
      raise notice 'PASS: UPDATE banking_details.% rejected', r.col;
    end;
  end loop;

  begin
    insert into public.banking_details (user_id, bank_name, bank_code, account_type, account_holder, is_verified)
    values (auth.uid(), 'x', 'x', 'cheque', 'x', true);
    raise exception 'FAIL: user could INSERT banking_details';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT banking_details rejected';
  end;

  select count(*) into n from public.banking_details where user_id = auth.uid();
  if n <> 1 then raise exception 'FAIL: user cannot read own banking row (% rows)', n; end if;
  raise notice 'PASS: user can still read own banking row';
end $$;

-- reviews: content editable, links not
do $$
declare n int;
begin
  update public.reviews set rating = 5, comment = 'edited'
   where id = current_setting('tv.review_id')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: author could not edit own review (% rows)', n; end if;
  raise notice 'PASS: author can edit rating/comment of own review';

  begin
    update public.reviews set reviewee_id = auth.uid() where id = current_setting('tv.review_id')::uuid;
    raise exception 'FAIL: author could re-point reviewee_id';
  exception when insufficient_privilege then
    raise notice 'PASS: reviews.reviewee_id change rejected';
  end;
  begin
    update public.reviews set reviewer_id = current_setting('tv.user_b')::uuid where id = current_setting('tv.review_id')::uuid;
    raise exception 'FAIL: author could change reviewer_id';
  exception when insufficient_privilege then
    raise notice 'PASS: reviews.reviewer_id change rejected';
  end;
  begin
    insert into public.reviews (review_type, reviewer_id, reviewee_id, rating)
    values ('crew', auth.uid(), current_setting('tv.user_b')::uuid, 5);
    raise exception 'FAIL: client could INSERT a review directly';
  exception when insufficient_privilege then
    raise notice 'PASS: client INSERT into reviews rejected (server route only)';
  end;
end $$;

-- Storage: no overwrite, no cross-user read/write
do $$
declare n int;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'verifications' and name = current_setting('tv.user_a') || '/tv-test-067-a';
  if n <> 1 then raise exception 'FAIL: user cannot see own verification object (% rows)', n; end if;
  raise notice 'PASS: user can read own verification object';

  select count(*) into n from storage.objects
   where bucket_id = 'verifications' and name like current_setting('tv.user_b') || '/%';
  if n <> 0 then raise exception 'FAIL: user A can read user B''s verification objects'; end if;
  raise notice 'PASS: cross-user storage read rejected (0 rows)';

  begin
    update storage.objects set metadata = '{"tampered": true}'::jsonb
     where bucket_id = 'verifications' and name = current_setting('tv.user_a') || '/tv-test-067-a';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user could overwrite own verification object'; end if;
    raise notice 'PASS: own verification object cannot be overwritten (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS: own verification object cannot be overwritten (%)', sqlerrm;
  end;

  begin
    update storage.objects set metadata = '{"tampered": true}'::jsonb
     where bucket_id = 'verifications' and name like current_setting('tv.user_b') || '/%';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A could update user B''s verification object'; end if;
    raise notice 'PASS: cross-user storage write rejected (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-user storage write rejected (%)', sqlerrm;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('verifications', current_setting('tv.user_b') || '/planted');
    raise exception 'FAIL: user A could create an object in user B''s folder';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-user storage insert rejected';
  end;

  begin
    delete from storage.objects
     where bucket_id = 'verifications' and name like current_setting('tv.user_b') || '/%';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user A deleted user B''s verification object'; end if;
    raise notice 'PASS: cross-user storage delete rejected (0 rows)';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: cross-user storage delete rejected (%)', sqlerrm;
  end;
end $$;

-- Audit log and service-only RPCs are out of reach
do $$
begin
  begin
    perform 1 from public.security_audit_log limit 1;
    raise exception 'FAIL: authenticated can read security_audit_log';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated cannot read security_audit_log';
  end;
  begin
    perform public.submit_verification_for_user(auth.uid(), auth.uid()::text || '/a', auth.uid()::text || '/b');
    raise exception 'FAIL: authenticated can call submit_verification_for_user';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated cannot call submit_verification_for_user';
  end;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'submit_verification_request') then
    begin
      perform public.submit_verification_request('x/y');
      raise exception 'FAIL: authenticated can still call submit_verification_request';
    exception when insufficient_privilege then
      raise notice 'PASS: authenticated cannot call the old submit_verification_request';
    end;
  else
    raise notice 'SKIP: submit_verification_request does not exist on this project';
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. Anonymous
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

do $$
declare n int;
begin
  begin
    select count(*) into n from public.profiles where phone is not null or id_document_hash is not null;
    if n <> 0 then raise exception 'FAIL: anon can read % profiles rows with PII', n; end if;
    raise notice 'PASS: anon reads 0 profiles rows (PII hidden)';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no SELECT on profiles';
  end;
  begin
    update public.profiles set bio = 'anon';
    raise exception 'FAIL: anon UPDATE on profiles allowed';
  exception when insufficient_privilege then
    raise notice 'PASS: anon UPDATE on profiles rejected';
  end;
  begin
    perform 1 from public.security_audit_log limit 1;
    raise exception 'FAIL: anon can read security_audit_log';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read security_audit_log';
  end;
  begin
    select count(*) into n from storage.objects where bucket_id = 'verifications';
    if n <> 0 then raise exception 'FAIL: anon can list verification objects'; end if;
    raise notice 'PASS: anon sees 0 verification objects';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no SELECT on storage.objects';
  end;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. Trusted paths: admin RPC and service role
-- ════════════════════════════════════════════════════════════════════════════
reset role;

-- Admin approval through the SECURITY DEFINER RPC, as a signed-in admin would
-- call it (falls back to a service-role update if the RPC is missing on dev).
select set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('tv.user_b'), 'role', 'authenticated',
  'app_metadata', json_build_object('role', 'admin'))::text, true);
set local role authenticated;

do $$
declare v jsonb;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'admin_approve_verification') then
    select public.admin_approve_verification(current_setting('tv.user_a')::uuid) into v;
    if coalesce((v ->> 'success')::boolean, false) is not true then
      raise exception 'FAIL: admin_approve_verification returned %', v;
    end if;
    raise notice 'PASS: admin_approve_verification (definer RPC) succeeded under the new guard';
  else
    raise notice 'SKIP: admin_approve_verification missing on this project; approving via service role below';
  end if;
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

do $$
declare n int; v jsonb; v_status text;
begin
  -- Service-role approval path (what lib/supabase/queries/verifications.ts does).
  update public.profiles
     set verification_status = 'verified', is_verified = true, verification_reviewed_at = now()
   where id = current_setting('tv.user_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: service-role approval updated % rows', n; end if;
  raise notice 'PASS: service-role verification approval succeeded';

  select count(*) into n from public.security_audit_log
   where table_name = 'profiles' and row_id = current_setting('tv.user_a')
     and column_name in ('is_verified', 'verification_status');
  if n < 1 then raise exception 'FAIL: trusted privileged change was not audited'; end if;
  raise notice 'PASS: trusted privileged change written to security_audit_log (% rows)', n;

  if exists (select 1 from public.security_audit_log
              where table_name = 'profiles' and column_name in ('id_document_hash', 'selfie_with_id_path', 'first_name')
                and change_summary::text !~ '^\{("old": (null|"\[redacted\]"), "new": (null|"\[redacted\]")|"new": (null|"\[redacted\]"), "old": (null|"\[redacted\]"))\}$') then
    raise exception 'FAIL: audit log holds an unredacted personal value';
  end if;
  raise notice 'PASS: audit summaries for personal columns are redacted';

  begin
    update public.security_audit_log set column_name = 'x';
    raise exception 'FAIL: service_role can UPDATE security_audit_log';
  exception when insufficient_privilege then
    raise notice 'PASS: service_role cannot UPDATE security_audit_log';
  end;
  begin
    delete from public.security_audit_log;
    raise exception 'FAIL: service_role can DELETE security_audit_log';
  exception when insufficient_privilege then
    raise notice 'PASS: service_role cannot DELETE security_audit_log';
  end;

  -- Service-role verification submission RPC (what /api/verifications calls).
  select public.submit_verification_for_user(
    current_setting('tv.user_b')::uuid,
    current_setting('tv.user_b') || '/' || gen_random_uuid() || '-id-copy',
    current_setting('tv.user_b') || '/' || gen_random_uuid() || '-selfie-with-id',
    null, '{}'::jsonb, '[]'::jsonb, 'tv-test-hash', '127.0.0.1', 'tv-test') into v;
  if coalesce((v ->> 'success')::boolean, false) is not true then
    raise exception 'FAIL: submit_verification_for_user returned %', v;
  end if;
  select verification_status into v_status from public.profiles where id = current_setting('tv.user_b')::uuid;
  if v_status <> 'pending' then raise exception 'FAIL: submission did not set pending (%)', v_status; end if;
  raise notice 'PASS: service-role submit_verification_for_user succeeded (status pending)';

  -- Paths outside the subject's own folder are refused.
  update public.profiles set verification_status = 'rejected' where id = current_setting('tv.user_b')::uuid;
  select public.submit_verification_for_user(
    current_setting('tv.user_b')::uuid,
    current_setting('tv.user_a') || '/someone-elses-id',
    current_setting('tv.user_b') || '/selfie') into v;
  if coalesce((v ->> 'success')::boolean, false) or v ->> 'error' <> 'Invalid document path' then
    raise exception 'FAIL: cross-folder path accepted: %', v;
  end if;
  raise notice 'PASS: submit_verification_for_user refuses a path in another user''s folder';

  -- Banking: the server may set the recipient code and verification.
  update public.banking_details set paystack_recipient_code = 'RCP_test', is_verified = true
   where user_id = current_setting('tv.user_a')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: service role could not update banking row'; end if;
  raise notice 'PASS: service role can set paystack_recipient_code / is_verified';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. Verified name lock (user A is now verified)
-- ════════════════════════════════════════════════════════════════════════════
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tv.user_a'), 'role', 'authenticated')::text, true);

do $$
declare n int;
begin
  begin
    update public.profiles set first_name = 'Changed' where id = auth.uid();
    raise exception 'FAIL: verified user could change first_name';
  exception when insufficient_privilege then
    if sqlerrm not like '%locked after ID verification%' then
      raise exception 'FAIL: name lock raised the wrong message: %', sqlerrm;
    end if;
    raise notice 'PASS: verified name change rejected with "%"', sqlerrm;
  end;
  begin
    update public.profiles set display_name = 'Someone Famous' where id = auth.uid();
    raise exception 'FAIL: verified user could change display_name';
  exception when insufficient_privilege then
    raise notice 'PASS: verified display_name change rejected';
  end;

  update public.profiles set bio = 'still editable', first_name = first_name where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: verified user cannot edit bio'; end if;
  raise notice 'PASS: verified user can still edit bio (unchanged name passes)';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. Defence in depth: re-add the table-wide grants (as a misconfiguration
--    would) and confirm the triggers still refuse. Undone by the savepoint.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
savepoint defence_in_depth;
grant insert, update on public.profiles, public.banking_details, public.reviews to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tv.user_b'), 'role', 'authenticated')::text, true);

do $$
begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'FAIL: trigger let role change through a table-wide grant';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] role change rejected even with table-wide grant (%)', sqlerrm;
  end;
  begin
    update public.profiles set id_document_hash = 'x', verification_fraud_flags = '[]'::jsonb where id = auth.uid();
    raise exception 'FAIL: trigger let id_document_hash change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] id_document_hash / fraud flags change rejected';
  end;
  begin
    update public.profiles set verification_status = 'verified' where id = auth.uid();
    raise exception 'FAIL: trigger let verification_status change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] verification_status change rejected';
  end;
  begin
    insert into public.profiles (id, is_verified) values (auth.uid(), true);
    raise exception 'FAIL: trigger let a privileged INSERT through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] INSERT with non-default privileged field rejected';
  end;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('tv.user_a'), 'role', 'authenticated')::text, true);

do $$
begin
  begin
    update public.banking_details set is_verified = false where user_id = auth.uid();
    raise exception 'FAIL: trigger let banking is_verified change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] banking is_verified change rejected';
  end;
  begin
    update public.banking_details set paystack_recipient_code = 'RCP_mine' where user_id = auth.uid();
    raise exception 'FAIL: trigger let recipient code change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] banking paystack_recipient_code change rejected';
  end;
  begin
    update public.banking_details set user_id = current_setting('tv.user_b')::uuid where user_id = auth.uid();
    raise exception 'FAIL: banking row could be moved to another user';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger/policy] banking user_id reassignment rejected';
  end;
  begin
    update public.reviews set reviewee_id = auth.uid() where id = current_setting('tv.review_id')::uuid;
    raise exception 'FAIL: trigger let reviewee_id change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] reviews.reviewee_id change rejected';
  end;
  begin
    update public.reviews set is_published = false where id = current_setting('tv.review_id')::uuid;
    raise exception 'FAIL: trigger let is_published change through';
  exception when insufficient_privilege then
    raise notice 'PASS: [trigger] reviews.is_published change rejected';
  end;
end $$;

reset role;
rollback to savepoint defence_in_depth;

select 'ALL 067 CHECKS PASSED — rolling back' as result,
       current_setting('tv.user_a') as user_a,
       current_setting('tv.user_b') as user_b;

rollback;
