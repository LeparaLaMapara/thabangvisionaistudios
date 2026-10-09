-- LOCAL REPLICA ONLY -- NOT A FIX. Lets the journeys get past a real DB bug.
--
-- Finding (for the DB step): booking_payments.status has
--   CHECK (status IN ('pending','complete','failed','refunded'))   (base schema)
-- but confirm_rental_payment (migration 070) runs
--   update booking_payments set status = 'succeeded' ...
-- inside the same transaction as the intent/ledger/outbox writes, so the CHECK
-- violation rolls back every webhook confirmation of a gear payment
-- ("confirm_rental_payment failed: ... booking_payments_status_check").
-- The app code (fulfil.ts, mark-paid, payfast webhook, invariants cron) also
-- uses 'succeeded'. The real fix belongs in a new migration.
alter table public.booking_payments drop constraint if exists booking_payments_status_check;
alter table public.booking_payments add constraint booking_payments_status_check
  check (status in ('pending', 'complete', 'succeeded', 'failed', 'refunded'));
