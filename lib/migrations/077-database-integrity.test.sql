-- 077 test script. ONE transaction, ends in ROLLBACK; creates its own users,
-- listings and payments. Apply 077-database-integrity.sql first.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/migrations/077-database-integrity.test.sql
--
-- Every check prints "PASS <item>: ..." or aborts with "FAIL <item>: ...".
-- Items match the sections of the migration (A booking_payments, B signup,
-- C creators and public_profiles, D is_admin, E access control).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures (as postgres). Inserting into auth.users is itself test B1: with
-- the pre-077 trigger body every insert below fails on profiles.email.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_renter  uuid := gen_random_uuid();
  v_creator uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_drafter uuid := gen_random_uuid();
  v_susp    uuid := gen_random_uuid();
  v_x       uuid := gen_random_uuid();
  v_y       uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (v_admin,   't077-admin@example.invalid'),
    (v_renter,  't077-renter@example.invalid'),
    (v_creator, 't077-creator@example.invalid'),
    (v_owner,   't077-owner@example.invalid'),
    (v_drafter, 't077-drafter@example.invalid'),
    (v_susp,    't077-susp@example.invalid'),
    (v_x,       't077-x@example.invalid'),
    (v_y,       't077-y@example.invalid');

  -- B1: the signup trigger made a profile for each, with 067's defaults.
  if (select count(*) from public.profiles
       where id in (v_admin, v_renter, v_creator, v_owner, v_drafter, v_susp, v_x, v_y)
         and role = 'user' and is_verified = false and verification_status = 'unverified'
         and coalesce(is_suspended, false) = false and coalesce(available_for_hire, false) = false) <> 8 then
    raise exception 'FAIL B1: signup did not create default profiles';
  end if;
  raise notice 'PASS B1: inserting auth.users creates a default profile (signup works on a rebuilt database)';

  update public.profiles set role = 'admin' where id = v_admin;
  update public.profiles set display_name = 'Rita Renter', bio = 'I rent lenses' where id = v_renter;
  update public.profiles set display_name = 'Cebo Creator', onboarding_completed_at = now(),
         specializations = array['photography'], portfolio_projects = '[{"title":"t077 wedding"}]'::jsonb
   where id = v_creator;
  update public.profiles set display_name = 'Olu Owner' where id = v_owner;
  update public.profiles set display_name = 'Dee Drafter' where id = v_drafter;
  update public.profiles set display_name = 'Sus Pended', crew_bio = 'creator', is_suspended = true where id = v_susp;
  -- Two other creators already hold the base slug and its "-3" variant.
  update public.profiles set crew_slug = 'cebo-creator', crew_bio = 'x' where id = v_x;
  update public.profiles set crew_slug = 'cebo-creator-3', crew_bio = 'y' where id = v_y;

  -- Community listings go live through review (072): listing_status drives is_published.
  insert into public.smart_rentals (slug, title, owner_id, owner_type, listing_status, quantity)
  values ('t077-live-' || v_owner, 't077 live kit', v_owner, 'community', 'published', 1),
         ('t077-draft-' || v_drafter, 't077 draft kit', v_drafter, 'community', 'draft', 1);
  if not (select is_published from public.smart_rentals where slug = 't077-live-' || v_owner) then
    raise exception 'FAIL fixtures: the live listing is not published';
  end if;

  perform set_config('t077.admin', v_admin::text, true);
  perform set_config('t077.renter', v_renter::text, true);
  perform set_config('t077.creator', v_creator::text, true);
  perform set_config('t077.owner', v_owner::text, true);
  perform set_config('t077.drafter', v_drafter::text, true);
  perform set_config('t077.susp', v_susp::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. booking_payments.status
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  u uuid := current_setting('t077.renter')::uuid;
  cam uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  r jsonb;
  b uuid;
  outcome text;
  journal jsonb;
  st text;
begin
  insert into public.smart_rentals (id, slug, title, quantity, is_published, price_per_day, replacement_value)
  values (cam, 't077-cam-' || cam, 't077 camera', 1, true, 1000, 10000);
  r := public.reserve_rental_order(
    jsonb_build_array(jsonb_build_object('user_id', u, 'rental_id', cam, 'checkout_group_id', g,
      'start_date', '2032-03-10', 'end_date', '2032-03-11', 'total_price', 2000, 'quantity', 1)),
    jsonb_build_object('reference', g::text, 'provider', 'paystack', 'expected_amount_cents', 200000,
      'hire_cents', 200000, 'deposit_cents', 0, 'delivery_cents', 0),
    30);
  b := (r -> 'booking_ids' ->> 0)::uuid;
  -- What /api/cart/checkout writes for each line.
  insert into public.booking_payments (booking_id, amount, currency, status) values (b, 2000, 'ZAR', 'pending');

  journal := jsonb_build_object('idempotencyKey', 'payment:t077', 'kind', 'payment_captured', 'bookingGroupId', g, 'memo', 't077',
    'lines', jsonb_build_array(
      jsonb_build_object('account', 'cash_at_provider', 'debitCents', 200000, 'creditCents', 0),
      jsonb_build_object('account', 'unearned_hire', 'debitCents', 0, 'creditCents', 200000)));
  outcome := public.confirm_rental_payment(g::text, 't077-tx', 200000, false, journal, '[]');
  if outcome <> 'confirmed' then raise exception 'FAIL A1: confirm_rental_payment gave %', outcome; end if;
  select status into st from public.booking_payments where booking_id = b;
  if st <> 'succeeded' then raise exception 'FAIL A1: payment row is %', st; end if;
  if (select status from public.equipment_bookings where id = b) <> 'confirmed' then
    raise exception 'FAIL A1: booking not confirmed';
  end if;
  raise notice 'PASS A1: confirm_rental_payment confirms the booking and marks its payment succeeded';

  -- A2: an older build writing 'complete' is mapped, not refused.
  insert into public.booking_payments (booking_id, amount, currency, status) values (b, 1, 'ZAR', 'complete') returning status into st;
  if st <> 'succeeded' then raise exception 'FAIL A2: complete stored as %', st; end if;
  update public.booking_payments set status = 'complete' where booking_id = b and amount = 1 returning status into st;
  if st <> 'succeeded' then raise exception 'FAIL A2: update to complete stored as %', st; end if;
  raise notice 'PASS A2: legacy ''complete'' is stored as ''succeeded'' (insert and update)';

  -- A3: anything else is refused.
  begin
    insert into public.booking_payments (booking_id, amount, status) values (b, 1, 'paid');
    raise exception 'FAIL A3: status ''paid'' accepted';
  exception when check_violation then
    raise notice 'PASS A3: an unknown status is refused by the CHECK';
  end;

  -- A4: one stored word: no 'complete' rows, and the CHECK names the canonical set.
  if exists (select 1 from public.booking_payments where status = 'complete') then
    raise exception 'FAIL A4: complete rows remain';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'booking_payments_status_check'
                            and conrelid = 'public.booking_payments'::regclass)) !~ 'succeeded'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'booking_payments_status_check'
                            and conrelid = 'public.booking_payments'::regclass)) ~ 'complete' then
    raise exception 'FAIL A4: CHECK is not pending|succeeded|failed|refunded';
  end if;
  raise notice 'PASS A4: no ''complete'' rows; CHECK is pending | succeeded | failed | refunded';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- B. handle_new_user shape
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  f record;
begin
  select p.prosecdef, p.proconfig, p.oid into f from pg_proc p where p.oid = 'public.handle_new_user()'::regprocedure;
  if not f.prosecdef then raise exception 'FAIL B2: handle_new_user is not SECURITY DEFINER'; end if;
  if not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%pg_temp%') then
    raise exception 'FAIL B2: handle_new_user search_path not pinned (%)', f.proconfig;
  end if;
  if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute')
     or exists (select 1 from aclexplode((select proacl from pg_proc where oid = f.oid)) a where a.grantee = 0) then
    raise exception 'FAIL B2: clients can execute handle_new_user';
  end if;
  raise notice 'PASS B2: handle_new_user is SECURITY DEFINER, pinned, not executable by public/anon/authenticated';

  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
                  and tgfoid = 'public.handle_new_user()'::regprocedure) then
    raise exception 'FAIL B3: on_auth_user_created does not call public.handle_new_user';
  end if;
  if pg_get_functiondef('public.handle_new_user()'::regprocedure) ~* 'email' then
    raise exception 'FAIL B3: handle_new_user still copies the e-mail';
  end if;
  raise notice 'PASS B3: on_auth_user_created calls handle_new_user, which inserts only the id';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D. is_admin() and empty claims
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  if public.is_admin() then raise exception 'FAIL D1: empty claims gave admin'; end if;
  raise notice 'PASS D1: is_admin() with empty request.jwt.claims is false, not an error';

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin'))::text, true);
  if not public.is_admin() then raise exception 'FAIL D2: app_metadata.role admin not recognised'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.admin'), 'role', 'authenticated')::text, true);
  if not public.is_admin() then raise exception 'FAIL D2: profiles.role admin not recognised'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.renter'), 'role', 'authenticated')::text, true);
  if public.is_admin() then raise exception 'FAIL D2: a user is admin'; end if;
  raise notice 'PASS D2: same answers otherwise (JWT app_metadata, profiles.role, ordinary user)';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. Approval only makes creators bookable
