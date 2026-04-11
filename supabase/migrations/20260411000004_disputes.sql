-- ─── Disputes system ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_type TEXT NOT NULL CHECK (dispute_type IN (
    'gear_damage', 'gear_not_returned', 'creator_no_show',
    'client_cancellation', 'quality_dispute', 'payment_dispute'
  )),
  booking_id UUID,
  equipment_booking_id UUID,
  filed_by UUID NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  evidence_photos JSONB DEFAULT '[]',
  evidence_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'investigating', 'resolved', 'escalated', 'dismissed'
  )),
  resolution TEXT CHECK (resolution IN (
    'full_refund', 'partial_refund', 'deposit_forfeit',
    'warning_issued', 'user_suspended', 'no_action', 'custom'
  )),
  resolution_amount NUMERIC,
  resolution_notes TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_filed_by ON disputes(filed_by);
CREATE INDEX IF NOT EXISTS idx_disputes_booking ON disputes(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disputes_equipment ON disputes(equipment_booking_id) WHERE equipment_booking_id IS NOT NULL;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dispute_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  comment TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_comments_dispute ON dispute_comments(dispute_id);
ALTER TABLE dispute_comments ENABLE ROW LEVEL SECURITY;

-- Add dispute columns to equipment_bookings if not present
ALTER TABLE equipment_bookings
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
