-- 018-database-cleanup.sql
-- Fixes critical issues found in DATABASE_AUDIT.md

-- ═══════════════════════════════════════════════════════════════
-- 1. FIX: notifications.type CHECK constraint (CRITICAL)
--    Current constraint blocks booking/payout notification types
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'gig_request', 'gig_confirmed', 'gig_declined', 'gig_completed',
    'gig_cancelled', 'gig_expired', 'payment_received',
    'booking_accepted', 'booking_rejected', 'booking_completed',
    'booking_cancelled', 'booking_reassigned',
    'booking_admin_cancelled', 'booking_admin_completed',
    'payout_initiated', 'payout_completed'
  ));

-- ═══════════════════════════════════════════════════════════════
-- 2. ADD: Missing FK indexes (performance)
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_user ON equipment_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_rental ON equipment_bookings(rental_id);
CREATE INDEX IF NOT EXISTS idx_crew_requests_creator ON crew_requests(creator_id);
CREATE INDEX IF NOT EXISTS idx_smart_rentals_owner ON smart_rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_rental ON cart_items(rental_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. DROP: Dead embedding columns (all use content_embeddings)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles DROP COLUMN IF EXISTS embedding;
ALTER TABLE smart_rentals DROP COLUMN IF EXISTS embedding;
ALTER TABLE smart_productions DROP COLUMN IF EXISTS embedding;
ALTER TABLE press DROP COLUMN IF EXISTS embedding;
ALTER TABLE careers DROP COLUMN IF EXISTS embedding;

-- ═══════════════════════════════════════════════════════════════
-- 4. DROP: Dead tables
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS smart_crew_members CASCADE;
DROP TABLE IF EXISTS smart_crews CASCADE;
DROP TABLE IF EXISTS contact_messages CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 5. ADD: Missing FK on rental_reviews
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rental_reviews_reviewer_id_fkey'
  ) THEN
    ALTER TABLE rental_reviews
      ADD CONSTRAINT rental_reviews_reviewer_id_fkey
      FOREIGN KEY (reviewer_id) REFERENCES profiles(id);
  END IF;
END $$;