-- ════════════════════════════════════════════════════════════════════════════
-- A non-admin cannot approve.
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.renter'), 'role', 'authenticated')::text, true); end $$;
do $$
begin
  perform public.admin_approve_verification(current_setting('t077.renter')::uuid);
  raise exception 'FAIL C1: a non-admin approved a verification';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS C1: a non-admin cannot approve (%)', sqlerrm;
end $$;

-- The admin approves a renter, a creator, and the creator again.
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.admin'), 'role', 'authenticated')::text, true); end $$;
do $$
declare
  r jsonb;
begin
  r := public.admin_approve_verification(current_setting('t077.renter')::uuid);
  if (r ->> 'success')::boolean is not true or (r ->> 'creator')::boolean then
    raise exception 'FAIL C2: unexpected result %', r;
  end if;
  perform set_config('t077.r_renter', r::text, true);

  r := public.admin_approve_verification(current_setting('t077.creator')::uuid);
  if (r ->> 'creator')::boolean is not true then raise exception 'FAIL C3: creator not recognised (%)', r; end if;
end $$;
reset role;

do $$
declare
  p public.profiles;
  r jsonb := current_setting('t077.r_renter')::jsonb;
begin
  select * into p from public.profiles where id = current_setting('t077.renter')::uuid;
  if p.verification_status <> 'verified' or not p.is_verified then raise exception 'FAIL C2: renter not verified'; end if;
  if p.available_for_hire or p.crew_slug is not null then
    raise exception 'FAIL C2: approving a renter made them bookable (available_for_hire %, slug %)', p.available_for_hire, p.crew_slug;
  end if;
  if r ->> 'email' <> 't077-renter@example.invalid' then raise exception 'FAIL C2: e-mail not returned (%)', r; end if;
  raise notice 'PASS C2: approving a renter verifies them but does not make them available for hire or give a slug';

  select * into p from public.profiles where id = current_setting('t077.creator')::uuid;
  if not p.available_for_hire or p.crew_slug is distinct from 'cebo-creator-2' then
    raise exception 'FAIL C3: creator after approval: available %, slug %', p.available_for_hire, p.crew_slug;
  end if;
  raise notice 'PASS C3: approving a creator makes them bookable with a free slug (cebo-creator-2; base and -3 taken)';

  -- Re-approval keeps the public URL.
  update public.profiles set crew_slug = 't077-kept-slug' where id = current_setting('t077.creator')::uuid;
