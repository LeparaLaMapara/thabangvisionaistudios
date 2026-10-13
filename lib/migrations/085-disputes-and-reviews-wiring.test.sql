-- Tests for 085-disputes-and-reviews-wiring.sql. DEV DATABASE ONLY.
--
-- Run as postgres AFTER applying 085. One transaction that ends in ROLLBACK,
-- so the throwaway users, booking, disputes and review never persist.
-- Each check prints "PASS n" as a NOTICE; a failure raises "085 FAIL n".
--
-- Covers:
--   1. a service booking takes status 'disputed' with disputed_at and
--      status_before_dispute; an unknown status_before_dispute is refused
--   2. a second live dispute on the same booking is refused (open, then
--      escalated), and a new one is allowed once the first is resolved
--   3. the same for gear bookings' equipment_booking_id (index exists)
--   4. one review per booking: a second review for the booking is refused,
--      the review is a published crew review of the creator

begin;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000850c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svc085-client@example.invalid'),
  ('00000000-0000-4000-8000-0000000850c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'svc085-creator@example.invalid');

insert into public.profiles (id, display_name)
values
  ('00000000-0000-4000-8000-0000000850c1', 'SVC085 Client'),
  ('00000000-0000-4000-8000-0000000850c2', 'SVC085 Creator')
on conflict (id) do nothing;

insert into public.bookings (
  id, reference, client_id, client_email, creator_id, booking_type, project_category,
  project_description, deliverables, duration_hours, subtotal, vat, total,
  platform_commission, platform_amount, creator_amount, status, payment_status
) values (
  '00000000-0000-4000-8000-0000000850b1', 'BK-SVC085TEST', '00000000-0000-4000-8000-0000000850c1',
  'svc085-client@example.invalid', '00000000-0000-4000-8000-0000000850c2', 'production', 'Portrait Photography',
  'test', 'Edited Photos (Digital)', 2, 3000, 0, 3000, 15, 450, 2550, 'completed', 'paid'
);

-- 1. The booking can be marked disputed, remembering where it was
do $$
begin
  update public.bookings
     set status = 'disputed', disputed_at = now(), status_before_dispute = 'completed'
   where id = '00000000-0000-4000-8000-0000000850b1';
  if (select status from public.bookings where id = '00000000-0000-4000-8000-0000000850b1') <> 'disputed' then
    raise exception '085 FAIL 1: booking did not become disputed';
  end if;
  begin
    update public.bookings set status_before_dispute = 'paid_out' where id = '00000000-0000-4000-8000-0000000850b1';
    raise exception '085 FAIL 1: status_before_dispute accepted paid_out';
  exception when check_violation then null;
  end;
  raise notice 'PASS 1: service booking takes disputed, disputed_at and status_before_dispute';
end $$;

-- 2. One live dispute per service booking
do $$
declare
  first_id uuid;
begin
  insert into public.disputes (dispute_type, booking_id, filed_by, reason, status)
  values ('quality_dispute', '00000000-0000-4000-8000-0000000850b1', '00000000-0000-4000-8000-0000000850c1', '085 test dispute one', 'escalated')
  returning id into first_id;

  begin
    insert into public.disputes (dispute_type, booking_id, filed_by, reason, status)
    values ('quality_dispute', '00000000-0000-4000-8000-0000000850b1', '00000000-0000-4000-8000-0000000850c2', '085 test dispute two', 'open');
    raise exception '085 FAIL 2: a second live dispute (beside an escalated one) was accepted';
  exception when unique_violation then null;
  end;

  update public.disputes set status = 'resolved' where id = first_id;
  insert into public.disputes (dispute_type, booking_id, filed_by, reason, status)
  values ('quality_dispute', '00000000-0000-4000-8000-0000000850b1', '00000000-0000-4000-8000-0000000850c2', '085 test dispute three', 'open');

  begin
    insert into public.disputes (dispute_type, booking_id, filed_by, reason, status)
    values ('quality_dispute', '00000000-0000-4000-8000-0000000850b1', '00000000-0000-4000-8000-0000000850c1', '085 test dispute four', 'not_a_status');
    raise exception '085 FAIL 2: an unknown dispute status was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 2: one live dispute per booking; a resolved one does not count';
end $$;

-- 3. Gear bookings have the same index
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'disputes_one_live_per_equipment_booking'
       and indexdef ilike '%unique%' and indexdef ilike '%escalated%'
  ) then
    raise exception '085 FAIL 3: disputes_one_live_per_equipment_booking is missing';
  end if;
  raise notice 'PASS 3: gear bookings allow one live dispute too';
end $$;

-- 4. One review per booking, readable as a published crew review
do $$
begin
  insert into public.reviews (review_type, reviewer_id, reviewer_name, reviewee_id, booking_id, rating, comment)
  values ('crew', '00000000-0000-4000-8000-0000000850c1', 'SVC085', '00000000-0000-4000-8000-0000000850c2',
          '00000000-0000-4000-8000-0000000850b1', 5, '085 test review');

  begin
    insert into public.reviews (review_type, reviewer_id, reviewee_id, booking_id, rating)
    values ('crew', '00000000-0000-4000-8000-0000000850c1', '00000000-0000-4000-8000-0000000850c2',
            '00000000-0000-4000-8000-0000000850b1', 1);
    raise exception '085 FAIL 4: a second review for the same booking was accepted';
  exception when unique_violation then null;
  end;

  if (select count(*) from public.reviews
       where reviewee_id = '00000000-0000-4000-8000-0000000850c2'
         and review_type = 'crew' and is_published) <> 1 then
    raise exception '085 FAIL 4: the review is not one published crew review of the creator';
  end if;
  raise notice 'PASS 4: one review per booking, published as a crew review';
end $$;

rollback;
