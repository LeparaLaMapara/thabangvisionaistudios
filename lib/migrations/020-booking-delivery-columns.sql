-- Migration 020: Add delivery columns to bookings table
-- Supports the delivery workflow: creator delivers → client approves → auto-payout

-- Add delivery fields
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_message TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Update status CHECK to include 'delivered'
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'paid', 'accepted', 'delivered', 'completed', 'paid_out', 'cancelled', 'disputed'));
