-- 019-consolidate-reviews.sql
-- Consolidate reviews, crew_reviews, rental_reviews into a single unified reviews table.
-- All 3 tables have 0 rows so this is a safe schema change.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP old tables (all empty, no data loss)
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS crew_reviews CASCADE;
DROP TABLE IF EXISTS rental_reviews CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 2. CREATE unified reviews table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type   TEXT NOT NULL CHECK (review_type IN ('order', 'crew', 'rental')),

  -- Who wrote the review
  reviewer_id   UUID REFERENCES profiles(id),
  reviewer_name TEXT,
  reviewer_email TEXT,

  -- Who/what is being reviewed (polymorphic — use the one matching review_type)
  reviewee_id   UUID REFERENCES profiles(id),      -- for order + crew reviews
  rental_id     UUID REFERENCES smart_rentals(id),  -- for rental reviews
  order_id      UUID REFERENCES orders(id),         -- for order reviews
  request_id    UUID REFERENCES crew_requests(id),  -- for crew reviews

  -- Review content
  rating        SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT,
  is_published  BOOLEAN NOT NULL DEFAULT true,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_reviews_type ON reviews(review_type);
CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id) WHERE reviewee_id IS NOT NULL;
CREATE INDEX idx_reviews_rental ON reviews(rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX idx_reviews_order ON reviews(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_reviews_request ON reviews(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_id) WHERE reviewer_id IS NOT NULL;

-- RLS policies
CREATE POLICY "Public can view published reviews"
  ON reviews FOR SELECT
  USING (is_published = true);

CREATE POLICY "Users can insert own reviews"
  ON reviews FOR INSERT
  WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "Users can update own reviews"
  ON reviews FOR UPDATE
  USING (auth.uid() = reviewer_id);

-- Updated_at trigger function (create if not exists)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 3. ADD NOT NULL + defaults on nullable status columns
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE bookings ALTER COLUMN status SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE crew_requests ALTER COLUMN status SET NOT NULL;
ALTER TABLE crew_requests ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE bookings ALTER COLUMN payment_status SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN payment_status SET DEFAULT 'unpaid';

ALTER TABLE bookings ALTER COLUMN payout_status SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN payout_status SET DEFAULT 'pending';
