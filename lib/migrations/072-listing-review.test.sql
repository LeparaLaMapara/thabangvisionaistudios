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

-- RLS is on in Supabase; make sure it is on here too (rolled back), so the
-- listing_private owner check really has to get past smart_rentals RLS.
alter table public.smart_rentals enable row level security;

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
  update public.smart_rentals set listing_status = 'pending_review' where id = c1;
  select is_published into pub from public.smart_rentals where id = c1;
  if pub then raise exception 'FAIL: pending_review listing is public'; end if;
  raise notice 'PASS: pending_review is not public';

  update public.smart_rentals set listing_status = 'published' where id = c1;
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

  -- 8b. Private fields are not on the public table.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'smart_rentals'
     and column_name in ('review_notes', 'reviewed_by', 'reviewed_at', 'submitted_at',
                         'ai_fields', 'owner_attestations', 'replacement_value_evidence');
  if n > 0 then raise exception 'FAIL: % private columns are on smart_rentals', n; end if;
  raise notice 'PASS: review/owner-only fields are not on smart_rentals';

  -- Seed a draft for the untrusted-caller checks below.
  insert into public.smart_rentals (id, slug, title, owner_type)
  values (c2, '072-test-c2-' || c2, 'Community lens', 'community');
end $$;

-- Owner + stranger + a private row. The rental's slug is NOT covered by the
-- test policy above, so on a real database the owner can only reach its
-- listing_private row through caller_owns_rental().
create temp table t072 (owner_id uuid, stranger_id uuid, rental_id uuid) on commit drop;
grant select on t072 to authenticated, anon;
do $$
declare
  o uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (o, '072-owner@example.invalid'), (x, '072-stranger@example.invalid');
  insert into public.smart_rentals (id, slug, title, owner_type, owner_id)
  values (r, '072-priv-' || r, 'Private test camera', 'community', o);
  insert into public.listing_private (rental_id, review_notes, owner_attestations, ai_fields)
  values (r, 'note', '{"owns_or_authorised": true}', '{"title": {"status": "suggested"}}');
  insert into t072 values (o, x, r);
end $$;

-- 11. listing_private: owner reads own, stranger and anon read nothing, admin reads all, no client writes.
set local role authenticated;
do $$
declare
  t record;
  n integer;
