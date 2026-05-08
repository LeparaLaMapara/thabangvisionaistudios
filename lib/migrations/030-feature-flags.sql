-- Migration 030: Feature Flags + Audit Trail
-- Database-driven feature gating so admins can toggle features (starting with
-- Smart Productions) on/off from the admin UI without a deploy. The audit
-- trigger captures every change for future /admin/flags/history viewer.
--
-- RLS uses is_admin() helper from migration 016. Event inserts happen only
-- via the SECURITY DEFINER trigger — callers never insert directly.

CREATE TABLE IF NOT EXISTS feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS feature_flag_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key   text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  old_value  boolean,
  new_value  boolean,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_events_key ON feature_flag_events(flag_key);
CREATE INDEX IF NOT EXISTS idx_feature_flag_events_ts  ON feature_flag_events(changed_at DESC);

ALTER TABLE feature_flags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_reads_flags"    ON feature_flags;
DROP POLICY IF EXISTS "admins_manage_flags"   ON feature_flags;
DROP POLICY IF EXISTS "admins_read_events"    ON feature_flag_events;

CREATE POLICY "anyone_reads_flags"  ON feature_flags       FOR SELECT USING (true);
CREATE POLICY "admins_manage_flags" ON feature_flags       FOR ALL    USING (is_admin());
CREATE POLICY "admins_read_events"  ON feature_flag_events FOR SELECT USING (is_admin());

CREATE OR REPLACE FUNCTION log_feature_flag_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.enabled IS DISTINCT FROM NEW.enabled) THEN
    INSERT INTO feature_flag_events (flag_key, old_value, new_value, changed_by)
    VALUES (NEW.key, OLD.enabled, NEW.enabled, auth.uid());
  END IF;
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS feature_flags_audit ON feature_flags;
CREATE TRIGGER feature_flags_audit
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION log_feature_flag_change();

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('smart_productions',         true,  'Smart Productions marketplace'),
  ('smart_productions_booking', false, 'Smart Productions booking flow — depends on smart_productions'),
  ('studio_crews',              false, 'AI-assembled production crews (V5+)'),
  ('voice_onboarding',          false, 'Voice input for creator onboarding'),
  ('ai_rate_suggestions',       true,  'Claude-powered rate suggestions during onboarding'),
  ('ai_portfolio_tagging',      true,  'Gemma Vision portfolio auto-tagging')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE  feature_flags       IS 'Boolean feature gates managed by admins. Reads are public; writes are admin-only.';
COMMENT ON TABLE  feature_flag_events IS 'Append-only audit trail of flag toggles. Populated via trigger.';
