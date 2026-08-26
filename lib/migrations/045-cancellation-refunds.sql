-- 038 — Automatic cancellation refunds for equipment bookings
--
-- Until now a customer cancellation only set status='cancelled' and
-- cancelled_at. No money moved, and the 24h/50% rule published in the Terms
-- was never applied by any code. These columns record what the tiered scale
-- in STUDIO.rental.cancellationTiers actually decided, so a refund can be
-- reconciled against the published policy afterwards.
--
-- Additive and nullable — safe to run on a live table.

alter table public.equipment_bookings
  add column if not exists cancellation_refund_amount numeric,
  add column if not exists cancellation_fee           numeric,
  add column if not exists cancellation_refund_percent integer,
  add column if not exists cancellation_refund_status text,
  add column if not exists cancellation_refund_error  text,
  add column if not exists cancellation_refunded_at   timestamptz;

comment on column public.equipment_bookings.cancellation_refund_amount is
  'Total refunded to the customer on cancellation: the refundable share of the hire charge plus the full security deposit.';
comment on column public.equipment_bookings.cancellation_fee is
  'Share of the hire charge retained under the tiered cancellation scale.';
comment on column public.equipment_bookings.cancellation_refund_percent is
  'The tier applied, as a percentage of the hire charge (100, 50 or 0).';
comment on column public.equipment_bookings.cancellation_refund_status is
  'pending | refunded | failed | not_required — not_required covers unpaid bookings and zero-value refunds.';

-- Guard the vocabulary so a typo cannot silently create a fourth state.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'equipment_bookings_cancellation_refund_status_check'
  ) then
    alter table public.equipment_bookings
      add constraint equipment_bookings_cancellation_refund_status_check
      check (
        cancellation_refund_status is null
        or cancellation_refund_status in ('pending', 'refunded', 'failed', 'not_required')
      );
  end if;
end $$;

-- Lets the admin dashboard find refunds that need a human.
create index if not exists idx_equipment_bookings_refund_status
  on public.equipment_bookings (cancellation_refund_status)
  where cancellation_refund_status in ('pending', 'failed');
