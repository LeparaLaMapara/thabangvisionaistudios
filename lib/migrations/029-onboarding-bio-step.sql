-- Phase 2b: Auto-bio writer adds a "Bio" step between Skills and Review.
-- Onboarding flow grows from 5 to 6 steps.
-- Run manually in Supabase SQL Editor.

ALTER TABLE onboarding_progress
  ADD COLUMN IF NOT EXISTS step_6_complete BOOLEAN DEFAULT false;

COMMENT ON COLUMN onboarding_progress.step_6_complete IS
  'Set when creator completes the Gear listing step (final step).';
