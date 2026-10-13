-- 083 test script. ONE transaction, ends in ROLLBACK; creates its own users.
-- Apply 083-prerelease-fixes.sql first. Works before 067 (prod's apply order)
-- and after 082 (scripts/db/rebuild-local.sh order).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/083-prerelease-fixes.test.sql
--
-- Each check prints NOTICE 'PASS ...'; a failure raises 'FAIL ...' and stops.

begin;

-- ── Fixtures (as the migration owner) ──────────────────────────────────────
reset role;
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (a, 't083-a@example.invalid'), (b, 't083-b@example.invalid');
  insert into public.profiles (id) values (a), (b) on conflict (id) do nothing;

  insert into storage.buckets (id, name, public) values ('verifications', 'verifications', false)
    on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name)
  values ('verifications', a::text || '/tv-test-083-a'),
         ('verifications', b::text || '/tv-test-083-b');

  perform set_config('t083.a', a::text, true);
  perform set_config('t083.b', b::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F1. verification documents
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text;
begin
  select string_agg(policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('Admins view all verification docs',
                        'Users view own verification docs',
                        'Users upload own verification docs');
  if v_bad is not null then
    raise exception 'FAIL F1: hand-made verification policies still present: %', v_bad;
  end if;
  raise notice 'PASS F1a: the three hand-made verification policies are gone';

  -- Any policy that lets a client read the verifications bucket must tie the
  -- row to the caller's own folder (or to an admin check).
  select string_agg(policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') like '%verifications%'
     and coalesce(qual, '') not like '%foldername%'
     and coalesce(qual, '') not like '%is_admin%';
  if v_bad is not null then
    raise exception 'FAIL F1: a read policy on the verifications bucket has no owner or admin check: %', v_bad;
  end if;
  raise notice 'PASS F1b: every read policy on the verifications bucket checks the owner or admin';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t083.a'), 'role', 'authenticated')::text, true);

do $$
declare
  n integer;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'verifications' and name = current_setting('t083.a') || '/tv-test-083-a';
  if n <> 1 then raise exception 'FAIL F1: user cannot see own verification object (% rows)', n; end if;
  raise notice 'PASS F1c: a user still reads their own verification object';

  select count(*) into n from storage.objects
   where bucket_id = 'verifications' and name like current_setting('t083.b') || '/%';
  if n <> 0 then raise exception 'FAIL F1: user A can read user B''s verification objects (% rows)', n; end if;
  raise notice 'PASS F1d: user A reads none of user B''s verification objects';
end $$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- F2. migration 035
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_def text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'smart_productions'
                    and column_name = 'submitted_at' and data_type = 'timestamp with time zone') then
    raise exception 'FAIL F2: smart_productions.submitted_at (timestamptz) is missing';
  end if;
  raise notice 'PASS F2a: smart_productions.submitted_at exists';

  if to_regclass('public.idx_smart_productions_creator_id') is null then
    raise exception 'FAIL F2: idx_smart_productions_creator_id is missing';
  end if;
  raise notice 'PASS F2b: idx_smart_productions_creator_id exists';

  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i
   where i.indexrelid = to_regclass('public.idx_smart_productions_one_per_creator')
     and i.indisunique;
  if v_def is null or v_def not like '%deleted_at IS NULL%' then
    raise exception 'FAIL F2: idx_smart_productions_one_per_creator is missing, not unique or not partial on live rows: %', v_def;
  end if;
  raise notice 'PASS F2c: one live production per creator is enforced by a unique partial index';
end $$;

-- Behaviour: a second live row for the same creator is refused, a deleted one is not.
savepoint f2;
do $$
declare
  a uuid := current_setting('t083.a')::uuid;
  v_cols text;
  v_vals text;
begin
  -- smart_productions differs between prod and dev; give a value to every
  -- NOT NULL column that has no default, and let defaults fill the rest.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(case when c.column_name = 'creator_id' then quote_literal(a) || '::uuid'
                         when c.column_name = 'slug' then quote_literal('t083-' || gen_random_uuid())
                         when c.data_type in ('text', 'character varying') then quote_literal('t083')
                         when c.data_type in ('integer', 'bigint', 'numeric', 'smallint', 'real', 'double precision') then '0'
                         when c.data_type = 'boolean' then 'false'
                         when c.data_type like 'timestamp%' then 'now()'
                         when c.data_type = 'date' then 'current_date'
                         when c.data_type = 'uuid' then 'gen_random_uuid()'
                         when c.data_type = 'ARRAY' then quote_literal('{}')
                         when c.data_type in ('json', 'jsonb') then quote_literal('{}')
                         else 'null' end, ', ' order by c.ordinal_position)
    into v_cols, v_vals
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'smart_productions'
     and c.is_generated = 'NEVER' and c.identity_generation is null
     and (c.is_nullable = 'NO' and c.column_default is null
          or c.column_name in ('creator_id', 'slug'));
  execute format('insert into public.smart_productions (%s) values (%s)', v_cols, v_vals);
end $$;

do $$
begin
  begin
    insert into public.smart_productions
    select (jsonb_populate_record(p, jsonb_build_object('id', gen_random_uuid(),
                                                        'slug', 't083-' || gen_random_uuid()))).*
      from public.smart_productions p
     where p.creator_id = current_setting('t083.a')::uuid;
    raise exception 'FAIL F2: a second live production for one creator was accepted';
  exception when unique_violation then
    raise notice 'PASS F2d: a second live production for one creator is refused';
  end;

  update public.smart_productions set deleted_at = now()
   where creator_id = current_setting('t083.a')::uuid;
  insert into public.smart_productions
  select (jsonb_populate_record(p, jsonb_build_object('id', gen_random_uuid(),
                                                      'slug', 't083-' || gen_random_uuid(),
                                                      'deleted_at', null))).*
    from public.smart_productions p
   where p.creator_id = current_setting('t083.a')::uuid;
  raise notice 'PASS F2e: a new live production is accepted once the old one is deleted';
end $$;
rollback to savepoint f2;

-- ════════════════════════════════════════════════════════════════════════════
-- F3. rls_auto_enable() search_path
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    raise notice 'PASS F3: rls_auto_enable() not present here (nothing to pin)';
  elsif exists (select 1 from pg_proc p, unnest(p.proconfig) c
                 where p.oid = to_regprocedure('public.rls_auto_enable()')
                   and c like 'search_path=%pg_temp%') then
    raise notice 'PASS F3: rls_auto_enable() pins search_path with pg_temp';
  else
    raise exception 'FAIL F3: rls_auto_enable() search_path lacks pg_temp';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F4. prod names of the 077 E4 / E10 policies
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text;
begin
  select string_agg(tablename || ': ' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (('orders', 'Orders: buyer insert'),
                                     ('listings', 'Listings: authenticated insert'),
                                     ('listings', 'Listings: owner update'));
  if v_bad is not null then
    raise exception 'FAIL F4: prod-named open policies still present: %', v_bad;
  end if;
  raise notice 'PASS F4: "Orders: buyer insert", "Listings: authenticated insert" and "Listings: owner update" are gone';
end $$;

rollback;
