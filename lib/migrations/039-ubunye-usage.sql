-- ============================================================================
-- Migration 039: ubunye_usage — per-user daily AI message tracking
-- ============================================================================
-- Tracks daily message counts per user for AI rate limiting.
-- Without this table, all per-agent daily limits are silently bypassed
-- because Supabase PostgREST returns null for nonexistent tables and
-- the runtime treats null as "no usage yet."
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ubunye_usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ubunye_usage_user_date ON ubunye_usage(user_id, date);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ubunye_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage"
  ON ubunye_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage"
  ON ubunye_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage"
  ON ubunye_usage FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on ubunye_usage"
  ON ubunye_usage FOR ALL
  USING (auth.role() = 'service_role'::text);
