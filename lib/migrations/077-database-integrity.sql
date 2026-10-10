-- 077 — Database integrity (Step 2, 2026-10-10)
--
-- WHY
--   A database rebuilt from this repo (scripts/db/rebuild-local.sh) behaved
--   differently from production, and worse, in ways the app depends on:
--     * every gear payment confirmation rolled back (booking_payments CHECK),
--     * nobody could sign up (handle_new_user still inserted profiles.email,
--       a column 048 drops),
--     * anyone holding the public key could read every profile row in full
--       (ID document hash, phone, address, verification paths) and read,
--       change or delete every crew request, because 036 dropped production's
--       policy NAMES and the base schema created the same policies under
--       other names.
--   Separately, on every environment, approving an ID check made ANY person
--   with a display name "available for hire" and gave them a crew slug
--   (renters too), and public_profiles listed every non-suspended account.
--
-- WHAT (each item is proved by 077-database-integrity.test.sql)
--   A. booking_payments.status has ONE word for a captured payment:
--      'succeeded'. Every writer already uses it (fulfil.ts, mark-paid,
--      the PayFast webhook, confirm_rental_payment in 070) and every reader
--      filters on it (rental/charges.ts, the invariants cron, the booking
--      page). The base CHECK allowed only 'complete', which nothing writes.
--      Existing 'complete' rows are rewritten to 'succeeded'; a BEFORE trigger
--      maps a late 'complete' from an old build to 'succeeded'; the CHECK
--      becomes pending | succeeded | failed | refunded.
--      (The audit's other item, bookings.payment_status = 'failed', is no
--      longer written: fulfil.ts records a failed attempt as a history event
--      instead. Nothing to change in the database.)
--   B. handle_new_user is production's body: insert (id) only, on conflict do
--      nothing, SECURITY DEFINER, pinned search_path, not executable by
--      clients. The trigger is created only if it is missing; one pointing
--      elsewhere is reported, never replaced (auth.users is shared, see
--      docs/operations/database-isolation.md).
--   C. "Who is a creator" is decided in one place, profile_is_creator(): the
--      person finished creator onboarding, or has specializations, a creator
--      bio, a portfolio project, or was featured by the studio.
--      - admin_approve_verification verifies anyone but turns on
--        available_for_hire and assigns a crew slug ONLY for creators. It
--        keeps an existing slug (links stay valid) and finds a free one
--        instead of failing on profiles_crew_slug_key.
--      - public_profiles lists only non-suspended creators and owners of
--        published community gear or marketplace listings (whose names the
--        listing pages show). Same columns, order and types as 049/075;
--        portfolio_projects is still masked until verified (075).
--   D. is_admin() treats an empty request.jwt.claims ('' — what a pooled
--      connection or a test that clears claims leaves) like a missing one,
--      instead of raising "invalid input syntax for type json". Same answer
--      otherwise.
--   E. Defects found while documenting access control (docs/database/
--      access-control.md). Each is a no-op where production already differs:
--      E1. profiles: drop the base schema's "Public can view profiles"
--          (USING true, every column to anon), "Users can update own
--          profile" and "Users can insert own profile". 036's
--          owner/admin policies and 067's column grants remain.
--      E2. crew_requests: "Admins can manage crew requests" was USING (true)
--          for everyone; it now checks is_admin(). "Anyone can submit crew
--          request" (WITH CHECK true) is dropped: nothing inserts crew
--          requests from a client (createCrewTools is unused). A client may
--          read the requests sent under their own e-mail, which the
--          dashboard pages already query.
--      E3. content_embeddings (001-pgvector-gemini) had RLS off: anon could
--          rewrite what RAG answers from. RLS on, read kept for everyone
--          (match_content is SECURITY INVOKER and the studio page calls it
--          as the visitor), writes server-only.
--      E4. orders: drop "Buyers can create orders"; no client creates orders,
--          and a buyer could invent one naming any seller with any total.
--      E5. Grants: anon loses INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--          TRIGGER on every ThabangVision table (no policy lets anon write
--          after E2). authenticated loses TRUNCATE/REFERENCES/TRIGGER, and
--          INSERT/UPDATE/DELETE wherever no policy for that command reaches
--          it, a service-role-only policy not counting (RLS refused those
--          writes already; this removes the reliance on RLS alone). Other
--          apps' tables in public are not touched.
--      E6. Functions: every SECURITY DEFINER function in public gets pg_temp
--          last in its search_path (other apps' kb_/blog_/apps_ functions
--          excluded); trigger functions and caller_owns_rental are no longer
--          executable by anon; three invoker trigger functions get a pinned
--          search_path.
--      E7. onboarding_progress and portfolio_analysis had RLS on and no
--          policy, so the onboarding page's progress upsert and the portfolio
--          agent's analysis insert (both as the signed-in creator) were
--          silently refused. Own-row policies added.
--      E8. unmet_demand_summary: no grants to anon/authenticated (service
--          only, as 057 intends).
--      E9. reviews.reviewer_email was readable by anyone for every published
--          review ("Public can view published reviews" + a table-wide
--          SELECT grant). Clients may now select every column except it; no
--          code reads it.
--      E10. listings (marketplace): any signed-in user could INSERT a row
--          already published (the insert policy checked only user_id) or
--          UPDATE their own to is_published / is_featured. Published listings
--          feed the sitemap, search and Ubunye's system prompt, so this was
--          an unreviewed path into all three. Nothing in the app writes
--          listings with a user session (createListing/updateListing have no
--          callers); the owner INSERT and UPDATE policies are dropped. Owners
--          keep DELETE of their own rows; admins keep everything.
--
-- SAFE TO RE-RUN. Additive except where noted: A rewrites 'complete' rows,
-- C narrows public_profiles, E drops the policies named above and revokes
-- grants no policy uses. Rollback at the bottom.
--
-- APPLY: dev first, then run 077-database-integrity.test.sql and
-- rls-coverage.test.sql (both end in ROLLBACK). Production after review.
-- Order: after 076 (it reads tables from 070-076; missing ones are skipped).

