-- Add return tracking columns to equipment_bookings
ALTER TABLE equipment_bookings
  ADD COLUMN IF NOT EXISTS condition_at_checkout TEXT
    CHECK (condition_at_checkout IN ('new', 'like_new', 'good', 'fair', 'for_parts')),
  ADD COLUMN IF NOT EXISTS condition_at_return TEXT
    CHECK (condition_at_return IN ('new', 'like_new', 'good', 'fair', 'for_parts')),
  ADD COLUMN IF NOT EXISTS checkout_photos JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS return_photos JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS return_notes TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_released NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS late_fee NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS return_reviewed_at TIMESTAMPTZ;

-- Expand status enum to include return states
ALTER TABLE equipment_bookings
  DROP CONSTRAINT IF EXISTS equipment_bookings_status_check;
ALTER TABLE equipment_bookings
  ADD CONSTRAINT equipment_bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'active',
    'return_pending', 'return_reviewed', 'completed',
    'cancelled', 'overdue', 'disputed'
  ));
