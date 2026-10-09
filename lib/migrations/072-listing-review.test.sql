-- 072 test script. Runs in ONE transaction and ends in ROLLBACK, so it leaves
-- no trace. Apply 072-listing-review.sql first.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/072-listing-review.test.sql
--
-- Every check prints "PASS: …" or aborts with "FAIL: …".

begin;

-- Lets the `authenticated` role reach this script's own rows when RLS is on,
-- so the trigger (not RLS) is what the untrusted-caller checks exercise.
-- Rolled back with everything else.
create policy "072 test rows" on public.smart_rentals
  for all to authenticated
  using (slug like '072-test-%')
  with check (slug like '072-test-%');

do $$
declare
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  st text;
  pub boolean;
  n integer;
begin
  -- 1. Status vocabulary is enforced.
  begin
    insert into public.smart_rentals (slug, title, owner_type, listing_status)
    values ('072-test-bogus-' || c1, 'Bogus', 'community', 'live');
    raise exception 'FAIL: an unknown listing_status was accepted';
  exception when check_violation then
    raise notice 'PASS: unknown listing_status refused';
  end;

  -- 2. A community insert that claims is_published=true is stored as a draft.
  insert into public.smart_rentals (id, slug, title, owner_type, is_published)
  values (c1, '072-test-c1-' || c1, 'Community camera', 'community', true);
  select listing_status, is_published into st, pub from public.smart_rentals where id = c1;
  if st <> 'draft' or pub then
    raise exception 'FAIL: community insert went live (status %, published %)', st, pub;
  end if;
  raise notice 'PASS: community insert with is_published=true is a draft';

  -- 3. Flipping is_published on a community draft is refused.
  begin
    update public.smart_rentals set is_published = true where id = c1;
    raise exception 'FAIL: is_published=true accepted on a community draft';
  exception when check_violation then
    raise notice 'PASS: community draft cannot be published by the flag';
  end;

  -- 4. Status drives the public flag.
  update public.smart_rentals set listing_status = 'pending_review', submitted_at = now() where id = c1;
  select is_published into pub from public.smart_rentals where id = c1;
  if pub then raise exception 'FAIL: pending_review listing is public'; end if;
  raise notice 'PASS: pending_review is not public';

  update public.smart_rentals set listing_status = 'published', reviewed_at = now() where id = c1;
  select is_published into pub from public.smart_rentals where id = c1;
  if not pub then raise exception 'FAIL: published status did not set is_published'; end if;
  raise notice 'PASS: published status sets is_published';

  update public.smart_rentals set listing_status = 'suspended' where id = c1;
  select is_published into pub from public.smart_rentals where id = c1;
  if pub then raise exception 'FAIL: suspended listing is public'; end if;
  raise notice 'PASS: suspended listing is hidden';

  -- 5. A direct unpublish is recorded as a draft.
  update public.smart_rentals set listing_status = 'published' where id = c1;
  update public.smart_rentals set is_published = false where id = c1;
  select listing_status into st from public.smart_rentals where id = c1;
  if st <> 'draft' then raise exception 'FAIL: direct unpublish left status %', st; end if;
  raise notice 'PASS: direct unpublish becomes draft';

  -- 6. Studio rows: the admin publish toggle still works and stays consistent.
  insert into public.smart_rentals (id, slug, title, owner_type, is_published)
  values (s1, '072-test-s1-' || s1, 'Studio light', 'studio', true);
  select listing_status into st from public.smart_rentals where id = s1;
  if st <> 'published' then raise exception 'FAIL: published studio insert has status %', st; end if;
  update public.smart_rentals set is_published = false where id = s1;
  select listing_status into st from public.smart_rentals where id = s1;
  if st <> 'draft' then raise exception 'FAIL: studio unpublish left status %', st; end if;
  update public.smart_rentals set is_published = true where id = s1;
  select listing_status into st from public.smart_rentals where id = s1;
  if st <> 'published' then raise exception 'FAIL: studio publish left status %', st; end if;
  raise notice 'PASS: studio publish toggle maps to listing_status';

  -- 7. Whole table: the two flags never disagree (backfill + trigger).
  select count(*) into n from public.smart_rentals
   where coalesce(is_published, false) <> (listing_status = 'published');
  if n > 0 then raise exception 'FAIL: % rows where is_published disagrees with listing_status', n; end if;
  raise notice 'PASS: is_published = (listing_status = published) on every row';

  -- 8. The new notification types are accepted.
  if to_regclass('public.notifications') is not null then
    select count(*) into n
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and pg_get_constraintdef(oid) like '%listing_approved%'
       and pg_get_constraintdef(oid) like '%listing_rejected%'
       and pg_get_constraintdef(oid) like '%listing_suspended%';
    if n <> 1 then raise exception 'FAIL: notification types not extended'; end if;
    select count(*) into n
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_type_check'
       and pg_get_constraintdef(oid) like '%gig_request%';
    if n <> 1 then raise exception 'FAIL: existing notification types were dropped'; end if;
    raise notice 'PASS: listing_* notification types added, existing types kept';
  end if;

  -- Seed a draft for the untrusted-caller checks below.
  insert into public.smart_rentals (id, slug, title, owner_type)
  values (c2, '072-test-c2-' || c2, 'Community lens', 'community');
end $$;

-- 9. A signed-in client (not the server) cannot move a listing through review.
set local role authenticated;
do $$
declare
  c uuid;
begin
  select id into c from public.smart_rentals where slug like '072-test-c2-%';
  if c is null then raise exception 'FAIL: test row not visible to authenticated'; end if;

  begin
    update public.smart_rentals set listing_status = 'published' where id = c;
    raise exception 'FAIL: a client changed listing_status';
  exception when insufficient_privilege then
    raise notice 'PASS: client cannot change listing_status';
  end;

  begin
    update public.smart_rentals set reviewed_at = now() where id = c;
    raise exception 'FAIL: a client wrote reviewed_at';
  exception when insufficient_privilege then
    raise notice 'PASS: client cannot write review fields';
  end;

  begin
    insert into public.smart_rentals (slug, title, owner_type, listing_status)
    values ('072-test-c3-' || gen_random_uuid(), 'Sneaky', 'community', 'published');
    raise exception 'FAIL: a client inserted a published listing';
  exception when insufficient_privilege then
    raise notice 'PASS: client cannot insert a published listing';
  end;
end $$;
reset role;

-- 10. The server role can.
set local role service_role;
do $$
declare
  c uuid;
  pub boolean;
begin
  select id into c from public.smart_rentals where slug like '072-test-c2-%';
  update public.smart_rentals set listing_status = 'pending_review', submitted_at = now() where id = c;
  update public.smart_rentals set listing_status = 'published', reviewed_at = now() where id = c;
  select is_published into pub from public.smart_rentals where id = c;
  if not pub then raise exception 'FAIL: service_role approval did not publish'; end if;
  raise notice 'PASS: service_role can submit and approve';
end $$;
reset role;

select 'ALL 072 CHECKS PASSED' as result;
rollback;
