-- 085: service-booking disputes hold the booking, one live dispute per
-- booking, and client reviews of service bookings reach the public ratings.
--
-- Found by the 2026-10-13 audit (audit-4 A3, audit-1 "built not wired"):
--
-- 1. POST /api/disputes wrote dispute_reason / disputed_at on `bookings`, but
--    those columns exist only on `equipment_bookings`. PostgREST refused the
--    whole update, the error was not read, and a service booking never became
--    'disputed'. This adds `bookings.disputed_at` and
--    `bookings.status_before_dispute` (the status the booking goes back to
--    when staff close the dispute). The reason stays on the dispute row.
--
-- 2. The duplicate-dispute check was check-then-insert, per filer, and missed
--    'escalated'. Two partial unique indexes now allow one live dispute
--    (open, investigating or escalated) per booking and per gear booking.
--    DEV had lost disputes_status_check (production has it); it is put back
--    when missing so the index's idea of "live" matches the data.
--
-- 3. `reviews` is what every public rating reads, but nothing wrote it:
--    service reviews only went to bookings.client_rating. This adds
--    `reviews.booking_id` with a unique constraint (one review per booking,
--    never counted twice) and copies any existing client_rating across.
--    A service review is a 'crew' review of the creator (the type the creator
--    profile, crew pages and Ubunye already read), published at once: only
--    the client of a completed booking can write it, and moderation can still
--    hide it (is_published cannot be changed by its author, 067).
--
-- Safe to run more than once. Apply by hand: dev first, then production with
-- the build that writes these columns (app/api/disputes, the admin dispute
-- route and app/api/service-bookings/[id]/review).

begin;

-- ─── 1. bookings: remember the dispute ─────────────────────────────────────
alter table public.bookings add column if not exists disputed_at timestamptz;
alter table public.bookings add column if not exists status_before_dispute text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.bookings'::regclass and conname = 'bookings_status_before_dispute_check'
  ) then
    alter table public.bookings add constraint bookings_status_before_dispute_check
      check (status_before_dispute is null or status_before_dispute in ('paid', 'accepted', 'delivered', 'completed'));
  end if;
end $$;

comment on column public.bookings.disputed_at is
  'When a dispute moved this booking to disputed (085). Cleared reads as never disputed.';
comment on column public.bookings.status_before_dispute is
  'The status before a dispute moved it to disputed; staff closing the dispute put it back (085).';

-- ─── 2. disputes: one live dispute per booking ─────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.disputes'::regclass and conname = 'disputes_status_check'
  ) then
    alter table public.disputes add constraint disputes_status_check
      check (status in ('open', 'investigating', 'resolved', 'escalated', 'dismissed'));
    raise notice '085: disputes_status_check was missing and has been added';
  end if;

  if exists (
    select 1 from public.disputes
     where booking_id is not null and status in ('open', 'investigating', 'escalated')
     group by booking_id having count(*) > 1
  ) or exists (
    select 1 from public.disputes
     where equipment_booking_id is not null and status in ('open', 'investigating', 'escalated')
     group by equipment_booking_id having count(*) > 1
  ) then
    raise exception '085: a booking has more than one live dispute. Close the extra ones (status resolved or dismissed), then run 085 again.';
  end if;
end $$;

create unique index if not exists disputes_one_live_per_booking
  on public.disputes (booking_id)
  where booking_id is not null and status in ('open', 'investigating', 'escalated');

create unique index if not exists disputes_one_live_per_equipment_booking
  on public.disputes (equipment_booking_id)
  where equipment_booking_id is not null and status in ('open', 'investigating', 'escalated');

-- ─── 3. reviews: service reviews reach the public ratings ─────────────────
alter table public.reviews
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.reviews'::regclass and conname = 'reviews_booking_id_key'
  ) then
    alter table public.reviews add constraint reviews_booking_id_key unique (booking_id);
  end if;
end $$;

comment on column public.reviews.booking_id is
  'The service booking this review is about (085). One review per booking; written by the server for the client.';

-- Existing service ratings, once each. Only clients who have a profile
-- (reviewer_id references profiles) and bookings with a creator.
insert into public.reviews (review_type, reviewer_id, reviewer_name, reviewee_id, booking_id, rating, comment, is_published)
select 'crew', b.client_id, nullif(split_part(trim(p.display_name), ' ', 1), ''), b.creator_id, b.id,
       b.client_rating, nullif(trim(b.client_review), ''), true
  from public.bookings b
  join public.profiles p on p.id = b.client_id
 where b.client_rating is not null
   and b.creator_id is not null
on conflict (booking_id) do nothing;

commit;

notify pgrst, 'reload schema';

-- ─── Rollback (by hand) ────────────────────────────────────────────────────
-- begin;
-- alter table public.reviews drop constraint if exists reviews_booking_id_key;
-- delete from public.reviews where booking_id is not null;  -- only if the copies must go
-- alter table public.reviews drop column if exists booking_id;
-- drop index if exists public.disputes_one_live_per_booking;
-- drop index if exists public.disputes_one_live_per_equipment_booking;
-- alter table public.bookings drop constraint if exists bookings_status_before_dispute_check;
-- alter table public.bookings drop column if exists status_before_dispute;
-- alter table public.bookings drop column if exists disputed_at;
-- commit;
