-- Migration 022: Add payout retry tracking and pending_reassignment status
-- Run in Supabase SQL Editor on both prod and dev

-- Add retry counter for failed payouts (auto-retry up to 3 times)
alter table bookings add column if not exists payout_retry_count int default 0;

-- Allow 'pending_reassignment' as a valid booking status
-- (bookings use text status, no enum constraint — this is just documentation)
comment on column bookings.payout_retry_count is 'Number of payout retry attempts (max 3). Reset on success.';
