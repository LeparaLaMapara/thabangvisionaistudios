-- 002-unified-marketplace.sql
-- Adds community-listing columns to smart_rentals, creates rental_reviews,
-- and adds ranking/owner indexes.
-- Safe to re-run thanks to IF NOT EXISTS / IF NOT EXISTS guards.

BEGIN;

-- ─── Extend smart_rentals with owner + ranking columns ──────────────────────

ALTER TABLE smart_rentals
  ADD COLUMN IF NOT EXISTS owner_type  TEXT        DEFAULT 'studio',
  ADD COLUMN IF NOT EXISTS owner_id    UUID        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS ranking_score  NUMERIC  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_rentals  INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count   INTEGER  DEFAULT 0;

-- ─── rental_reviews table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rental_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id   UUID NOT NULL REFERENCES smart_rentals(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_smart_rentals_ranking_score
  ON smart_rentals (ranking_score DESC);

CREATE INDEX IF NOT EXISTS idx_smart_rentals_owner_type
  ON smart_rentals (owner_type);

CREATE INDEX IF NOT EXISTS idx_rental_reviews_rental_id
  ON rental_reviews (rental_id);

COMMIT;