end $$;

set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.admin'), 'role', 'authenticated')::text, true); end $$;
do $$ begin perform public.admin_approve_verification(current_setting('t077.creator')::uuid); end $$;
reset role;
do $$
declare
  empty public.profiles;
begin
  if (select crew_slug from public.profiles where id = current_setting('t077.creator')::uuid) <> 't077-kept-slug' then
    raise exception 'FAIL C4: re-approval changed the creator''s slug';
  end if;
  raise notice 'PASS C4: re-approval keeps an existing crew slug';

  -- C5: profile_is_creator signals, one at a time.
  empty.id := gen_random_uuid();
  if public.profile_is_creator(empty) then
    raise exception 'FAIL C5: an empty profile counts as a creator';
  end if;
  if not (select public.profile_is_creator(p) from public.profiles p where id = current_setting('t077.creator')::uuid)
     or (select public.profile_is_creator(p) from public.profiles p where id = current_setting('t077.renter')::uuid) then
    raise exception 'FAIL C5: creator/renter misclassified';
  end if;
  raise notice 'PASS C5: profile_is_creator tells a creator from a renter';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C. public_profiles, read as an anonymous visitor
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
do $$ begin perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
do $$
begin
  if exists (select 1 from public.public_profiles where id = current_setting('t077.renter')::uuid) then
    raise exception 'FAIL C6: a verified renter is listed publicly';
  end if;
  raise notice 'PASS C6: a renter (even verified) is not in public_profiles';

  if not exists (select 1 from public.public_profiles where id = current_setting('t077.creator')::uuid) then
    raise exception 'FAIL C7: the creator is missing';
  end if;
  if not exists (select 1 from public.public_profiles where id = current_setting('t077.owner')::uuid) then
    raise exception 'FAIL C7: the owner of a live community listing is missing (listing pages name them)';
  end if;
  if exists (select 1 from public.public_profiles where id = current_setting('t077.drafter')::uuid) then
    raise exception 'FAIL C7: an owner with only a draft listing is listed';
  end if;
  raise notice 'PASS C7: creators and owners of live listings are listed; draft-only owners are not';

  if exists (select 1 from public.public_profiles where id = current_setting('t077.susp')::uuid) then
    raise exception 'FAIL C8: a suspended creator is listed (049)';
  end if;
  raise notice 'PASS C8: suspended creators stay hidden (049)';