begin;

-- Other apps' tables that share production's public schema (BLOCKED
-- isolation, docs/operations/database-isolation.md). Never touched here.
create temporary table _tv077_foreign (name text primary key) on commit drop;
insert into _tv077_foreign values
  ('apps'), ('kb_documents'), ('kb_chunks'), ('kb_conversations'), ('kb_messages'),
  ('blog_comments'), ('blog_subscribers');

-- ═══ D. is_admin() ═════════════════════════════════════════════════════════
-- First, because the policies below call it.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role') = 'admin',
      false
    )
    or exists (
      select 1 from public.profiles where id = auth.uid() and role = 'admin'
    );
$$;
-- Execute stays with anon/authenticated on purpose: RLS policies granted to
-- `public` call it as the querying role (043). It reveals only the caller's
-- own admin flag.

-- ═══ A. booking_payments.status: one vocabulary ════════════════════════════
do $$
declare n integer;
begin
  select count(*) into n from public.booking_payments where status = 'complete';
  raise notice '077 A: % booking_payments row(s) say ''complete''; rewritten to ''succeeded''', n;
end $$;

create or replace function public.booking_payments_canonical_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- 'complete' was the base schema's word; nothing in this repo writes it any
  -- more. An older build that still does is mapped instead of refused.
  if new.status = 'complete' then
    new.status := 'succeeded';
  end if;
  return new;
end;
$$;
revoke all on function public.booking_payments_canonical_status() from public, anon, authenticated;

drop trigger if exists booking_payments_canonical_status on public.booking_payments;
create trigger booking_payments_canonical_status
  before insert or update of status on public.booking_payments
  for each row execute function public.booking_payments_canonical_status();

alter table public.booking_payments drop constraint if exists booking_payments_status_check;
update public.booking_payments set status = 'succeeded' where status = 'complete';
alter table public.booking_payments add constraint booking_payments_status_check
  check (status in ('pending', 'succeeded', 'failed', 'refunded'));

comment on column public.booking_payments.status is
  'pending (checkout created) | succeeded (money captured) | failed | refunded. ''complete'' is mapped to succeeded by trigger (077).';

-- ═══ B. handle_new_user: production's body ═════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only the id: every other column takes its default, which is exactly what
  -- 067's INSERT rule allows (role user, unverified, not suspended, ...).
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
declare v_fn regproc;
begin
  select tgfoid::regproc into v_fn
    from pg_trigger
   where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal;
  if v_fn is null then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
    raise notice '077 B: created on_auth_user_created';
  elsif v_fn <> 'public.handle_new_user'::regproc then
    raise warning '077 B: on_auth_user_created calls %, not public.handle_new_user. Left as is; check by hand.', v_fn;
  end if;
