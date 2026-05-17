-- 035: Creator Productions Infrastructure
-- Adds submitted_at column for 7-day auto-publish window,
-- index on creator_id, and unique constraint to prevent duplicate creator entries.

ALTER TABLE smart_productions
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_smart_productions_creator_id
  ON smart_productions (creator_id)
  WHERE creator_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_productions_one_per_creator
  ON smart_productions (creator_id)
  WHERE creator_id IS NOT NULL AND deleted_at IS NULL;
