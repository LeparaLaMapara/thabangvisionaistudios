-- 086: database performance pass. Same access, less work per row.
--
-- From the October 2026 performance audit (findings 1 to 4, plus retention).
-- Nothing here changes who can read or write what, with one deliberate
-- exception in B (three admin read policies now use is_admin()).
--
--   A. Four "Service role full access" policies are dropped. They are
--      `auth.role() = 'service_role'` for every role; service_role bypasses
--      RLS anyway, so they never granted anything, but anon and signed-in
--      users evaluated them on every row. Found by definition, not by name.
--   B. chat_conversations, chat_messages and welcome_messages had admin read
--      policies that looked up profiles.role = 'admin' themselves. They now
--      call is_admin() like every other admin policy, so a suspended admin
--      no longer reads every chat (079's rule), and an admin by JWT claim
--      whose role was never managed reads them as they read everything else.
--   C. Every ThabangVision policy that called auth.uid(), auth.jwt(),
--      is_admin() or current_user_is_suspended() bare now calls it as
--      (select ...). Postgres then runs it once per query (an initPlan)
--      instead of once per row; is_admin() is SECURITY DEFINER, so it is
--      never inlined and each call was a profiles lookup. The policies keep
--      their names, roles, commands and logic: ALTER POLICY changes only the
--      expressions, and each rewrite is checked against the old expression
--      (the same text once the (select ...) wrappers are removed) or the
--      whole migration stops. Production and dev name some policies
--      differently; the list holds both names, and a name this database
--      does not have is skipped with a NOTICE. At the end, no ThabangVision
--      policy may call those functions bare, or the migration stops. One
--      exception: profiles' three read policies stay bare (see C, profiles),
--      or a user could no longer update their own profile.
--   D. Indexes for real query patterns (daily job notification dedupe,
--      notification list, crew_requests by e-mail, chat history) and for
--      foreign keys on tables that grow. Created only when no index with the
--      same definition exists, whatever its name.
--   E. Redundant indexes dropped, found by definition: an exact copy of
--      another index on the same table (keeping a constraint's index, then a
--      unique one), and three indexes another index fully covers.
--   F. prune_log_retention(): batched deletes of old log rows for the daily
--      maintenance job (day counts in lib/constants.ts, STUDIO.retention).
--      Never chat history, never the ledger, never an unfinished payment
--      event.
--
-- One transaction; safe to run more than once (a second run changes
-- nothing). Run as postgres, then its test, then rls-coverage.test.sql.
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f lib/migrations/086-db-performance.sql

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- Policy expressions below name tables unqualified, as pg_policies prints them.
set local search_path = public, extensions, pg_temp;

-- ThabangVision's tables (production's public schema also holds other apps').
create temporary table _tv086_tables (name text primary key) on commit drop;
insert into _tv086_tables values
  ('agent_actions'), ('ai_budget_alerts'), ('ai_token_usage'), ('banking_details'),
  ('booking_payments'), ('booking_status_history'), ('bookings'), ('bug_reports'), ('careers'),
  ('cart_items'), ('chat_conversations'), ('chat_faqs'), ('chat_messages'), ('consent_records'),
  ('content_embeddings'), ('crew_requests'), ('delivery_addresses'),
  ('delivery_cancelled_order_notes'), ('delivery_custody_events'), ('delivery_dispatch_intents'),
  ('delivery_events'), ('delivery_incidents'), ('delivery_manual_tasks'), ('delivery_proofs'),
  ('delivery_provider_events'), ('delivery_quotes'), ('delivery_reconciliation'),
  ('delivery_shipments'), ('dispute_comments'), ('disputes'), ('equipment_bookings'),
  ('feature_flag_events'), ('feature_flags'), ('invoices'), ('ledger_journals'), ('ledger_lines'),
  ('listing_private'), ('listings'), ('moderation_log'), ('newsletter_subscribers'),
  ('notification_outbox'), ('notifications'), ('onboarding_progress'), ('ops_check_runs'),
  ('ops_findings'), ('orders'), ('owner_payouts'), ('payment_confirmations'), ('payment_events'),
  ('payment_reference_mismatches'), ('phone_codes'), ('platform_events'), ('portfolio_analysis'),
  ('portfolio_tag_corrections'), ('press'), ('production_categories'), ('profiles'),
  ('public_profiles'), ('rate_limits'), ('refund_obligations'), ('rental_blocks'),
  ('rental_escalations'), ('rental_payment_intents'), ('reviews'), ('security_audit_log'),
  ('service_booking_events'), ('smart_productions'), ('smart_rentals'), ('subscription_plans'),
  ('subscriptions'), ('ubunye_usage'), ('unmet_demand'), ('unmet_demand_summary'),
  ('welcome_messages');

-- A policy expression with the (select f()) wrappers removed, for comparing
-- a rewritten policy with the one it replaces.
create function pg_temp.tv086_bare(t text) returns text
language sql immutable as $fn$
  select regexp_replace(t,
    '\( SELECT (auth\.uid|auth\.jwt|auth\.role|is_admin|current_user_is_suspended)\(\) AS [a-z_]+\)',
    '\1()', 'g')
$fn$;

-- True when an expression still calls one of the functions bare.
create function pg_temp.tv086_has_bare(t text) returns boolean
language sql immutable as $fn$
  select coalesce(regexp_replace(t,
    '\( SELECT (auth\.uid|auth\.jwt|auth\.role|is_admin|current_user_is_suspended)\(\) AS [a-z_]+\)',
    '', 'g') ~ '(auth\.(uid|jwt|role)|(^|[^a-z_.])is_admin|(^|[^a-z_.])current_user_is_suspended)\(\)', false)
$fn$;

-- Rewrite one policy's expressions in place and prove it means the same.
create function pg_temp.tv086_rewrite(p_table text, p_policy text, p_using text, p_check text)
returns void language plpgsql as $fn$
declare
  o record;
  n record;
begin
  select qual, with_check into o
    from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_policy;
  if not found then
    raise notice '086 C: no policy "%" on % here (the other database''s name), skipped', p_policy, p_table;
    return;
  end if;
  if (o.qual is null) <> (p_using is null) or (o.with_check is null) <> (p_check is null) then
    raise exception '086 C: policy "%" on % has a different shape here (USING %, WITH CHECK %)',
      p_policy, p_table, o.qual is not null, o.with_check is not null;
  end if;

  execute format('alter policy %I on public.%I', p_policy, p_table)
       || coalesce(' using (' || p_using || ')', '')
       || coalesce(' with check (' || p_check || ')', '');

  select qual, with_check into n
    from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_policy;
  if pg_temp.tv086_bare(n.qual) is distinct from pg_temp.tv086_bare(o.qual)
     or pg_temp.tv086_bare(n.with_check) is distinct from pg_temp.tv086_bare(o.with_check) then
    raise exception E'086 C: policy "%" on % would change meaning.\nold USING: %\nnew USING: %\nold CHECK: %\nnew CHECK: %',
      p_policy, p_table, o.qual, n.qual, o.with_check, n.with_check;
  end if;
end
$fn$;

-- Create an index unless one with exactly this definition already exists
-- (production and dev name some indexes differently).
create function pg_temp.tv086_ensure_index(p_name text, p_table text, p_def text)
returns void language plpgsql as $fn$
declare
  v_have text;
begin
  if to_regclass('public.' || quote_ident(p_table)) is null then
    raise notice '086 D: no table %, index % skipped', p_table, p_name;
    return;
  end if;
  select i.relname into v_have
    from pg_index x join pg_class i on i.oid = x.indexrelid
   where x.indrelid = ('public.' || quote_ident(p_table))::regclass and x.indisvalid
     and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = p_def
   limit 1;
  if v_have is not null then
    raise notice '086 D: % already has % (%)', p_table, p_def, v_have;
    return;
  end if;
  if to_regclass('public.' || quote_ident(p_name)) is not null then
    raise exception '086 D: the name % is taken by another index; % % not created', p_name, p_table, p_def;
  end if;
  execute format('create index %I on public.%I using ', p_name, p_table) || p_def;
  if not exists (select 1 from pg_index x
                  where x.indexrelid = ('public.' || quote_ident(p_name))::regclass
                    and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = p_def) then
    raise exception '086 D: % on % does not read back as %', p_name, p_table, p_def;
  end if;
  raise notice '086 D: created % on % %', p_name, p_table, p_def;
end
$fn$;

-- Drop every plain index on p_table defined as p_covered, but only while an
-- index defined as p_covering exists on the same table.
create function pg_temp.tv086_drop_covered(p_table text, p_covered text, p_covering text)
returns void language plpgsql as $fn$
declare
  r record;
begin
  if to_regclass('public.' || quote_ident(p_table)) is null then return; end if;
  if not exists (select 1 from pg_index x
                  where x.indrelid = ('public.' || quote_ident(p_table))::regclass and x.indisvalid
                    and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = p_covering) then
    raise notice '086 E2: % has no % index, kept %', p_table, p_covering, p_covered;
    return;
  end if;
  for r in
    select i.relname
      from pg_index x join pg_class i on i.oid = x.indexrelid
     where x.indrelid = ('public.' || quote_ident(p_table))::regclass
       and not x.indisunique and not x.indisprimary and not x.indisreplident
       and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid)
       and regexp_replace(pg_get_indexdef(x.indexrelid), '^.*? USING ', '') = p_covered
  loop
    execute format('drop index public.%I', r.relname);
    raise notice '086 E2: dropped % on % (%), covered by %', r.relname, p_table, p_covered, p_covering;
  end loop;