end $$;

-- ═══ C. Who is a creator, who is public ═══════════════════════════════════
create or replace function public.profile_is_creator(p public.profiles)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Signals only a creator leaves: finishing creator onboarding (/onboarding,
  -- /api/onboarding/complete), choosing specializations or writing a creator
  -- bio (onboarding or Creator settings), adding a portfolio project, or
  -- being featured by the studio. Never available_for_hire: before 077 the
  -- ID approval switched it on for renters too.
  select p.onboarding_completed_at is not null
      or coalesce(cardinality(p.specializations), 0) > 0
      or nullif(btrim(coalesce(p.crew_bio, '')), '') is not null
      or coalesce(p.crew_featured, false)
      or (jsonb_typeof(p.portfolio_projects) = 'array' and jsonb_array_length(p.portfolio_projects) > 0);
$$;
comment on function public.profile_is_creator(public.profiles) is
  'True when this profile belongs to a creator (077). Used by admin_approve_verification and public_profiles.';
-- Pure function of its argument; public_profiles calls it as the reader, so
-- the API roles must be able to execute it.
revoke all on function public.profile_is_creator(public.profiles) from public;
grant execute on function public.profile_is_creator(public.profiles) to anon, authenticated, service_role;

create or replace function public.admin_approve_verification(p_user_id uuid, p_crew_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_creator boolean := false;
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.profiles set
    verification_status = 'verified',
    is_verified = true,
    verification_reviewed_at = now()
  where id = p_user_id
  returning * into v_profile;

  if found then
    v_creator := public.profile_is_creator(v_profile);
  end if;

  -- Only a creator becomes bookable. A renter's ID check proves who they
  -- are; it does not put them in the creator directory.
  if v_creator and nullif(btrim(coalesce(v_profile.display_name, '')), '') is not null then
    if v_profile.crew_slug is not null and p_crew_slug is null then
      v_slug := v_profile.crew_slug;   -- keep the public URL stable on re-approval
    else
      v_base := trim(both '-' from lower(regexp_replace(coalesce(p_crew_slug, v_profile.display_name), '[^a-zA-Z0-9]+', '-', 'g')));
      if v_base = '' then v_base := 'creator'; end if;
      v_slug := v_base;
      while exists (select 1 from public.profiles where crew_slug = v_slug and id <> p_user_id) loop
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n;
      end loop;
    end if;

    update public.profiles set
      available_for_hire = true,
      crew_slug = v_slug
    where id = p_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'email', (select email from auth.users where id = p_user_id),
    'display_name', v_profile.display_name,
    'creator', v_creator
  );
end;
$$;
revoke all on function public.admin_approve_verification(uuid, text) from public, anon;
grant execute on function public.admin_approve_verification(uuid, text) to authenticated, service_role;

create or replace view public.public_profiles as
  select id, display_name, avatar_url, bio, skills, social_links, location,
         specializations, crew_slug, crew_bio, years_experience, crew_featured,
         hourly_rate, available_for_hire,
         case when verification_status = 'verified' then portfolio_projects end as portfolio_projects,
         is_verified, verification_status, created_at
  from public.profiles p
  where p.is_suspended is not true
    and (
      public.profile_is_creator(p)
      -- Owners of live community gear: the listing page names them (getRentalOwner).
      or exists (select 1 from public.smart_rentals r
                  where r.owner_id = p.id and r.owner_type = 'community'
                    and r.is_published and r.deleted_at is null)
      -- Owners of live marketplace listings, shown through the same page.
      or exists (select 1 from public.listings l
                  where l.user_id = p.id and l.is_published and l.deleted_at is null)
    );

alter view public.public_profiles set (security_invoker = false);

comment on view public.public_profiles is
  'Public directory of creators and of owners of live listings (077). SECURITY DEFINER by design: it is the column filter over profiles, since RLS cannot restrict columns. Excludes suspended accounts (049) and everyone else (renters); portfolio_projects only for verified creators (075). Never add a column here without checking it is safe for anonymous readers.';

revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.profiles p
   where p.available_for_hire is true and not public.profile_is_creator(p);
  if n > 0 then
    raise notice '077 C: % profile(s) are available_for_hire without any creator signal (set by the old approval). Not changed here; see docs/database/README.md "After 077".', n;
  end if;
end $$;

-- ═══ E1. profiles: base-schema policies production never had ═════════════
drop policy if exists "Public can view profiles" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

-- ═══ E2. crew_requests ═════════════════════════════════════════════════════
drop policy if exists "Admins can manage crew requests" on public.crew_requests;
create policy "Admins can manage crew requests" on public.crew_requests
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Anyone can submit crew request" on public.crew_requests;
drop policy if exists "Clients can view own requests" on public.crew_requests;
create policy "Clients can view own requests" on public.crew_requests
  for select to authenticated
  using (client_email is not null and lower(client_email) = lower(auth.jwt() ->> 'email'));

-- ═══ E3. content_embeddings ════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.content_embeddings') is not null then
    alter table public.content_embeddings enable row level security;
    drop policy if exists "Anyone reads content embeddings" on public.content_embeddings;
    create policy "Anyone reads content embeddings" on public.content_embeddings
      for select using (true);
    revoke insert, update, delete on public.content_embeddings from anon, authenticated;
  end if;
end $$;

-- ═══ E4. orders ════════════════════════════════════════════════════════════
drop policy if exists "Buyers can create orders" on public.orders;

-- ═══ E10. listings ═════════════════════════════════════════════════════════
drop policy if exists "Users can create own listings" on public.listings;
drop policy if exists "Users can update own listings" on public.listings;

-- ═══ E7. onboarding_progress / portfolio_analysis own rows ════════════════
do $$
begin
  if to_regclass('public.onboarding_progress') is not null then
    drop policy if exists "Creators manage own onboarding progress" on public.onboarding_progress;
    create policy "Creators manage own onboarding progress" on public.onboarding_progress
      for all to authenticated
      using (creator_id = auth.uid()) with check (creator_id = auth.uid());
  end if;
  if to_regclass('public.portfolio_analysis') is not null then
    drop policy if exists "Creators read own portfolio analysis" on public.portfolio_analysis;
    create policy "Creators read own portfolio analysis" on public.portfolio_analysis
      for select to authenticated using (creator_id = auth.uid());
    drop policy if exists "Creators add own portfolio analysis" on public.portfolio_analysis;
    create policy "Creators add own portfolio analysis" on public.portfolio_analysis
      for insert to authenticated with check (creator_id = auth.uid());
  end if;
end $$;

-- ═══ E5. Table grants ══════════════════════════════════════════════════════
do $$
declare
  t record;
  v_cmd text;
  v_revoked text[] := '{}';
begin
  for t in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in (select name from _tv077_foreign)
     order by c.relname
  loop
    -- anon never writes a table directly (every anon write is an API route
    -- using the service role).
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t.relname);
    -- Nobody needs these through the API.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
    -- authenticated keeps a write privilege only where a policy uses it.
    foreach v_cmd in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', t.oid, v_cmd)
         and not exists (
           select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = t.relname
              and p.cmd in (v_cmd, 'ALL')
              and p.roles && array['public', 'authenticated']::name[]
              and coalesce(p.qual, '') <> 'false'
              -- "auth.role() = 'service_role'" policies admit nobody but the
              -- service role, which bypasses RLS anyway.
              and not (coalesce(p.qual, '') in ('', '(auth.role() = ''service_role''::text)')
                       and coalesce(p.with_check, '') in ('', '(auth.role() = ''service_role''::text)')))
      then
        execute format('revoke %s on public.%I from authenticated', v_cmd, t.relname);
        v_revoked := v_revoked || (t.relname || ':' || v_cmd);
      end if;
    end loop;
  end loop;
  raise notice '077 E5: authenticated write privileges no policy used, now revoked: %', array_to_string(v_revoked, ', ');
end $$;

-- ═══ E8. unmet_demand_summary ══════════════════════════════════════════════
do $$
begin
  if to_regclass('public.unmet_demand_summary') is not null then
    revoke all on public.unmet_demand_summary from public, anon, authenticated;
  end if;
end $$;

