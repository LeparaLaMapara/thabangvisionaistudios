-- Read-only checks to run on DEV or PRODUCTION before applying
-- lib/migrations/077-database-integrity.sql. Writes nothing (it runs in a
-- READ ONLY transaction that is rolled back).
--
--   psql "$DATABASE_URL" -X -f scripts/db/precheck-077.sql > precheck-077.out
--   (or paste into the SQL editor)
--
-- ROLLOUT ORDER: APP FIRST. Deploy the app build that contains
-- getBusyCreatorIds() (lib/supabase/queries/crew.ts) to this environment
-- BEFORE applying 077. Older builds read crew_requests with the visitor's
-- session; after 077 that returns nothing and Ubunye shows busy creators as
-- available. The new build falls back to the old read until 077 is applied.
-- STOP if the deployed build does not have it yet.
--
-- Keep the output with the evidence. Each query says which result means
-- STOP (do not apply 077; bring the output to the integration owner) and
-- which results are expected.

begin transaction read only;

-- 1. The signup trigger function and what 077 will do with it.
--    077 replaces the body ONLY when it is missing or inserts profiles.email
--    (the broken 006 body); any other body is kept.
--    Expected on production: action = 'keep' (prod inserts only (id)).
--    STOP if the body does anything you cannot explain line by line.
select case
         when to_regprocedure('public.handle_new_user()') is null then 'create'
         when pg_get_functiondef('public.handle_new_user()'::regprocedure)
              ~* 'insert\s+into\s+(public\.)?profiles\s*\([^)]*\memail\M' then 'replace'
         else 'keep'
       end as action_077_takes,
       case when to_regprocedure('public.handle_new_user()') is not null
            then pg_get_functiondef('public.handle_new_user()'::regprocedure) end as current_body;

-- 2. Triggers on auth.users (shared with other apps in production).
--    Expected: on_auth_user_created -> handle_new_user, on_auth_user_created_notify -> notify_signup,
--    plus other apps' triggers. STOP if on_auth_user_created calls anything
--    other than public.handle_new_user (077 leaves it and only warns).
select tgname, tgfoid::regprocedure as calls, tgenabled
  from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1;

-- 3. SECURITY DEFINER functions in public with search_path "" / none, or not
--    owned by postgres. Since the review fixes, 077 E6 touches only
--    ThabangVision's own functions (the list at the top of 077) owned by the
--    role applying it; everything else is reported and left alone, so:
--      is_thabangvision = false             -> fine, 077 ignores it
--      true and owner <> the applying role  -> 077 skips it (NOTICE); STOP and
--                                              ask why one of ours has another owner
--      true and search_path ""              -> becomes pg_catalog, pg_temp
--      true and no search_path              -> becomes public, pg_temp
select p.oid::regprocedure as function,
       pg_get_userbyid(p.proowner) as owner,
       coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '<none>') as search_path,
       p.proname = any (array[
         'admin_approve_verification','admin_get_verification','admin_list_verifications','admin_reject_verification',
         'agent_actions_supersede','busy_creator_ids','caller_owns_rental','claim_delivery_provider_events','claim_outbox',
         'claim_payment_events','confirm_manual_payment','confirm_rental_payment','delivery_apply_transition',
         'delivery_cancelled_orders_to_settle','delivery_claim_dispatch','delivery_create_shipment','delivery_insert_fee_refund',
         'delivery_is_renter','delivery_list_awaiting_acceptance','delivery_mark_quote_paid','delivery_note_cancelled_order',
         'delivery_open_incident','delivery_owns_all','delivery_owns_any','delivery_post','delivery_redact_address',
         'delivery_refund_quote','delivery_save_reconciliation','expire_rental_holds','handle_new_user',
         'increment_conversation_message_count','increment_faq_view','is_admin','ledger_post','log_feature_flag_change',
         'notify_signup','open_return_dispute','outbox_enqueue','payout_transition','profile_is_creator','rate_limit_hit','rate_limits_prune',
         'record_failed_payment_attempt','record_unallocated_payment','refund_obligations_cap','refund_transition',
         'rental_units_blocked','reserve_rental_order','set_signup_webhook','submit_verification_for_user',
         'submit_verification_request','transition_rental_booking']) as is_thabangvision
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and (p.proconfig is null
        or exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        or pg_get_userbyid(p.proowner) <> 'postgres')
 order by 4 desc, 1;

