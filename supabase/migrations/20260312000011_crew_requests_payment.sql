-- Add payment fields to crew_requests
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS payment_id text;

-- Note: 'paid' status for crew_requests is tracked in the status text field
-- The existing status column is already text type, so 'paid' and 'in_progress' work without migration