-- ═══ E9. reviews.reviewer_email ═══════════════════════════════════════════
do $$
declare v_cols text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reviews' and column_name = 'reviewer_email') then
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'reviews' and column_name <> 'reviewer_email';
    revoke select on public.reviews from anon, authenticated;
    execute format('grant select (%s) on public.reviews to anon, authenticated', v_cols);
  end if;
end $$;

-- ═══ E6. Function hygiene ══════════════════════════════════════════════════
do $$
declare
  f record;
  v_path text;
begin
  -- SECURITY DEFINER: keep the pinned path, put pg_temp last so a temporary
  -- object can never shadow a name the function uses.
  for f in
    select p.oid::regprocedure as sig, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname !~ '^(kb_|match_kb|blog_|apps_)'
  loop
    select substr(c, length('search_path=') + 1) into v_path
      from unnest(f.proconfig) c where c like 'search_path=%';
    if v_path is null then
      execute format('alter function %s set search_path = public, pg_temp', f.sig);
    elsif v_path !~ 'pg_temp' then
      execute format('alter function %s set search_path = %s, pg_temp', f.sig, v_path);
    end if;
  end loop;

  -- Trigger functions run as triggers only; nobody needs EXECUTE on them.
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
       and p.proname !~ '^(kb_|match_kb|blog_|apps_)'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;

  -- Invoker trigger functions with no search_path (D5 in the 2026-10-06 audit).
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and not p.prosecdef and p.proconfig is null
       and p.proname in ('guard_phone_verified', 'ledger_refuse_change', 'service_booking_events_append_only')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;

  if to_regprocedure('public.caller_owns_rental(uuid)') is not null then
    revoke all on function public.caller_owns_rental(uuid) from public, anon;
    grant execute on function public.caller_owns_rental(uuid) to authenticated, service_role;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ═══ ROLLBACK (run by hand, in one transaction) ════════════════════════════
-- Read before running: undoing A makes every gear payment confirmation fail
-- again; undoing E1/E2 re-opens every profile and crew request to anon.
--
-- begin;
-- -- A (keeps existing rows valid by accepting both words)
-- drop trigger if exists booking_payments_canonical_status on public.booking_payments;
-- drop function if exists public.booking_payments_canonical_status();
-- alter table public.booking_payments drop constraint if exists booking_payments_status_check;
-- alter table public.booking_payments add constraint booking_payments_status_check
--   check (status in ('pending', 'complete', 'succeeded', 'failed', 'refunded'));
-- -- B: nothing to undo (the 006 body cannot run since 048 dropped profiles.email).
-- -- C: re-run lib/migrations/075-public-profiles-mask-unverified-portfolio.sql (view)
-- --    and the admin_approve_verification body from 033 (then re-apply 043's grants),
-- --    then: drop function if exists public.profile_is_creator(public.profiles);
-- -- D: the is_admin() body from 033 (only the nullif differs).
-- -- E1 (re-opens profiles to anon; do not, unless restoring a known state):
-- --   create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
-- -- E2: drop policy "Clients can view own requests" on public.crew_requests;
-- --   drop policy "Admins can manage crew requests" on public.crew_requests;
-- --   create policy "Admins can manage crew requests" on public.crew_requests for all using (true);  -- the 007 state
-- -- E3: alter table public.content_embeddings disable row level security;
-- --     drop policy if exists "Anyone reads content embeddings" on public.content_embeddings;
-- -- E4: create policy "Buyers can create orders" on public.orders for insert with check (auth.uid() = buyer_id);
-- -- E5: grant insert, update, delete on public.<table> to anon / authenticated as needed
-- --     (the NOTICE from the apply lists what authenticated lost).
-- -- E6: harmless; nothing to undo.
-- -- E7: drop policy "Creators manage own onboarding progress" on public.onboarding_progress;
-- --     drop policy "Creators read own portfolio analysis" on public.portfolio_analysis;
-- --     drop policy "Creators add own portfolio analysis" on public.portfolio_analysis;
-- -- E8: grant select on public.unmet_demand_summary to anon, authenticated;
-- -- E9: grant select on public.reviews to anon, authenticated;
-- -- E10: create policy "Users can create own listings" on public.listings for insert with check (auth.uid() = user_id);
-- --      create policy "Users can update own listings" on public.listings for update using (auth.uid() = user_id);
-- --      grant insert, update on public.listings to authenticated;
-- commit;
