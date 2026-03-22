-- 013: Add 'expired', 'paid', 'in_progress' to crew_requests status CHECK constraint
-- Required by: 48-hour lazy expiry for pending crew requests
-- Run in Supabase SQL Editor

-- The original CHECK constraint from 007-crew-system.sql only allows:
--   ('pending', 'contacted', 'confirmed', 'declined', 'completed', 'cancelled')
-- We need to add: 'expired', 'paid', 'in_progress'

-- Drop the old constraint and recreate with all statuses
ALTER TABLE crew_requests DROP CONSTRAINT IF EXISTS crew_requests_status_check;

ALTER TABLE crew_requests ADD CONSTRAINT crew_requests_status_check
  CHECK (status IN (
    'pending',
    'contacted',
    'confirmed',
    'declined',
    'completed',
    'cancelled',
    'paid',
    'in_progress',
    'expired'
  ));

-- Index for lazy expiry queries (find stale pending requests efficiently)
CREATE INDEX IF NOT EXISTS idx_crew_requests_pending_created
  ON crew_requests (created_at)
  WHERE status = 'pending';