end $$;
reset role;

-- C9: 075's masking still holds for an unverified creator.
do $$
begin
  update public.profiles set verification_status = 'pending', is_verified = false
   where id = current_setting('t077.creator')::uuid;
end $$;
set local role anon;
do $$
declare got jsonb;
begin
  if not exists (select 1 from public.public_profiles where id = current_setting('t077.creator')::uuid) then
    raise exception 'FAIL C9: an unverified creator disappeared (only the portfolio should be hidden)';
  end if;
  select portfolio_projects into got from public.public_profiles where id = current_setting('t077.creator')::uuid;
  if got is not null then raise exception 'FAIL C9: unverified portfolio exposed'; end if;
  raise notice 'PASS C9: an unverified creator is listed with the portfolio hidden (075)';
end $$;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- E. Access control
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_creq uuid;
begin
  insert into public.crew_requests (creator_id, client_name, client_email, project_type, description)
  values (current_setting('t077.creator')::uuid, 'Rita', 'T077-Renter@example.invalid', 'photo', 't077')
  returning id into v_creq;
  perform set_config('t077.creq', v_creq::text, true);
end $$;

set local role anon;
do $$ begin perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); end $$;
do $$
declare n integer;
begin
  select count(*) into n from public.profiles;
  if n <> 0 then raise exception 'FAIL E1: anon reads % profile rows', n; end if;
  raise notice 'PASS E1: anon reads no profile rows (only public_profiles)';

  select count(*) into n from public.crew_requests;
  if n <> 0 then raise exception 'FAIL E2: anon reads % crew requests', n; end if;
  begin
    insert into public.crew_requests (creator_id, client_name, client_email, project_type, description)
    values (current_setting('t077.creator')::uuid, 'x', 'x@example.invalid', 'x', 'x');
    raise exception 'FAIL E2: anon inserted a crew request';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.crew_requests set status = 'cancelled' where true;
    raise exception 'FAIL E2: anon could issue an UPDATE on crew_requests';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS E2: anon cannot read, create or change crew requests';
