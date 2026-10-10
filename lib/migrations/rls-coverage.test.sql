-- Access-control coverage for the whole public schema. Not tied to one
-- migration: run it after any migration (scripts/db/run-sql-tests.sh runs it
-- with the others). Read-only; wrapped in a transaction that rolls back.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/rls-coverage.test.sql
--
-- It FAILS when:
--   1. a public table has row level security off (allow-list below, with reason);
--   2. a write policy (INSERT/UPDATE/DELETE/ALL) is literally `true` for any
--      role other than service_role;
--   3. a SELECT policy is literally `true` on a table not in the allow-list;
--   4. a SECURITY DEFINER function has no search_path, or one without pg_temp;
--   5. anon can execute a SECURITY DEFINER function not in the allow-list;
--   6. anon holds INSERT/UPDATE/DELETE/TRUNCATE on a table or view;
--   7. authenticated holds TRUNCATE on a table;
--   8. a view readable by anon or authenticated bypasses RLS
--      (security_invoker off) and is not in the allow-list.
-- A new table created by a migration gets Supabase's default grants (ALL to
-- anon and authenticated), so check 6 fails until the migration revokes
-- anon's writes, which is the point: every table states who may write it.
--
-- Tables of other apps that share production's public schema are skipped
-- (docs/operations/database-isolation.md); they do not exist in a database
-- rebuilt from this repo.

begin;

create temporary table _rls_skip (name text primary key) on commit drop;
insert into _rls_skip values
  ('apps'), ('kb_documents'), ('kb_chunks'), ('kb_conversations'), ('kb_messages'),
  ('blog_comments'), ('blog_subscribers');

-- Allow-lists. Every entry needs a reason.
create temporary table _rls_allow (kind text, name text, reason text, primary key (kind, name)) on commit drop;
insert into _rls_allow values
  -- (no table may have RLS off today; add ('rls_off', '<table>', '<reason>') only with a reason)
  ('select_true', 'feature_flags', 'Feature flags are public configuration the site reads before sign-in (030).'),
  ('select_true', 'content_embeddings', 'Embeddings of published catalogue text; match_content runs as the visitor (077 E3).'),
  ('definer_anon', 'is_admin', 'Called by RLS policies granted to public, which run as the querying role (043). Reveals only the caller''s own admin flag.'),
  ('definer_view', 'public_profiles', 'The column filter over profiles: RLS cannot restrict columns (049, 075, 077).');

do $$
declare
  v_bad text;
begin
  -- 1. RLS on everywhere
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     and c.relname not in (select name from _rls_skip)
     and c.relname not in (select name from _rls_allow where kind = 'rls_off');
  if v_bad is not null then raise exception 'FAIL 1: RLS is off on: %', v_bad; end if;
  raise notice 'PASS 1: row level security is on for every public table';

  -- 2. No `true` write policy
  select string_agg(format('%s."%s" (%s)', tablename, policyname, cmd), ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and permissive = 'PERMISSIVE'
     and roles <> array['service_role']::name[]
     and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')
     and tablename not in (select name from _rls_skip);
  if v_bad is not null then raise exception 'FAIL 2: write policies open to everyone: %', v_bad; end if;
  raise notice 'PASS 2: no write policy is `true` for a client role';

  -- 3. `true` read policies only where allowed
  select string_agg(format('%s."%s"', tablename, policyname), ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and btrim(coalesce(qual, '')) = 'true'
     and roles <> array['service_role']::name[]
     and tablename not in (select name from _rls_skip)
     and tablename not in (select name from _rls_allow where kind = 'select_true');
  if v_bad is not null then raise exception 'FAIL 3: read-everything policies not in the allow-list: %', v_bad; end if;
  raise notice 'PASS 3: read-everything policies only on: %',
    (select string_agg(name, ', ') from _rls_allow where kind = 'select_true');

  -- 4. SECURITY DEFINER functions pin search_path with pg_temp
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname !~ '^(kb_|match_kb|blog_|apps_)'
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%');
  if v_bad is not null then raise exception 'FAIL 4: SECURITY DEFINER without a pinned search_path (incl. pg_temp): %', v_bad; end if;
  raise notice 'PASS 4: every SECURITY DEFINER function pins search_path with pg_temp';

  -- 5. anon executes no SECURITY DEFINER function outside the allow-list
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname !~ '^(kb_|match_kb|blog_|apps_)'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select name from _rls_allow where kind = 'definer_anon');
  if v_bad is not null then raise exception 'FAIL 5: anon can execute SECURITY DEFINER: %', v_bad; end if;
  raise notice 'PASS 5: anon executes only these SECURITY DEFINER functions: %',
    (select string_agg(name, ', ') from _rls_allow where kind = 'definer_anon');

  -- 6. anon never writes directly
  select string_agg(distinct table_name || ':' || privilege_type, ', ') into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     and table_name not in (select name from _rls_skip);
  if v_bad is not null then raise exception 'FAIL 6: anon/PUBLIC write grants: %', v_bad; end if;
  raise notice 'PASS 6: anon holds no INSERT/UPDATE/DELETE/TRUNCATE on any table or view';

  -- 7. nobody truncates through the API
  select string_agg(distinct table_name, ', ') into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
     and table_name not in (select name from _rls_skip);
  if v_bad is not null then raise exception 'FAIL 7: authenticated can TRUNCATE: %', v_bad; end if;
  raise notice 'PASS 7: authenticated holds no TRUNCATE';

  -- 8. client-readable views that bypass RLS
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
     and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)
     and c.relname not in (select name from _rls_skip)
     and c.relname not in (select name from _rls_allow where kind = 'definer_view');
  if v_bad is not null then raise exception 'FAIL 8: client-readable views that bypass RLS: %', v_bad; end if;
  raise notice 'PASS 8: the only client-readable view that bypasses RLS is: %',
    (select string_agg(name, ', ') from _rls_allow where kind = 'definer_view');
end $$;

select 'ALL RLS COVERAGE CHECKS PASSED' as result;
rollback;
