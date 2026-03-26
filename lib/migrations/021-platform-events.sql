-- Migration 021: Platform Events table — raw data collection system
-- One table collects everything. One function logs everything.

CREATE TABLE IF NOT EXISTS platform_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What happened
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,

  -- Who did it
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT,

  -- Where it happened
  page_url TEXT,

  -- Event-specific data (flexible)
  metadata JSONB DEFAULT '{}',

  -- When
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_events_type ON platform_events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_category ON platform_events (event_category);
CREATE INDEX IF NOT EXISTS idx_events_user ON platform_events (user_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON platform_events (created_at);

-- Partial indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_bookings ON platform_events (created_at)
  WHERE event_category = 'booking';
CREATE INDEX IF NOT EXISTS idx_events_search ON platform_events (created_at)
  WHERE event_category = 'search';
CREATE INDEX IF NOT EXISTS idx_events_chat ON platform_events (created_at)
  WHERE event_category = 'chat';

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_events_metadata ON platform_events USING gin (metadata);

-- RLS
ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

-- System inserts events (service role only)
CREATE POLICY "System inserts events" ON platform_events
  FOR INSERT WITH CHECK (true);

-- Admin reads all events (restrict in API layer)
CREATE POLICY "Admin reads all events" ON platform_events
  FOR SELECT USING (true);