end $$;
reset role;

-- The client who sent the request (by e-mail, any case) and the creator see it; another user does not.
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.renter'), 'role', 'authenticated',
  'email', 't077-renter@example.invalid')::text, true); end $$;
do $$
begin
  if not exists (select 1 from public.crew_requests where id = current_setting('t077.creq')::uuid) then
    raise exception 'FAIL E2b: the client cannot read their own request';
  end if;
  begin
    update public.crew_requests set status = 'paid' where id = current_setting('t077.creq')::uuid;
    if found then raise exception 'FAIL E2b: the client changed their request directly'; end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.creator'), 'role', 'authenticated',
  'email', 't077-creator@example.invalid')::text, true); end $$;
do $$
begin
  if not exists (select 1 from public.crew_requests where id = current_setting('t077.creq')::uuid) then
    raise exception 'FAIL E2b: the creator cannot read the request sent to them';
  end if;
end $$;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.owner'), 'role', 'authenticated',
  'email', 't077-owner@example.invalid')::text, true); end $$;
do $$
begin
  if exists (select 1 from public.crew_requests where id = current_setting('t077.creq')::uuid) then
    raise exception 'FAIL E2b: a stranger reads someone else''s crew request';
  end if;
  raise notice 'PASS E2b: the client (by e-mail) and the creator read the request; a stranger does not; nobody edits it directly';

  -- E4: no client-created orders.
  begin
    insert into public.orders (buyer_id, seller_id, listing_id, total, platform_fee, seller_payout, status)
    values (auth.uid(), current_setting('t077.creator')::uuid, gen_random_uuid(), 1, 0, 1, 'completed');
    raise exception 'FAIL E4: a signed-in user created an order';
  exception when insufficient_privilege then
    raise notice 'PASS E4: a signed-in user cannot invent an order';
  end;
end $$;

-- E10: no self-published marketplace listings.
do $$
begin
  begin
    insert into public.listings (user_id, type, title, slug, is_published)
    values (auth.uid(), 'sell', 't077 spam', 't077-spam-' || gen_random_uuid(), true);
    raise exception 'FAIL E10: a signed-in user published a marketplace listing directly';
  exception when insufficient_privilege then
    raise notice 'PASS E10: a signed-in user cannot publish a marketplace listing directly';
  end;
end $$;

-- E7: the creator saves their own onboarding progress and portfolio analysis.
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.creator'), 'role', 'authenticated')::text, true); end $$;
do $$
begin
  insert into public.onboarding_progress (creator_id, current_step, step_1_complete)
  values (auth.uid(), 1, true)
  on conflict (creator_id) do update set current_step = 2, step_2_complete = true;
  insert into public.onboarding_progress (creator_id, current_step, step_1_complete)
  values (auth.uid(), 1, true)
  on conflict (creator_id) do update set current_step = 2, step_2_complete = true;
  if (select current_step from public.onboarding_progress where creator_id = auth.uid()) <> 2 then
    raise exception 'FAIL E7: onboarding progress upsert did not save';
  end if;
  insert into public.portfolio_analysis (creator_id, photo_url, scene_type) values (auth.uid(), 'https://example.invalid/a.jpg', 'portrait');
  if not exists (select 1 from public.portfolio_analysis where creator_id = auth.uid()) then
    raise exception 'FAIL E7: portfolio analysis not readable by its creator';
  end if;
  begin
    insert into public.onboarding_progress (creator_id, current_step) values (current_setting('t077.renter')::uuid, 1);
    raise exception 'FAIL E7: wrote someone else''s onboarding progress';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS E7: a creator saves and reads their own onboarding progress and portfolio analysis, nobody else''s';
