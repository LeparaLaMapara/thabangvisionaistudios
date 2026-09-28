-- 065: allow every notification type the code sends.
--
-- notifications.type has a fixed list. Types added in code but not here were
-- refused by the database, and the insert failed silently: the renter was
-- never told their gear was booked, the client never heard their creator had
-- arrived or delivered, and "gear not returned" notices never landed.
-- Keep this list in step with the code (grep "type: '" near notifications inserts).

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
  'gear_confirmed', 'gear_collect_tomorrow', 'gear_return_tomorrow', 'gear_settled', 'gear_not_returned'
]::text[]));
