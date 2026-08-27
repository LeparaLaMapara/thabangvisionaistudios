-- 052 — Let the database accept the values the code actually writes
--
-- Two CHECK constraints had drifted behind the application, and because
-- supabase-js returns { data, error } rather than throwing, every rejected
-- write was discarded at the destructuring site and never surfaced.
--
-- 1. NOTIFICATIONS
--
-- notifications_type_check permitted 16 values. The code inserts 23. Fifteen of
-- them were rejected by Postgres with 23514 on every attempt, so the majority of
-- the notification system has been a silent no-op in production:
--
--   rental_overdue          a hirer is never told their gear is late
--   rental_return_pending   nobody is told a return needs inspection
--   rental_return_reviewed  nobody is told what happened to their deposit
--   dispute_filed           no party is told a dispute was opened
--   dispute_updated         no party is told it moved
--   dispute_comment         no party is told someone replied
--   payout_complete         a creator is never told they were paid
--   payout_processing       a creator is never told a payout started
--   payment_confirmed       a client is never told their payment landed
--   booking_confirmed       a client is never told the booking is on
--   booking_delivered       a client is never told deliverables arrived
--   booking_assigned        a creator is never told they got the job
--   gig_paid                a creator is never told a gig was paid
--   gig_unassigned          a creator is never told they were removed
--   cart_reminder           an abandoned cart is never chased
--
-- Widening the vocabulary rather than collapsing 23 meanings into 16 is
-- deliberate: the granularity is real and the UI keys off it.
--
-- 2. BOOKINGS
--
-- daily-maintenance writes status = 'pending_reassignment' when a creator has
-- gone unresponsive. That value was not in bookings_status_check, so the write
-- failed, the creator was never unassigned, and the booking stayed exactly as
-- it was -- while an admin was emailed telling them to reassign it, and the
-- creator was notified they had been removed. The admin acted on a state that
-- did not exist.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    -- Gigs
    'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed',
    'gig_cancelled', 'gig_expired', 'gig_paid', 'gig_unassigned',
    -- Bookings
    'booking_accepted', 'booking_rejected', 'booking_completed',
    'booking_cancelled', 'booking_reassigned', 'booking_admin_cancelled',
    'booking_admin_completed', 'booking_assigned', 'booking_confirmed',
    'booking_delivered',
    -- Money
    'payment_received', 'payment_confirmed',
    'payout_initiated', 'payout_completed', 'payout_complete', 'payout_processing',
    -- Equipment hire
    'rental_overdue', 'rental_return_pending', 'rental_return_reviewed',
    -- Disputes
    'dispute_filed', 'dispute_updated', 'dispute_comment',
    -- Cart
    'cart_reminder'
  ]));

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status = any (array[
    'pending', 'paid', 'accepted', 'delivered', 'completed',
    'paid_out', 'cancelled', 'disputed', 'pending_reassignment'
  ]));

comment on constraint notifications_type_check on public.notifications is
  'Must stay in sync with every type literal inserted into notifications by app/ and lib/. A value missing here fails with 23514 and is discarded silently, because supabase-js returns an error rather than throwing.';
