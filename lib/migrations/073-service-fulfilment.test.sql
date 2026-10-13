-- Tests for 073-service-fulfilment.sql. DEV DATABASE ONLY.
--
-- Run in the Supabase SQL editor (as postgres) or psql AFTER applying 073.
-- Everything happens inside one transaction that ends in ROLLBACK, so the
-- throwaway users, bookings and events never persist.
--
-- The fixture users are inserted straight into auth.users, and a creator
-- profile into public.profiles. If a dev trigger rejects these minimal rows,
-- replace the UUIDs with real dev TEST users and delete the fixture inserts.
-- Never use production users or credentials.
--
-- Each check prints "PASS n: ..." as a NOTICE. Any failure raises an
-- exception ("FAIL n: ...") and aborts the script.
--
-- Covers:
--   1. the new booking columns exist, revisions_used defaults to 0
--   2. 'declined' is a valid status and every earlier status still is
--   3. an unknown status and negative revision counts are refused
--   4. a party to the booking reads its history; someone else reads nothing
--   5. a signed-in user cannot write history
--   6. history cannot be rewritten, even by the server
--   7. notifications accept 'gig_revision_requested' and still accept old types
--   8. cancellation_refund_status accepts 'unknown' and every earlier value,
--      and still refuses anything else

begin;

-- ─── Fixtures (as postgres) ────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000730c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svc073-client@example.invalid'),
  ('00000000-0000-4000-8000-0000000730c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svc073-creator@example.invalid'),
  ('00000000-0000-4000-8000-0000000730c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svc073-stranger@example.invalid');

insert into public.profiles (id, display_name)
values ('00000000-0000-4000-8000-0000000730c2', 'SVC073 Creator')
on conflict (id) do nothing;

insert into public.bookings (
  id, reference, client_id, client_email, creator_id, booking_type, project_category,
  project_description, deliverables, duration_hours, subtotal, vat, total,
  platform_commission, platform_amount, creator_amount, status, payment_status
) values (
  '00000000-0000-4000-8000-0000000730b1', 'BK-SVC073TEST', '00000000-0000-4000-8000-0000000730c1',
  'svc073-client@example.invalid', '00000000-0000-4000-8000-0000000730c2', 'production', 'Portrait Photography',
  'test', 'Edited Photos (Digital)', 2, 3000, 0, 3000, 15, 450, 2550, 'paid', 'paid'
);

-- 1. Columns and defaults
do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
    from unnest(array[
      'declined_at', 'decline_reason', 'revisions_included', 'revisions_used', 'revision_policy',
      'cancellation_policy', 'accepted_by_client_at', 'payout_due_at', 'dispute_window_ends_at',
      'payout_claimed_at', 'payout_last_error'
    ]) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'bookings' and column_name = c
   );
  if missing is not null then raise exception 'FAIL 1: missing bookings columns: %', missing; end if;
  if (select revisions_used from public.bookings where id = '00000000-0000-4000-8000-0000000730b1') <> 0 then
    raise exception 'FAIL 1: revisions_used does not default to 0';
  end if;
  raise notice 'PASS 1: new booking columns exist and revisions_used defaults to 0';
end $$;

-- 2. Status vocabulary
do $$
declare
  s text;
begin
  foreach s in array array['pending', 'paid', 'accepted', 'delivered', 'completed', 'paid_out', 'cancelled', 'disputed', 'pending_reassignment', 'declined'] loop
    update public.bookings set status = s where id = '00000000-0000-4000-8000-0000000730b1';
  end loop;
  update public.bookings set status = 'paid' where id = '00000000-0000-4000-8000-0000000730b1';
  raise notice 'PASS 2: declined and every earlier status are allowed';
end $$;

-- 3. Refusals
do $$
begin
  begin
    update public.bookings set status = 'rejected_by_creator' where id = '00000000-0000-4000-8000-0000000730b1';
    raise exception 'FAIL 3: an unknown status was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.bookings set revisions_used = -1 where id = '00000000-0000-4000-8000-0000000730b1';
    raise exception 'FAIL 3: a negative revisions_used was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.bookings set revisions_included = -1 where id = '00000000-0000-4000-8000-0000000730b1';
    raise exception 'FAIL 3: a negative revisions_included was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3: unknown statuses and negative revision counts are refused';
end $$;

-- History written as the server would (service role / postgres bypasses RLS).
insert into public.service_booking_events (booking_id, event, from_status, to_status, actor, actor_id, reason)
values ('00000000-0000-4000-8000-0000000730b1', 'declined', 'paid', 'declined', 'creator', '00000000-0000-4000-8000-0000000730c2', 'unavailable that day');

-- 4a. The client reads it
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000730c1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.service_booking_events where booking_id = '00000000-0000-4000-8000-0000000730b1') <> 1 then
    raise exception 'FAIL 4: the client cannot read the history of their booking';
  end if;
  raise notice 'PASS 4a: the client reads their booking history';
end $$;

-- 4b. The creator reads it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000730c2","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.service_booking_events where booking_id = '00000000-0000-4000-8000-0000000730b1') <> 1 then
    raise exception 'FAIL 4: the creator cannot read the history of their gig';
  end if;
  raise notice 'PASS 4b: the creator reads their gig history';
end $$;

-- 4c. A stranger reads nothing; 5. and cannot write
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000730c3","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.service_booking_events where booking_id = '00000000-0000-4000-8000-0000000730b1') <> 0 then
    raise exception 'FAIL 4: a stranger can read someone else''s booking history';
  end if;
  raise notice 'PASS 4c: a stranger reads nothing';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000730c1","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.service_booking_events (booking_id, event, actor, actor_id)
    values ('00000000-0000-4000-8000-0000000730b1', 'completed', 'client', '00000000-0000-4000-8000-0000000730c1');
    raise exception 'FAIL 5: a signed-in user wrote booking history';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 5: a signed-in user cannot write history';
end $$;

reset role;

-- 6. Append-only, even for the server
do $$
begin
  begin
    update public.service_booking_events set reason = 'rewritten' where booking_id = '00000000-0000-4000-8000-0000000730b1';
    raise exception 'FAIL 6: history was rewritten';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  raise notice 'PASS 6: history cannot be rewritten';
end $$;

-- 7. Notification types
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'SKIP 7: no notifications table here';
    return;
  end if;
  insert into public.notifications (user_id, type, title, body)
  values ('00000000-0000-4000-8000-0000000730c2', 'gig_revision_requested', 't', 'b');
  insert into public.notifications (user_id, type, title, body)
  values ('00000000-0000-4000-8000-0000000730c2', 'gig_request', 't', 'b');
  begin
    insert into public.notifications (user_id, type, title, body)
    values ('00000000-0000-4000-8000-0000000730c2', 'not_a_real_type', 't', 'b');
    raise exception 'FAIL 7: an unknown notification type was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 7: gig_revision_requested is allowed, old types still are, unknown ones are not';
end $$;

-- 8. Refund outcomes
do $$
declare
  s text;
begin
  foreach s in array array['pending', 'refunded', 'failed', 'manual_review', 'not_required', 'unknown'] loop
    update public.bookings set cancellation_refund_status = s where id = '00000000-0000-4000-8000-0000000730b1';
  end loop;
  update public.bookings set cancellation_refund_status = null where id = '00000000-0000-4000-8000-0000000730b1';
  begin
    update public.bookings set cancellation_refund_status = 'maybe' where id = '00000000-0000-4000-8000-0000000730b1';
    raise exception 'FAIL 8: an unknown refund status was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 8: unknown is a valid refund outcome, earlier ones still are, others are refused';
end $$;

rollback;
