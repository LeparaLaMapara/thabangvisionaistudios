-- 040 — Give service bookings a real shoot date
--
-- bookings.preferred_dates is a text column, so nothing could measure how much
-- notice a client gave when cancelling. The published policy said 48 hours and
-- no code could check it, which is why service cancellations were assessed by
-- hand and refunded by email.
--
-- The booking form has always used <input type="date">, so in practice the
-- column already holds clean YYYY-MM-DD values. This promotes those to a real
-- date column. preferred_dates stays, because the Ubunye assistant can write
-- genuinely free text into it ("first week of March").
--
-- Additive and nullable — safe to run on a live table.

alter table public.bookings
  add column if not exists shoot_date date;

-- Backfill only where the existing text really is a date. Anything else is
-- left null and continues to be handled by a person.
update public.bookings
   set shoot_date = preferred_dates::date
 where shoot_date is null
   and preferred_dates ~ '^\d{4}-\d{2}-\d{2}$';

comment on column public.bookings.shoot_date is
  'The agreed shoot date. Drives the automatic cancellation scale in STUDIO.booking.cancellationTiers. Null means cancellation must be assessed manually.';

-- Records what an automatic cancellation decided, so a refund can be
-- reconciled against the published policy afterwards. Mirrors the equipment
-- side added in migration 038.
alter table public.bookings
  add column if not exists cancellation_refund_amount numeric,
  add column if not exists cancellation_refund_percent integer,
  add column if not exists cancellation_refund_status text,
  add column if not exists cancellation_refund_error  text,
  add column if not exists cancellation_refunded_at   timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_cancellation_refund_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_cancellation_refund_status_check
      check (
        cancellation_refund_status is null
        or cancellation_refund_status in ('pending', 'refunded', 'failed', 'manual_review', 'not_required')
      );
  end if;
end $$;

comment on column public.bookings.cancellation_refund_status is
  'pending | refunded | failed | manual_review | not_required. manual_review covers bookings with no shoot_date, where notice cannot be measured.';

create index if not exists idx_bookings_refund_status
  on public.bookings (cancellation_refund_status)
  where cancellation_refund_status in ('pending', 'failed', 'manual_review');
