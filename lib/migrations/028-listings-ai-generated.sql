-- Phase 3: auto-create draft rental listings from identified gear.
-- Adds an AI-generated flag so the dashboard can surface drafts with a
-- "Review & publish" affordance, and a portfolio_tag_corrections table
-- (Phase 4 feedback loop — created here so both phases can land together).
-- Run manually in Supabase SQL Editor.

ALTER TABLE smart_rentals
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT false;

COMMENT ON COLUMN smart_rentals.is_ai_generated IS
  'True when the listing was drafted automatically from portfolio gear detection. Drafts stay is_published=false until the owner reviews and publishes.';

CREATE INDEX IF NOT EXISTS idx_smart_rentals_ai_generated_drafts
  ON smart_rentals (owner_id)
  WHERE is_ai_generated = true AND is_published = false AND deleted_at IS NULL;

-- Tag-correction training signal (Phase 4 §2.3)
CREATE TABLE IF NOT EXISTS portfolio_tag_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  original_tag TEXT NOT NULL,
  corrected_tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_tag_corrections_creator
  ON portfolio_tag_corrections (creator_id);

ALTER TABLE portfolio_tag_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators can view their own corrections"
  ON portfolio_tag_corrections FOR SELECT
  USING (creator_id = auth.uid());

CREATE POLICY "Creators can insert their own corrections"
  ON portfolio_tag_corrections FOR INSERT
  WITH CHECK (creator_id = auth.uid());
