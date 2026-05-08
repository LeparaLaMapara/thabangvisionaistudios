-- Migration 031: Harden Admin RLS Policies
-- Replaces USING (true) with USING (is_admin()) on all admin-management policies.
-- Requires is_admin() function from migration 016 (admin_app_metadata).
--
-- Before: any authenticated user matched admin policies (app code enforced access).
-- After:  only JWT-verified admins pass RLS — defence in depth.

BEGIN;

-- ═══ smart_productions ═══
DROP POLICY IF EXISTS "Admins can manage productions" ON smart_productions;
CREATE POLICY "Admins can manage productions"
  ON smart_productions FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ smart_rentals ═══
DROP POLICY IF EXISTS "Admins can manage rentals" ON smart_rentals;
CREATE POLICY "Admins can manage rentals"
  ON smart_rentals FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ press ═══
DROP POLICY IF EXISTS "Admins can manage press" ON press;
CREATE POLICY "Admins can manage press"
  ON press FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ careers ═══
DROP POLICY IF EXISTS "Admins can manage careers" ON careers;
CREATE POLICY "Admins can manage careers"
  ON careers FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ equipment_bookings ═══
DROP POLICY IF EXISTS "Admins can manage all bookings" ON equipment_bookings;
CREATE POLICY "Admins can manage all bookings"
  ON equipment_bookings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ booking_payments ═══
DROP POLICY IF EXISTS "Admins can manage booking payments" ON booking_payments;
CREATE POLICY "Admins can manage booking payments"
  ON booking_payments FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ invoices ═══
DROP POLICY IF EXISTS "Admins can manage invoices" ON invoices;
CREATE POLICY "Admins can manage invoices"
  ON invoices FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ listings ═══
DROP POLICY IF EXISTS "Admins can manage listings" ON listings;
CREATE POLICY "Admins can manage listings"
  ON listings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ orders ═══
DROP POLICY IF EXISTS "Admins can manage orders" ON orders;
CREATE POLICY "Admins can manage orders"
  ON orders FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ subscription_plans ═══
DROP POLICY IF EXISTS "Admins can manage plans" ON subscription_plans;
CREATE POLICY "Admins can manage plans"
  ON subscription_plans FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ═══ subscriptions ═══
DROP POLICY IF EXISTS "Admins can manage subscriptions" ON subscriptions;
CREATE POLICY "Admins can manage subscriptions"
  ON subscriptions FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

COMMIT;
