-- 089: the drop-off PIN for a courier leg (Uber Direct pincode).
--
-- Needs 076 (delivery_shipments). One transaction, safe to run twice.
--
-- WHAT THIS DOES
--   delivery_shipments.recipient_pin: the PIN the courier asks for at the
--   drop-off. Uber Direct makes it when the delivery is created (checked in
--   our sandbox 2026-10-14: dropoff.verification_requirements.pincode.value)
--   and texts it to the drop-off phone itself. We keep a copy so the renter
--   also sees it on their booking and in the "on the way" email.
--
--   Only the server reads it: signed-in users have no table grant on
--   delivery_shipments (reads go through the site, which shows the PIN to
--   the renter of an outbound leg only).
--
-- ROLLBACK
--   alter table public.delivery_shipments drop column if exists recipient_pin;

begin;

alter table public.delivery_shipments add column if not exists recipient_pin text;

alter table public.delivery_shipments drop constraint if exists delivery_shipments_recipient_pin_check;
alter table public.delivery_shipments add constraint delivery_shipments_recipient_pin_check
  check (recipient_pin is null or recipient_pin ~ '^[0-9]{4,8}$');

comment on column public.delivery_shipments.recipient_pin is
  'Drop-off PIN made by the courier (Uber Direct pincode). Shown only to the renter of an outbound leg.';

commit;

notify pgrst, 'reload schema';
