-- Migration 027: POPIA Consent Tracking
-- Records each user's consent to process personal information under the
-- Protection of Personal Information Act (South Africa).
-- Required before any ID document upload.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS popia_consent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS popia_consent_version  text,
  ADD COLUMN IF NOT EXISTS popia_consent_ip       inet,
  ADD COLUMN IF NOT EXISTS marketing_opt_in       boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_popia_consent_at
  ON profiles (popia_consent_at);

COMMENT ON COLUMN profiles.popia_consent_at      IS 'Timestamp of POPIA consent acceptance. NULL = consent not given.';
COMMENT ON COLUMN profiles.popia_consent_version IS 'Version of the privacy notice the user accepted (e.g. "2026.04.20").';
COMMENT ON COLUMN profiles.popia_consent_ip      IS 'IP address at time of consent — evidentiary record.';
COMMENT ON COLUMN profiles.marketing_opt_in      IS 'Separate opt-in for marketing emails. Default false per POPIA.';
