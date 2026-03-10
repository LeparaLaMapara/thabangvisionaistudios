-- Ubunye AI daily usage tracking per user
-- Resets daily at midnight SAST (tracked by date column)

CREATE TABLE IF NOT EXISTS ubunye_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Africa/Johannesburg')::date,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per user per day
  UNIQUE (user_id, date)
);

-- Index for fast lookups by user + date
CREATE INDEX IF NOT EXISTS idx_ubunye_usage_user_date ON ubunye_usage (user_id, date);

-- Enable RLS
ALTER TABLE ubunye_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own usage
CREATE POLICY "Users can view own usage"
  ON ubunye_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own usage (via API)
CREATE POLICY "Users can insert own usage"
  ON ubunye_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own usage (increment count)
CREATE POLICY "Users can update own usage"
  ON ubunye_usage FOR UPDATE
  USING (auth.uid() = user_id);