end
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. No-op "service role" policies
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
begin
  for r in
    select p.tablename, p.policyname
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('ai_budget_alerts', 'ai_token_usage', 'chat_faqs', 'ubunye_usage')
       and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL' and p.roles = array['public']::name[]
       and pg_temp.tv086_bare(p.qual) = '(auth.role() = ''service_role''::text)'
       and (p.with_check is null or pg_temp.tv086_bare(p.with_check) = '(auth.role() = ''service_role''::text)')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    raise notice '086 A: dropped "%" on % (service_role bypasses RLS; it granted nothing)', r.policyname, r.tablename;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. Admin read policies that looked up profiles themselves -> is_admin()
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
begin
  for r in
    select p.tablename, p.policyname
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('chat_conversations', 'chat_messages', 'welcome_messages')
       and p.cmd = 'SELECT' and p.with_check is null
       and pg_temp.tv086_bare(p.qual) ~ '^\(EXISTS \( SELECT 1\s+FROM profiles( p)?\s+WHERE \(\((profiles|p)\.id = auth\.uid\(\)\) AND \((profiles|p)\.role = ''admin''::text\)\)\)\)$'
  loop
    execute format('alter policy %I on public.%I using ((select public.is_admin()))', r.policyname, r.tablename);
    raise notice '086 B: "%" on % now uses is_admin()', r.policyname, r.tablename;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. (select auth.uid()) and friends: once per query, not once per row
