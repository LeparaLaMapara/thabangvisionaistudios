-- ============================================================================
-- Migration 040: Sprint A — P0 security & data integrity fixes
-- ============================================================================
-- Fixes identified in the architecture audit:
--   P0-2: chat_faqs RLS grants any user full write access
--   P0-3: booking_payments has no idempotency constraint
--   P0-4: CASCADE on financial FKs destroys audit trail on user delete
--   Bonus: drop 7 duplicate indexes
-- ============================================================================

-- ── P0-2: Fix chat_faqs RLS ────────────────────────────────────────────────
-- The original policy uses USING(true) which grants all roles full access.
-- It should be restricted to service_role only (matching ai_token_usage pattern).
DROP POLICY IF EXISTS "Service role full access on chat_faqs" ON chat_faqs;

CREATE POLICY "Service role full access on chat_faqs"
  ON chat_faqs FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ── P0-3: Add idempotency constraint to booking_payments ────────────────────
-- Prevents duplicate payment records from Paystack webhook retries.
-- The payfast_payment_id column stores the provider's payment reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_payments_idempotency
  ON booking_payments(booking_id, payfast_payment_id)
  WHERE payfast_payment_id IS NOT NULL;

-- ── P0-4: Change CASCADE to RESTRICT on financial foreign keys ──────────────
-- Prevents accidental destruction of financial records when users are deleted.
-- equipment_bookings.user_id
ALTER TABLE equipment_bookings DROP CONSTRAINT IF EXISTS equipment_bookings_user_id_fkey;
ALTER TABLE equipment_bookings ADD CONSTRAINT equipment_bookings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- orders.buyer_id
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_buyer_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- orders.seller_id
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_seller_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- subscriptions.user_id
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- ── Bonus: Drop 7 duplicate indexes ────────────────────────────────────────
DROP INDEX IF EXISTS idx_equipment_bookings_rental;
DROP INDEX IF EXISTS idx_equipment_bookings_user;
DROP INDEX IF EXISTS idx_orders_buyer_id;
DROP INDEX IF EXISTS idx_orders_seller_id;
DROP INDEX IF EXISTS idx_orders_listing_id;
DROP INDEX IF EXISTS idx_listings_user_id;
DROP INDEX IF EXISTS idx_subscriptions_user_id;
