-- 066: pay by EFT or cash at collection (while online card payment is off).
--
-- equipment_bookings.payment_method  'eft', 'cash' (at collection) or 'online'.
-- equipment_bookings.amount_due      what the customer owes for the whole order,
--                                    stored on the order's first line (like
--                                    delivery_fee), so the pay screen, the email
--                                    and the owner all see the same figure.
-- notifications: the pay-by-EFT messages.
-- Additive. Apply on dev, then production.

alter table public.equipment_bookings
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('eft', 'cash', 'online')),
  add column if not exists amount_due numeric;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed', 'gig_cancelled', 'gig_expired',
  'gig_paid', 'gig_unassigned',
  'booking_accepted', 'booking_rejected', 'booking_completed', 'booking_cancelled', 'booking_reassigned',
  'booking_admin_cancelled', 'booking_admin_completed', 'booking_assigned', 'booking_confirmed',
  'booking_delivered', 'booking_expired',
  'payment_received', 'payment_confirmed',
  'payout_initiated', 'payout_completed', 'payout_complete', 'payout_processing',
  'rental_overdue', 'rental_return_pending', 'rental_return_reviewed',
  'dispute_filed', 'dispute_updated', 'dispute_comment',
  'cart_reminder',
  'creator_arrived', 'work_delivered',
  'gear_confirmed', 'gear_collect_tomorrow', 'gear_return_tomorrow', 'gear_settled', 'gear_not_returned',
  'gear_awaiting_payment', 'gear_payment_reminder', 'gear_payment_released'
]::text[]));