-- ════════════════════════════════════════════════════════════════════════════
-- Generated from pg_policies on production and dev (2026-10-13, both at 084),
-- then read. "prod name only" / "dev name only": the same rule under the
-- other database's name; skipped where absent.

-- agent_actions
select pg_temp.tv086_rewrite('agent_actions', 'Own agent actions',
  $p$(user_id = (select auth.uid()))$p$,
  null);

-- banking_details
select pg_temp.tv086_rewrite('banking_details', 'Users can insert own banking details',
  null,
  $p$(((select auth.uid()) = user_id) AND (NOT (select public.current_user_is_suspended())))$p$);
select pg_temp.tv086_rewrite('banking_details', 'Users can read own banking details',
  $p$((select auth.uid()) = user_id)$p$,
  null);
select pg_temp.tv086_rewrite('banking_details', 'Users can update own banking details',
  $p$((select auth.uid()) = user_id)$p$,
  $p$(((select auth.uid()) = user_id) AND (NOT (select public.current_user_is_suspended())))$p$);

-- booking_payments
select pg_temp.tv086_rewrite('booking_payments', 'Admins can manage booking payments',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('booking_payments', 'BookingPayments: owner read via booking',  -- prod name only
  $p$(booking_id IN ( SELECT equipment_bookings.id
   FROM equipment_bookings
  WHERE (equipment_bookings.user_id = (select auth.uid()))))$p$,
  null);
select pg_temp.tv086_rewrite('booking_payments', 'Users can view own booking payments',  -- dev name only
  $p$(EXISTS ( SELECT 1
   FROM equipment_bookings eb
  WHERE ((eb.id = booking_payments.booking_id) AND (eb.user_id = (select auth.uid())))))$p$,
  null);

-- booking_status_history
select pg_temp.tv086_rewrite('booking_status_history', 'Own booking history',
  $p$((select public.is_admin()) OR (EXISTS ( SELECT 1
   FROM equipment_bookings b
  WHERE ((b.id = booking_status_history.booking_id) AND (b.user_id = (select auth.uid()))))))$p$,
  null);

-- bookings
select pg_temp.tv086_rewrite('bookings', 'Clients view own bookings',
  $p$((select auth.uid()) = client_id)$p$,
  null);
select pg_temp.tv086_rewrite('bookings', 'Creators view assigned bookings',
  $p$((select auth.uid()) = creator_id)$p$,
  null);

-- bug_reports
select pg_temp.tv086_rewrite('bug_reports', 'Authenticated users can insert bug reports',
  null,
  $p$((select auth.uid()) = user_id)$p$);
select pg_temp.tv086_rewrite('bug_reports', 'Users can view own bug reports',
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- careers
select pg_temp.tv086_rewrite('careers', 'Admins can manage careers',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);

-- cart_items
select pg_temp.tv086_rewrite('cart_items', 'Users delete own cart',
  $p$((select auth.uid()) = user_id)$p$,
  null);
select pg_temp.tv086_rewrite('cart_items', 'Users insert own cart',
  null,
  $p$(((select auth.uid()) = user_id) AND (NOT (select public.current_user_is_suspended())))$p$);
select pg_temp.tv086_rewrite('cart_items', 'Users read own cart',
  $p$((select auth.uid()) = user_id)$p$,
  null);
select pg_temp.tv086_rewrite('cart_items', 'Users update own cart',
  $p$((select auth.uid()) = user_id)$p$,
  $p$(((select auth.uid()) = user_id) AND (NOT (select public.current_user_is_suspended())))$p$);

-- chat_conversations
select pg_temp.tv086_rewrite('chat_conversations', 'users_read_own_conversations',
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- chat_messages
select pg_temp.tv086_rewrite('chat_messages', 'users_read_own_messages',
  $p$(conversation_id IN ( SELECT chat_conversations.id
   FROM chat_conversations
  WHERE (chat_conversations.user_id = (select auth.uid()))))$p$,
  null);

-- crew_requests
select pg_temp.tv086_rewrite('crew_requests', 'Admins can manage crew requests',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('crew_requests', 'Clients can view own requests',
  $p$((client_email IS NOT NULL) AND (lower(client_email) = lower(((select auth.jwt()) ->> 'email'::text))))$p$,
  null);
select pg_temp.tv086_rewrite('crew_requests', 'Creators can view own requests',
  $p$((select auth.uid()) = creator_id)$p$,
  null);

-- delivery_addresses
select pg_temp.tv086_rewrite('delivery_addresses', 'Own delivery addresses',
  $p$(user_id = (select auth.uid()))$p$,
  null);

-- delivery_custody_events
select pg_temp.tv086_rewrite('delivery_custody_events', 'Party reads custody',
  $p$((select public.is_admin()) OR delivery_is_renter(shipment_id) OR delivery_owns_any(shipment_id, ARRAY[booking_id]))$p$,
  null);

-- delivery_events
select pg_temp.tv086_rewrite('delivery_events', 'Renter reads delivery events',
  $p$((select public.is_admin()) OR delivery_is_renter(shipment_id))$p$,
  null);

-- delivery_incidents
select pg_temp.tv086_rewrite('delivery_incidents', 'Party reads incidents',
  $p$((select public.is_admin()) OR delivery_is_renter(shipment_id) OR delivery_owns_all(shipment_id, booking_ids))$p$,
  null);

-- delivery_quotes
select pg_temp.tv086_rewrite('delivery_quotes', 'Own delivery quotes',
  $p$((renter_id = (select auth.uid())) OR (select public.is_admin()))$p$,
  null);

-- delivery_shipments
select pg_temp.tv086_rewrite('delivery_shipments', 'Renter or owner reads shipment',
  $p$((renter_id = (select auth.uid())) OR ((select auth.uid()) = ANY (owner_ids)) OR (select public.is_admin()))$p$,
  null);

-- dispute_comments
select pg_temp.tv086_rewrite('dispute_comments', 'Users can add comments to their disputes',  -- prod name only
  null,
  $p$(((select auth.uid()) = author_id) AND (is_internal = false) AND (EXISTS ( SELECT 1
   FROM disputes
  WHERE ((disputes.id = dispute_comments.dispute_id) AND (disputes.filed_by = (select auth.uid()))))))$p$);
select pg_temp.tv086_rewrite('dispute_comments', 'Users can view non-internal comments on their disputes',  -- prod name only
  $p$((is_internal = false) AND (EXISTS ( SELECT 1
   FROM disputes
  WHERE ((disputes.id = dispute_comments.dispute_id) AND (disputes.filed_by = (select auth.uid()))))))$p$,
  null);

-- disputes
select pg_temp.tv086_rewrite('disputes', 'Users can file disputes',
  null,
  $p$((select auth.uid()) = filed_by)$p$);
select pg_temp.tv086_rewrite('disputes', 'Users can view own disputes',
  $p$((select auth.uid()) = filed_by)$p$,
  null);

-- equipment_bookings
select pg_temp.tv086_rewrite('equipment_bookings', 'Admins can manage all bookings',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('equipment_bookings', 'Bookings: owner read own',  -- prod name only
  $p$(user_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('equipment_bookings', 'Users can view own bookings',  -- dev name only
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- feature_flag_events
select pg_temp.tv086_rewrite('feature_flag_events', 'admins_read_events',
  $p$(select public.is_admin())$p$,
  null);

-- feature_flags
select pg_temp.tv086_rewrite('feature_flags', 'admins_manage_flags',
  $p$(select public.is_admin())$p$,
  null);

-- invoices
select pg_temp.tv086_rewrite('invoices', 'Admins can manage invoices',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('invoices', 'Invoices: owner read via booking',  -- prod name only
  $p$(booking_id IN ( SELECT equipment_bookings.id
   FROM equipment_bookings
  WHERE (equipment_bookings.user_id = (select auth.uid()))))$p$,
  null);
select pg_temp.tv086_rewrite('invoices', 'Users can view own invoices',  -- dev name only
  $p$(EXISTS ( SELECT 1
   FROM equipment_bookings eb
  WHERE ((eb.id = invoices.booking_id) AND (eb.user_id = (select auth.uid())))))$p$,
  null);

-- listing_private
select pg_temp.tv086_rewrite('listing_private', 'Admins read listing_private',
  $p$(select public.is_admin())$p$,
  null);

-- listings
select pg_temp.tv086_rewrite('listings', 'Admins can manage listings',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('listings', 'Listings: owner delete',  -- prod name only
  $p$(user_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('listings', 'Listings: owner read own',  -- prod name only
  $p$(user_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('listings', 'Users can delete own listings',  -- dev name only
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- notifications
select pg_temp.tv086_rewrite('notifications', 'Users can read own notifications',
  $p$((select auth.uid()) = user_id)$p$,
  null);
select pg_temp.tv086_rewrite('notifications', 'Users can update own notifications',
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- onboarding_progress
select pg_temp.tv086_rewrite('onboarding_progress', 'Creators manage own onboarding progress',
  $p$(creator_id = (select auth.uid()))$p$,
  $p$(creator_id = (select auth.uid()))$p$);
select pg_temp.tv086_rewrite('onboarding_progress', 'Users can insert own onboarding progress',  -- prod name only
  null,
  $p$((select auth.uid()) = creator_id)$p$);
select pg_temp.tv086_rewrite('onboarding_progress', 'Users can update own onboarding progress',  -- prod name only
  $p$((select auth.uid()) = creator_id)$p$,
  null);
select pg_temp.tv086_rewrite('onboarding_progress', 'Users can view own onboarding progress',  -- prod name only
  $p$((select auth.uid()) = creator_id)$p$,
  null);

-- orders
select pg_temp.tv086_rewrite('orders', 'Admins can manage orders',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('orders', 'Buyers can view own orders',  -- dev name only
  $p$((select auth.uid()) = buyer_id)$p$,
  null);
select pg_temp.tv086_rewrite('orders', 'Orders: buyer read own',  -- prod name only
  $p$(buyer_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('orders', 'Orders: buyer update',  -- prod name only
  $p$(buyer_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('orders', 'Orders: seller read own',  -- prod name only
  $p$(seller_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('orders', 'Orders: seller update',  -- prod name only
  $p$(seller_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('orders', 'Sellers can view own orders',  -- dev name only
  $p$((select auth.uid()) = seller_id)$p$,
  null);

-- owner_payouts
select pg_temp.tv086_rewrite('owner_payouts', 'Own payouts',
  $p$((owner_id = (select auth.uid())) OR (select public.is_admin()))$p$,
  null);

-- platform_events
select pg_temp.tv086_rewrite('platform_events', 'Admin reads all events',
  $p$(select public.is_admin())$p$,
  null);

-- portfolio_analysis
select pg_temp.tv086_rewrite('portfolio_analysis', 'Creators add own portfolio analysis',
  null,
  $p$(creator_id = (select auth.uid()))$p$);
select pg_temp.tv086_rewrite('portfolio_analysis', 'Creators read own portfolio analysis',
  $p$(creator_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('portfolio_analysis', 'Users can delete own portfolio analyses',  -- prod name only
  $p$((select auth.uid()) = creator_id)$p$,
  null);
select pg_temp.tv086_rewrite('portfolio_analysis', 'Users can insert own portfolio analyses',  -- prod name only
  null,
  $p$((select auth.uid()) = creator_id)$p$);
select pg_temp.tv086_rewrite('portfolio_analysis', 'Users can view own portfolio analyses',  -- prod name only
  $p$((select auth.uid()) = creator_id)$p$,
  null);

-- portfolio_tag_corrections
select pg_temp.tv086_rewrite('portfolio_tag_corrections', 'Creators can insert their own corrections',
  null,
  $p$(creator_id = (select auth.uid()))$p$);
select pg_temp.tv086_rewrite('portfolio_tag_corrections', 'Creators can view their own corrections',
  $p$(creator_id = (select auth.uid()))$p$,
  null);

-- press
select pg_temp.tv086_rewrite('press', 'Admins can manage press',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);

-- profiles
-- The read policies (SELECT and ALL) stay BARE on purpose. "Profiles: owner
-- update safe" checks the new row against the caller's own profile with
-- subqueries over profiles, and those subqueries get profiles' read
-- policies. Postgres refuses (infinite recursion detected in policy for
-- relation "profiles") when a policy reached that way contains any subquery,
-- and (select auth.uid()) is one. So these three are written out bare: that
-- is a no-op where they already are, and undoes a wrapped version.
select pg_temp.tv086_rewrite('profiles', 'Admins can manage profiles',
  $p$is_admin()$p$,
  $p$is_admin()$p$);
select pg_temp.tv086_rewrite('profiles', 'Profiles: admin reads all',
  $p$is_admin()$p$,
  null);
select pg_temp.tv086_rewrite('profiles', 'Profiles: owner reads own',
  $p$(id = auth.uid())$p$,
  null);
select pg_temp.tv086_rewrite('profiles', 'Profiles: insert own only',
  null,
  $p$(id = (select auth.uid()))$p$);
select pg_temp.tv086_rewrite('profiles', 'Profiles: owner update safe',
  $p$(id = (select auth.uid()))$p$,
  $p$((id = (select auth.uid())) AND (role = ( SELECT p.role
   FROM profiles p
  WHERE (p.id = (select auth.uid())))) AND (is_verified = ( SELECT p.is_verified
   FROM profiles p
  WHERE (p.id = (select auth.uid())))) AND (verification_status = ( SELECT p.verification_status
   FROM profiles p
  WHERE (p.id = (select auth.uid())))) AND (NOT (is_suspended IS DISTINCT FROM ( SELECT p.is_suspended
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (no_show_count IS DISTINCT FROM ( SELECT p.no_show_count
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (crew_featured IS DISTINCT FROM ( SELECT p.crew_featured
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))))$p$);

-- refund_obligations
select pg_temp.tv086_rewrite('refund_obligations', 'Own refunds',
  $p$((user_id = (select auth.uid())) OR (select public.is_admin()))$p$,
  null);

-- rental_blocks
select pg_temp.tv086_rewrite('rental_blocks', 'Admins read rental blocks',
  $p$(select public.is_admin())$p$,
  null);

-- rental_payment_intents
select pg_temp.tv086_rewrite('rental_payment_intents', 'Own payment intents',
  $p$((user_id = (select auth.uid())) OR (select public.is_admin()))$p$,
  null);

-- reviews
select pg_temp.tv086_rewrite('reviews', 'Users can insert own reviews',
  null,
  $p$(((select auth.uid()) = reviewer_id) AND (NOT (select public.current_user_is_suspended())))$p$);
select pg_temp.tv086_rewrite('reviews', 'Users can update own reviews',
  $p$((select auth.uid()) = reviewer_id)$p$,
  $p$(((select auth.uid()) = reviewer_id) AND (NOT (select public.current_user_is_suspended())))$p$);

-- service_booking_events
select pg_temp.tv086_rewrite('service_booking_events', 'Parties read their service booking history',
  $p$(EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = service_booking_events.booking_id) AND ((b.client_id = (select auth.uid())) OR (b.creator_id = (select auth.uid()))))))$p$,
  null);

-- smart_productions
select pg_temp.tv086_rewrite('smart_productions', 'Admins can manage productions',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);

-- smart_rentals
select pg_temp.tv086_rewrite('smart_rentals', 'Admins can manage rentals',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);

-- subscription_plans
select pg_temp.tv086_rewrite('subscription_plans', 'Admins can manage plans',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);

-- subscriptions
select pg_temp.tv086_rewrite('subscriptions', 'Admins can manage subscriptions',
  $p$(select public.is_admin())$p$,
  $p$(select public.is_admin())$p$);
select pg_temp.tv086_rewrite('subscriptions', 'Subscriptions: owner read',  -- prod name only
  $p$(user_id = (select auth.uid()))$p$,
  null);
select pg_temp.tv086_rewrite('subscriptions', 'Users can view own subscriptions',  -- dev name only
  $p$((select auth.uid()) = user_id)$p$,
  null);

-- ubunye_usage
select pg_temp.tv086_rewrite('ubunye_usage', 'Users can read own usage',
  $p$((select auth.uid()) = user_id)$p$,
  null);

do $$
declare
  v_bad text;
begin
  select string_agg(format('%s."%s"', p.tablename, p.policyname), ', ') into v_bad
    from pg_policies p
   where p.schemaname = 'public' and p.tablename in (select name from _tv086_tables)
     and not (p.tablename = 'profiles' and p.cmd in ('SELECT', 'ALL'))
     and (pg_temp.tv086_has_bare(p.qual) or pg_temp.tv086_has_bare(p.with_check));
  if v_bad is not null then
    raise exception '086 C: policies still calling auth.uid()/auth.jwt()/auth.role()/is_admin()/current_user_is_suspended() per row: %', v_bad;
  end if;
  -- And the profiles read policies must have no subquery at all (see above).
  select string_agg(format('profiles."%s"', p.policyname), ', ') into v_bad
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'profiles' and p.cmd in ('SELECT', 'ALL')
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~* '\mselect\M';
  if v_bad is not null then
    raise exception '086 C: profiles read policies with a subquery break "Profiles: owner update safe": %', v_bad;
  end if;
  raise notice '086 C: no ThabangVision policy calls those functions per row, except profiles'' three read policies';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. Missing indexes
-- ════════════════════════════════════════════════════════════════════════════
-- The daily job's dedupe checks: type + link, no user (daily-maintenance).
select pg_temp.tv086_ensure_index('idx_notifications_type_link', 'notifications', 'btree (type, link)');
-- The notification list: a user's newest first.
select pg_temp.tv086_ensure_index('idx_notifications_user_created', 'notifications', 'btree (user_id, created_at DESC)');
-- "Clients can view own requests" matches lower(client_email).
select pg_temp.tv086_ensure_index('idx_crew_requests_client_email_lower', 'crew_requests', 'btree (lower(client_email))');
-- Chat history: one conversation in order.
select pg_temp.tv086_ensure_index('idx_chat_messages_conversation_created', 'chat_messages', 'btree (conversation_id, created_at)');
-- Foreign keys on tables that grow (joins, and deletes of the parent row).
-- Admin-only references (feature_flags.updated_by, feature_flag_events.changed_by,
-- moderation_log.admin_id, profiles.suspended_by, disputes.resolved_by,
-- chat_faqs.source_conversation_id) stay unindexed: small tables, rare paths.
select pg_temp.tv086_ensure_index('idx_smart_productions_category', 'smart_productions', 'btree (production_category_id)');
select pg_temp.tv086_ensure_index('idx_rental_payment_intents_user', 'rental_payment_intents', 'btree (user_id)');
select pg_temp.tv086_ensure_index('idx_unmet_demand_user', 'unmet_demand', 'btree (user_id)');
select pg_temp.tv086_ensure_index('idx_disputes_filed_by', 'disputes', 'btree (filed_by)');
select pg_temp.tv086_ensure_index('idx_delivery_quotes_origin_address', 'delivery_quotes', 'btree (origin_address_id)');
select pg_temp.tv086_ensure_index('idx_delivery_quotes_destination_address', 'delivery_quotes', 'btree (destination_address_id)');
select pg_temp.tv086_ensure_index('idx_delivery_shipments_quote', 'delivery_shipments', 'btree (quote_id)');
select pg_temp.tv086_ensure_index('idx_delivery_shipments_origin_address', 'delivery_shipments', 'btree (origin_address_id)');
select pg_temp.tv086_ensure_index('idx_delivery_shipments_destination_address', 'delivery_shipments', 'btree (destination_address_id)');
select pg_temp.tv086_ensure_index('idx_delivery_incidents_shipment', 'delivery_incidents', 'btree (shipment_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- E. Redundant indexes
-- ════════════════════════════════════════════════════════════════════════════
-- E1. Exact copies: same table, access method, columns, expressions,
-- operator classes, collations, ordering and predicate. Keep a constraint's
-- index first, then a unique one, then the oldest. Never drop a constraint's
-- index, a primary key or a replica identity, and never drop a unique index
-- unless the one kept is unique too. (The plain slug copies of the unique
-- slugs, invoices.invoice_number, onboarding_progress.creator_id,
-- ubunye_usage (user_id, date), production_categories' second unique slug.)
do $$
declare
  r record;
begin
  for r in
    with ix as (
      select x.indexrelid, x.indrelid, i.relname, i.relam, x.indisunique, x.indnullsnotdistinct,
             x.indkey::text k, x.indclass::text cl, x.indcollation::text co, x.indoption::text op,
             coalesce(pg_get_expr(x.indexprs, x.indrelid), '') ex,
             coalesce(pg_get_expr(x.indpred, x.indrelid), '') pr,
             x.indisprimary, x.indisreplident, x.indisvalid,
             case when exists (select 1 from pg_constraint k where k.conindid = x.indexrelid) then 3
                  when x.indisunique then 2 else 1 end as rank
        from pg_index x
        join pg_class i on i.oid = x.indexrelid
        join pg_class t on t.oid = x.indrelid
       where t.relnamespace = 'public'::regnamespace
         and t.relname in (select name from _tv086_tables)
    )
    select a.relname, a.indrelid::regclass tbl, min(b.relname) kept
      from ix a
      join ix b
        on b.indrelid = a.indrelid and b.indexrelid <> a.indexrelid and b.indisvalid
       and b.relam = a.relam and b.k = a.k and b.cl = a.cl and b.co = a.co and b.op = a.op
       and b.ex = a.ex and b.pr = a.pr
       and (not a.indisunique or (b.indisunique and b.indnullsnotdistinct = a.indnullsnotdistinct))
       and (b.rank > a.rank or (b.rank = a.rank and b.indexrelid < a.indexrelid))
     where a.rank < 3 and not a.indisprimary and not a.indisreplident
     group by a.relname, a.indrelid
  loop
    execute format('drop index public.%I', r.relname);
    raise notice '086 E1: dropped % on %, an exact copy of %', r.relname, r.tbl, r.kept;
  end loop;
end $$;

-- E2. Covered by another index.
-- 055's availability index: 070's covers the same columns for a superset of
-- statuses, so every query that could use 055's can use 070's.
select pg_temp.tv086_drop_covered('equipment_bookings',
  'btree (rental_id, start_date, end_date) WHERE (status = ANY (ARRAY[''pending''::text, ''confirmed''::text, ''active''::text]))',
  'btree (rental_id, start_date, end_date) WHERE (status = ANY (ARRAY[''pending''::text, ''confirmed''::text, ''active''::text, ''overdue''::text, ''return_pending''::text, ''return_reviewed''::text, ''disputed''::text]))');
-- Not smart_productions.creator_id: of its three indexes only 083's partial
-- one is fully covered (by 033's full one, which also serves the studio's
-- creator_id IS NULL rows), and 083's test requires that index by name.
-- Leading column of the new composite indexes in D.
select pg_temp.tv086_drop_covered('notifications', 'btree (user_id)', 'btree (user_id, created_at DESC)');
select pg_temp.tv086_drop_covered('chat_messages', 'btree (conversation_id)', 'btree (conversation_id, created_at)');

-- ════════════════════════════════════════════════════════════════════════════
-- F. Log retention for the daily maintenance job
-- ════════════════════════════════════════════════════════════════════════════
-- One table per call, oldest first, at most p_limit rows, so a run cannot
-- time out; the job calls it again while a batch comes back full. The day
-- counts live in lib/constants.ts (STUDIO.retention). Floors stop a typo there
-- from emptying an audit trail: 365 days for the security audit log, payment
-- webhook events and AI cost history, 30 for the rest.
-- SECURITY DEFINER because service_role may not delete security_audit_log
-- (067: append and read only). Executable by service_role only.
create or replace function public.prune_log_retention(p_table text, p_older_than_days integer, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_floor integer := case when p_table in ('security_audit_log', 'payment_events', 'ai_token_usage') then 365 else 30 end;
  v_cutoff timestamptz;
  v_deleted integer;
begin
  if p_older_than_days is null or p_older_than_days < v_floor then
    raise exception 'prune_log_retention: % keeps at least % days (asked %)', p_table, v_floor, p_older_than_days;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'prune_log_retention: limit must be 1 to 10000 (asked %)', p_limit;
  end if;
  v_cutoff := now() - make_interval(days => p_older_than_days);

  case p_table
    when 'platform_events' then
      delete from public.platform_events where id in (
        select id from public.platform_events where created_at < v_cutoff order by created_at limit p_limit);
    when 'ai_token_usage' then
      delete from public.ai_token_usage where id in (
        select id from public.ai_token_usage where created_at < v_cutoff order by created_at limit p_limit);
    when 'security_audit_log' then
      delete from public.security_audit_log where id in (
        select id from public.security_audit_log where occurred_at < v_cutoff order by occurred_at limit p_limit);
    when 'payment_events' then
      -- Finished events only: 'received', 'processing' and 'failed' may still
      -- be worked, and 'dead' waits for a person.
      delete from public.payment_events where id in (
        select id from public.payment_events
         where received_at < v_cutoff and processing_status in ('processed', 'ignored')
         order by received_at limit p_limit);
    when 'notifications' then
      -- Read notices only; an unread one stays however old it is.
      delete from public.notifications where id in (
        select id from public.notifications
         where is_read and created_at < v_cutoff order by created_at limit p_limit);
    else
      raise exception 'prune_log_retention: % is not a log table this prunes', p_table;
  end case;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$fn$;

comment on function public.prune_log_retention(text, integer, integer) is
  'Deletes up to p_limit rows older than p_older_than_days from one of: platform_events, ai_token_usage, security_audit_log, payment_events (processed or ignored only), notifications (read only). Called by the daily maintenance job (086).';

revoke all on function public.prune_log_retention(text, integer, integer) from public, anon, authenticated;
grant execute on function public.prune_log_retention(text, integer, integer) to service_role;

notify pgrst, 'reload schema';

commit;

-- ── Rollback (by hand, one transaction) ─────────────────────────────────────
-- C needs no rollback: each policy means what it meant. For the rest:
--   drop function if exists public.prune_log_retention(text, integer, integer);
--   drop index if exists public.idx_notifications_type_link, public.idx_notifications_user_created,
--     public.idx_crew_requests_client_email_lower, public.idx_chat_messages_conversation_created,
--     public.idx_smart_productions_category, public.idx_rental_payment_intents_user,
--     public.idx_unmet_demand_user, public.idx_delivery_quotes_origin_address,
--     public.idx_delivery_quotes_destination_address, public.idx_delivery_shipments_quote,
--     public.idx_delivery_shipments_origin_address, public.idx_delivery_shipments_destination_address,
--     public.idx_delivery_incidents_shipment;
--   (and idx_disputes_filed_by only where 086 created it: dev, not production).
--   Dropped indexes come back by re-running the create index statements of
--   the migrations that made them (037, 055 and the slug/unique copies).
--   B: alter policy <name> on public.<table> using (exists (select 1 from
--   public.profiles p where p.id = auth.uid() and p.role = 'admin')).
--   A's four policies granted nothing and are not restored.
