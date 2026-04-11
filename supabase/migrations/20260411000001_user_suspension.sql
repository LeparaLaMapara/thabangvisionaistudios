-- Add suspension columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspension_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_suspended ON profiles(is_suspended) WHERE is_suspended = true;

-- Moderation audit log
CREATE TABLE IF NOT EXISTS moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN (
    'suspended', 'reinstated', 'warning_issued', 'listing_removed', 'verification_rejected'
  )),
  reason TEXT NOT NULL,
  admin_id UUID NOT NULL REFERENCES profiles(id),
  dispute_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_log_user ON moderation_log(user_id);
ALTER TABLE moderation_log ENABLE ROW LEVEL SECURITY;