begin
  select * into t from t072;

  perform set_config('request.jwt.claims', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.listing_private where rental_id = t.rental_id;
  if n <> 1 then raise exception 'FAIL: owner cannot read own listing_private row (saw %)', n; end if;
  raise notice 'PASS: owner reads own private row (draft, via caller_owns_rental)';

  begin
    update public.listing_private set review_notes = 'mine now' where rental_id = t.rental_id;
    raise exception 'FAIL: owner updated listing_private';
  exception when insufficient_privilege then
    raise notice 'PASS: owner cannot write listing_private';
  end;
  begin
    insert into public.listing_private (rental_id) values (gen_random_uuid());
    raise exception 'FAIL: client inserted into listing_private';
  exception when insufficient_privilege then
    raise notice 'PASS: client cannot insert into listing_private';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', t.stranger_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.listing_private where rental_id = t.rental_id;
  if n <> 0 then raise exception 'FAIL: stranger read another owner''s private row'; end if;
  raise notice 'PASS: stranger sees no private row';

  perform set_config('request.jwt.claims',
    json_build_object('sub', t.stranger_id, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text, true);
  select count(*) into n from public.listing_private where rental_id = t.rental_id;
  if n <> 1 then raise exception 'FAIL: admin cannot read listing_private'; end if;
  raise notice 'PASS: admin reads listing_private';

  perform set_config('request.jwt.claims', '', true);
end $$;
reset role;

set local role anon;
do $$
begin
  perform 1 from public.listing_private limit 1;
  raise exception 'FAIL: anon can select listing_private';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read listing_private';
end $$;
reset role;

-- 9. A signed-in client (not the server) cannot change listing_status.
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
  update public.smart_rentals set listing_status = 'pending_review' where id = c;
  update public.smart_rentals set listing_status = 'published' where id = c;
  select is_published into pub from public.smart_rentals where id = c;
  if not pub then raise exception 'FAIL: service_role approval did not publish'; end if;
  insert into public.listing_private (rental_id, reviewed_at, review_notes) values (c, now(), 'ok')
  on conflict (rental_id) do update set reviewed_at = excluded.reviewed_at, review_notes = excluded.review_notes;
  raise notice 'PASS: service_role can submit, approve and write listing_private';
end $$;
reset role;

-- 12. The backfill (2c), re-run against rows shaped like pre-072 data.
do $$
declare
  legacy uuid := gen_random_uuid();      -- community, live before 072, never reviewed
  reviewed uuid := gen_random_uuid();    -- community, approved under 072
  submitted uuid := gen_random_uuid();   -- community, auto-published under 072
  unstamped uuid := gen_random_uuid();   -- community, live under 072, its review stamp never written
  legacy_ai uuid := gen_random_uuid();   -- community AI draft, live before 072, never reviewed
  studio uuid := gen_random_uuid();      -- studio gear, live
  ai_draft uuid := gen_random_uuid();    -- AI draft whose flags were never recorded
  ai_flagged uuid := gen_random_uuid();  -- AI draft with flags already recorded
  st text;
  pub boolean;
  flags jsonb;
  flags_after jsonb;
  n integer;
begin
  insert into public.smart_rentals (id, slug, title, owner_type, listing_status) values
    (legacy, '072-bf-legacy-' || legacy, 'Legacy camera', 'community', 'published'),
    (reviewed, '072-bf-reviewed-' || reviewed, 'Reviewed camera', 'community', 'published'),
    (submitted, '072-bf-submitted-' || submitted, 'Submitted camera', 'community', 'published'),
    (unstamped, '072-bf-unstamped-' || unstamped, 'Unstamped camera', 'community', 'published'),
    (studio, '072-bf-studio-' || studio, 'Studio camera', 'studio', 'published');
  insert into public.smart_rentals (id, slug, title, owner_type, listing_status, is_ai_generated, price_per_day)
  values (legacy_ai, '072-bf-legacy-ai-' || legacy_ai, 'Legacy AI camera', 'community', 'published', true, 400);
  insert into public.listing_private (rental_id, reviewed_at) values (reviewed, now());
  insert into public.listing_private (rental_id, submitted_at) values (submitted, now());
  -- Approved under 072, but the review record written after the decision
  -- failed: the private row exists (it holds the owner declarations that
  -- approval required) with no stamp.
  insert into public.listing_private (rental_id, owner_attestations)
  values (unstamped, '{"owns_or_authorised": true, "condition_working": true, "location_accurate": true}');
  insert into public.smart_rentals
    (id, slug, title, owner_type, is_ai_generated, price_per_day, price_per_week, description, rental_includes)
  values
    (ai_draft, '072-bf-ai-' || ai_draft, 'AI camera', 'community', true, 400, 2000, 'Guessed words', '{}'),
    (ai_flagged, '072-bf-aif-' || ai_flagged, 'AI camera 2', 'community', true, 400, null, null, '{}');
  insert into public.listing_private (rental_id, ai_fields)
  values (ai_flagged, '{"title": {"status": "confirmed", "suggested_at": "x"}}');

  perform public.listing_review_backfill_072();

  select listing_status, is_published into st, pub from public.smart_rentals where id = legacy;
  if st <> 'pending_review' or pub then
    raise exception 'FAIL: never-reviewed community listing stayed live (status %, published %)', st, pub;
  end if;
  raise notice 'PASS: community listing live before 072 is taken offline for review';

  -- (c) gives it a private row in the same run, after (b): still offline.
  select listing_status, is_published into st, pub from public.smart_rentals where id = legacy_ai;
  select count(*) into n from public.listing_private where rental_id = legacy_ai and ai_fields is not null;
  if st <> 'pending_review' or pub or n <> 1 then
    raise exception 'FAIL: live AI listing from before 072 not taken offline with flags (status %, published %, flags %)', st, pub, n;
  end if;
  raise notice 'PASS: AI listing live before 072 is taken offline and its AI fields flagged';

  select count(*) into n from public.smart_rentals
   where id in (reviewed, submitted, unstamped, studio) and listing_status = 'published' and is_published;
  if n <> 4 then raise exception 'FAIL: reviewed/submitted/unstamped/studio listings were taken offline (% of 4 live)', n; end if;
  raise notice 'PASS: reviewed, submitted, unstamped (private row, no stamp) and studio listings stay live';

  select ai_fields into flags from public.listing_private where rental_id = ai_draft;
  if flags is null then raise exception 'FAIL: AI draft got no ai_fields'; end if;
  select count(*) into n from jsonb_each(flags) e where e.value ->> 'status' = 'suggested';
  if n <> 7 or not (flags ?& array['title', 'brand', 'model', 'category', 'price_per_day', 'price_per_week', 'description'])
     or flags ? 'rental_includes' then
    raise exception 'FAIL: AI draft flags wrong: %', flags;
  end if;
  raise notice 'PASS: AI draft without flags has its AI fields marked unconfirmed';

  select ai_fields into flags_after from public.listing_private where rental_id = ai_flagged;
  if flags_after <> '{"title": {"status": "confirmed", "suggested_at": "x"}}'::jsonb then
    raise exception 'FAIL: recorded AI flags were overwritten: %', flags_after;
  end if;
  raise notice 'PASS: recorded AI flags are left alone';

  -- Re-run: nothing changes. Then the AI listing is approved (status back to
  -- published; it has the private row (c) made) and a third run must leave
  -- it live.
  perform public.listing_review_backfill_072();
  select listing_status into st from public.smart_rentals where id = legacy;
  select count(*) into n from public.smart_rentals
   where id in (reviewed, submitted, unstamped, studio) and listing_status = 'published';
  select ai_fields into flags_after from public.listing_private where rental_id = ai_draft;
  if st <> 'pending_review' or n <> 4 or flags_after <> flags then
    raise exception 'FAIL: second backfill run changed something';
  end if;
  update public.smart_rentals set listing_status = 'published' where id = legacy_ai;
  perform public.listing_review_backfill_072();
  select listing_status into st from public.smart_rentals where id = legacy_ai;
  if st <> 'published' then
    raise exception 'FAIL: a re-run took an approved listing offline (status %)', st;
  end if;
  raise notice 'PASS: backfill is idempotent and a re-run leaves approved listings live';

  select count(*) into n from public.smart_rentals
   where coalesce(is_published, false) <> (listing_status = 'published');
  if n > 0 then raise exception 'FAIL: % rows disagree after the backfill', n; end if;
  raise notice 'PASS: is_published still matches listing_status after the backfill';
end $$;

set local role authenticated;
do $$
begin
  perform public.listing_review_backfill_072();
  raise exception 'FAIL: a client ran the backfill';
exception when insufficient_privilege then
  raise notice 'PASS: clients cannot run the backfill';
end $$;
reset role;

select 'ALL 072 CHECKS PASSED' as result;
rollback;