end $$;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t077.renter'), 'role', 'authenticated')::text, true); end $$;
do $$
begin
  if exists (select 1 from public.onboarding_progress where creator_id = current_setting('t077.creator')::uuid)
     or exists (select 1 from public.portfolio_analysis where creator_id = current_setting('t077.creator')::uuid) then
    raise exception 'FAIL E7: another user reads a creator''s onboarding data';
  end if;
  raise notice 'PASS E7b: another user cannot read a creator''s onboarding data';
end $$;
reset role;

do $$
begin
  -- E3
  if to_regclass('public.content_embeddings') is not null
     and not (select relrowsecurity from pg_class where oid = 'public.content_embeddings'::regclass) then
    raise exception 'FAIL E3: content_embeddings has RLS off';
  end if;
  if to_regclass('public.content_embeddings') is not null
     and (has_table_privilege('anon', 'public.content_embeddings', 'INSERT')
          or has_table_privilege('authenticated', 'public.content_embeddings', 'DELETE')) then
    raise exception 'FAIL E3: clients can write content_embeddings';
  end if;
  raise notice 'PASS E3: content_embeddings has RLS on and no client writes';

  -- E5
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and grantee = 'anon'
                and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
                and table_name not in ('apps', 'kb_documents', 'kb_chunks', 'kb_conversations', 'kb_messages',
                                       'blog_comments', 'blog_subscribers')) then
    raise exception 'FAIL E5: anon still holds a write grant';
  end if;
  if has_table_privilege('authenticated', 'public.bookings', 'INSERT')
     or has_table_privilege('authenticated', 'public.platform_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.ai_token_usage', 'INSERT')   -- service-role-only policy
     or has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') then
    raise exception 'FAIL E5: authenticated keeps a write grant no policy uses';
  end if;
  if not has_table_privilege('authenticated', 'public.cart_items', 'INSERT')
     or not has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE') then
    raise exception 'FAIL E5: a write the app uses was revoked';
  end if;
  raise notice 'PASS E5: anon has no write grants; authenticated keeps only writes a policy uses (cart, profile columns)';

  -- E6
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%')) then
    raise exception 'FAIL E6: a SECURITY DEFINER function lacks pg_temp in its search_path';
  end if;
  if has_function_privilege('anon', 'public.caller_owns_rental(uuid)', 'execute')
     or has_function_privilege('anon', 'public.refund_obligations_cap()', 'execute') then
    raise exception 'FAIL E6: anon can execute an internal function';
  end if;
  raise notice 'PASS E6: definer functions pinned with pg_temp last; internal functions not executable by anon';

  -- E8
  if to_regclass('public.unmet_demand_summary') is not null
     and has_table_privilege('anon', 'public.unmet_demand_summary', 'SELECT') then
    raise exception 'FAIL E8: anon can read unmet_demand_summary';
  end if;
  raise notice 'PASS E8: unmet_demand_summary is service-only';

  -- E9
  if has_column_privilege('anon', 'public.reviews', 'reviewer_email', 'SELECT')
     or has_column_privilege('authenticated', 'public.reviews', 'reviewer_email', 'SELECT') then
    raise exception 'FAIL E9: clients can read reviews.reviewer_email';
  end if;
  if not has_column_privilege('anon', 'public.reviews', 'reviewer_name', 'SELECT')
     or not has_column_privilege('anon', 'public.reviews', 'rating', 'SELECT') then
    raise exception 'FAIL E9: the public review columns are no longer readable';
  end if;
  raise notice 'PASS E9: reviews are readable without the reviewer''s e-mail';
end $$;

select 'ALL 077 CHECKS PASSED' as result;
rollback;
