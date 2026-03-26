-- Migration 024: AI Token Usage Tracking
-- Tracks token consumption per chat request for budget monitoring

CREATE TABLE IF NOT EXISTS ai_token_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens  integer NOT NULL DEFAULT 0,
  estimated_cost numeric(10,6) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for monthly aggregation queries (budget checks)
CREATE INDEX idx_ai_token_usage_created ON ai_token_usage (created_at);
CREATE INDEX idx_ai_token_usage_user    ON ai_token_usage (user_id);

-- Budget alert log — prevents duplicate alerts within the same billing period
CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period      text NOT NULL,           -- e.g. '2026-03'
  threshold   integer NOT NULL,        -- e.g. 80 (percent)
  spend       numeric(10,2) NOT NULL,  -- actual spend at time of alert
  budget      numeric(10,2) NOT NULL,  -- monthly budget at time of alert
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(period, threshold)            -- only one alert per threshold per period
);

-- RLS
ALTER TABLE ai_token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_alerts ENABLE ROW LEVEL SECURITY;

-- Service role only — no user-facing access needed
CREATE POLICY "Service role full access" ON ai_token_usage
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON ai_budget_alerts
  FOR ALL USING (auth.role() = 'service_role');