-- 4. Tables in public that are NOT in 077's ThabangVision list. 077 leaves
--    them untouched (no grant changes) and names them in a NOTICE.
--    Expected: other apps' tables (apps, kb_*, blog_*, ...).
--    STOP if one of them is ThabangVision's: 077's list is out of date.
select c.relname as not_in_077_list
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
   and c.relname <> all (array[
     'agent_actions','ai_budget_alerts','ai_token_usage','banking_details','booking_payments','booking_status_history',
     'bookings','bug_reports','careers','cart_items','chat_conversations','chat_faqs','chat_messages','consent_records',
     'content_embeddings','crew_requests','delivery_addresses','delivery_cancelled_order_notes','delivery_custody_events',
     'delivery_dispatch_intents','delivery_events','delivery_incidents','delivery_manual_tasks','delivery_proofs',
     'delivery_provider_events','delivery_quotes','delivery_reconciliation','delivery_shipments','dispute_comments',
     'disputes','equipment_bookings','feature_flag_events','feature_flags','invoices','ledger_journals','ledger_lines',
     'listing_private','listings','moderation_log','newsletter_subscribers','notification_outbox','notifications',
     'onboarding_progress','ops_check_runs','ops_findings','orders','owner_payouts','payment_confirmations',
     'payment_events','phone_codes','platform_events','portfolio_analysis','portfolio_tag_corrections','press',
     'production_categories','profiles','rate_limits','refund_obligations','rental_blocks','rental_escalations',
     'rental_payment_intents','reviews','security_audit_log','service_booking_events','smart_productions',
     'smart_rentals','subscription_plans','subscriptions','ubunye_usage','unmet_demand','welcome_messages'])
 order by 1;

-- 5. booking_payments: every CHECK on the TABLE (whatever its name) and the
--    status values in use. 077 drops every CHECK that mentions status and
--    adds pending|succeeded|failed|refunded, rewriting 'complete' rows.
--    STOP if any status value is outside pending, complete, succeeded,
--    failed, refunded (the new CHECK would refuse it and 077 would fail).
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint where conrelid = 'public.booking_payments'::regclass and contype = 'c' order by 1;
select status, count(*),
       case when status is null or status in ('pending','complete','succeeded','failed','refunded') then 'ok' else 'STOP' end as verdict
  from public.booking_payments group by 1 order by 1;

-- 6. Write policies that anon can reach (role public or anon) whose
--    condition does not depend on the user, an admin, the service role or
--    is false. 077 revokes every anon write grant on ThabangVision tables.
--    Expected after 077 on the repo: only crew_requests' two open policies
--    (which 077 drops). STOP if any other row appears on a ThabangVision
--    table: something writes as anon that the repo does not know about.
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   and roles && array['public', 'anon']::name[]
   and not ((qual is null or qual ~ '(auth\.uid\(\)|is_admin\(\)|service_role|^\s*false\s*$)')
            and (with_check is null or with_check ~ '(auth\.uid\(\)|is_admin\(\)|service_role|^\s*false\s*$)'))
 order by 1, 2;

-- 7. public_profiles columns. 077 recreates the view with 075's columns, in
--    this order; CREATE OR REPLACE VIEW fails if they differ.
--    STOP if same_as_075 is false.
with expected(pos, name) as (values
  (1,'id'),(2,'display_name'),(3,'avatar_url'),(4,'bio'),(5,'skills'),(6,'social_links'),(7,'location'),
  (8,'specializations'),(9,'crew_slug'),(10,'crew_bio'),(11,'years_experience'),(12,'crew_featured'),
  (13,'hourly_rate'),(14,'available_for_hire'),(15,'portfolio_projects'),(16,'is_verified'),
  (17,'verification_status'),(18,'created_at')),
actual as (
  select attnum as pos, attname::text as name from pg_attribute
   where attrelid = 'public.public_profiles'::regclass and attnum > 0 and not attisdropped)
select (select count(*) from actual) as columns_now,
       not exists (select 1 from expected e full join actual a using (pos) where e.name is distinct from a.name) as same_as_075,
       (select string_agg(name, ', ' order by pos) from actual) as columns;

-- 8. Long-running transactions. 077 waits at most 5 s for a lock and 2 min
--    per statement, then rolls back by itself. STOP (wait, apply off-peak)
--    if anything has been open for more than a minute.
select pid, usename, application_name, state, now() - xact_start as open_for, left(query, 120) as query
  from pg_stat_activity
 where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid()
 order by xact_start;

rollback;
