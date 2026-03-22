-- ═══════════════════════════════════════════════════════════════════════════════
-- 000: Base Schema — Foundational tables created before all other migrations
-- These tables were originally created manually in the Supabase dashboard.
-- This migration codifies them so new environments can be bootstrapped from scratch.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. profiles ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio          TEXT,
  avatar_url   TEXT,
  avatar_public_id TEXT,
  skills       TEXT[] DEFAULT '{}',
  social_links JSONB DEFAULT '{}',
  location     TEXT,
  phone        TEXT,
  is_verified  BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view profiles"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ═══ 2. smart_productions ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS smart_productions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  client          TEXT,
  year            INTEGER,
  project_type    TEXT,
  sub_category    TEXT,
  description     TEXT,
  video_provider  TEXT,
  video_url       TEXT,
  tags            TEXT[] DEFAULT '{}',
  thumbnail_url   TEXT,
  cover_public_id TEXT,
  gallery         JSONB DEFAULT '[]',
  is_published    BOOLEAN DEFAULT FALSE,
  is_featured     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE smart_productions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published productions"
  ON smart_productions FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Admins can manage productions"
  ON smart_productions FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_smart_productions_slug
  ON smart_productions (slug);

CREATE INDEX IF NOT EXISTS idx_smart_productions_published
  ON smart_productions (is_published)
  WHERE is_published = true AND deleted_at IS NULL;

-- ═══ 3. smart_rentals ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS smart_rentals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  sub_category    TEXT,
  brand           TEXT,
  model           TEXT,
  price_per_day   NUMERIC,
  price_per_week  NUMERIC,
  deposit_amount  NUMERIC,
  currency        TEXT DEFAULT 'ZAR',
  thumbnail_url   TEXT,
  cover_public_id TEXT,
  gallery         JSONB DEFAULT '[]',
  is_available    BOOLEAN DEFAULT TRUE,
  quantity        INTEGER DEFAULT 1,
  is_published    BOOLEAN DEFAULT FALSE,
  is_featured     BOOLEAN DEFAULT FALSE,
  is_archived     BOOLEAN DEFAULT FALSE,
  tags            TEXT[] DEFAULT '{}',
  features        TEXT[] DEFAULT '{}',
  rental_includes TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  video_provider  TEXT,
  video_url       TEXT,
  video_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE smart_rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published rentals"
  ON smart_rentals FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Admins can manage rentals"
  ON smart_rentals FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_smart_rentals_slug
  ON smart_rentals (slug);

CREATE INDEX IF NOT EXISTS idx_smart_rentals_category
  ON smart_rentals (category);

CREATE INDEX IF NOT EXISTS idx_smart_rentals_published
  ON smart_rentals (is_published)
  WHERE is_published = true AND deleted_at IS NULL;

-- ═══ 4. press ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS press (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  content         TEXT,
  excerpt         TEXT,
  cover_url       TEXT,
  cover_public_id TEXT,
  author          TEXT,
  category        TEXT,
  published_at    TIMESTAMPTZ,
  is_published    BOOLEAN DEFAULT FALSE,
  is_featured     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE press ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published press"
  ON press FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Admins can manage press"
  ON press FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_press_slug
  ON press (slug);

CREATE INDEX IF NOT EXISTS idx_press_published
  ON press (is_published, published_at DESC)
  WHERE is_published = true AND deleted_at IS NULL;

-- ═══ 5. careers ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS careers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  department      TEXT,
  location        TEXT,
  description     TEXT,
  employment_type TEXT,
  requirements    TEXT[] DEFAULT '{}',
  is_published    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE careers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published careers"
  ON careers FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Admins can manage careers"
  ON careers FOR ALL
  USING (true);

-- ═══ 6. equipment_bookings ═════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equipment_bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rental_id          UUID NOT NULL REFERENCES smart_rentals(id) ON DELETE CASCADE,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  total_price        NUMERIC NOT NULL,
  deposit_amount     NUMERIC,
  currency           TEXT DEFAULT 'ZAR',
  status             TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled', 'overdue')),
  notes              TEXT,
  payfast_payment_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at       TIMESTAMPTZ,

  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

ALTER TABLE equipment_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bookings"
  ON equipment_bookings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own bookings"
  ON equipment_bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bookings"
  ON equipment_bookings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all bookings"
  ON equipment_bookings FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_equipment_bookings_user
  ON equipment_bookings (user_id);

CREATE INDEX IF NOT EXISTS idx_equipment_bookings_rental
  ON equipment_bookings (rental_id);

CREATE INDEX IF NOT EXISTS idx_equipment_bookings_status
  ON equipment_bookings (status);

CREATE INDEX IF NOT EXISTS idx_equipment_bookings_dates
  ON equipment_bookings (rental_id, start_date, end_date)
  WHERE status NOT IN ('cancelled');

-- ═══ 7. booking_payments ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         UUID NOT NULL REFERENCES equipment_bookings(id) ON DELETE CASCADE,
  payfast_payment_id TEXT,
  amount             NUMERIC NOT NULL,
  currency           TEXT DEFAULT 'ZAR',
  status             TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'complete', 'failed', 'refunded')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own booking payments"
  ON booking_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM equipment_bookings eb
      WHERE eb.id = booking_payments.booking_id
        AND eb.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage booking payments"
  ON booking_payments FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON booking_payments (booking_id);

-- ═══ 8. invoices ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES equipment_bookings(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  amount         NUMERIC NOT NULL,
  currency       TEXT DEFAULT 'ZAR',
  status         TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  pdf_url        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own invoices"
  ON invoices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM equipment_bookings eb
      WHERE eb.id = invoices.booking_id
        AND eb.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage invoices"
  ON invoices FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_invoices_booking
  ON invoices (booking_id);

-- ═══ 9. listings ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('sell', 'rent', 'service')),
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  price           NUMERIC,
  pricing_model   TEXT DEFAULT 'fixed'
    CHECK (pricing_model IN ('fixed', 'hourly', 'daily', 'weekly', 'monthly', 'negotiable')),
  currency        TEXT DEFAULT 'ZAR',
  category        TEXT,
  sub_category    TEXT,
  thumbnail_url   TEXT,
  cover_public_id TEXT,
  gallery         JSONB DEFAULT '[]',
  location        TEXT,
  condition       TEXT CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'for_parts') OR condition IS NULL),
  is_published    BOOLEAN DEFAULT FALSE,
  is_featured     BOOLEAN DEFAULT FALSE,
  tags            TEXT[] DEFAULT '{}',
  features        TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published listings"
  ON listings FOR SELECT
  USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Users can create own listings"
  ON listings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own listings"
  ON listings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own listings"
  ON listings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage listings"
  ON listings FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_listings_user
  ON listings (user_id);

CREATE INDEX IF NOT EXISTS idx_listings_slug
  ON listings (slug);

CREATE INDEX IF NOT EXISTS idx_listings_category
  ON listings (category);

CREATE INDEX IF NOT EXISTS idx_listings_published
  ON listings (is_published)
  WHERE is_published = true AND deleted_at IS NULL;

-- ═══ 10. orders ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id         UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  status             TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed', 'refunded')),
  total              NUMERIC NOT NULL,
  platform_fee       NUMERIC NOT NULL,
  seller_payout      NUMERIC NOT NULL,
  currency           TEXT DEFAULT 'ZAR',
  payfast_payment_id TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view own orders"
  ON orders FOR SELECT
  USING (auth.uid() = buyer_id);

CREATE POLICY "Sellers can view own orders"
  ON orders FOR SELECT
  USING (auth.uid() = seller_id);

CREATE POLICY "Buyers can create orders"
  ON orders FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Admins can manage orders"
  ON orders FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_orders_buyer
  ON orders (buyer_id);

CREATE INDEX IF NOT EXISTS idx_orders_seller
  ON orders (seller_id);

CREATE INDEX IF NOT EXISTS idx_orders_listing
  ON orders (listing_id);

-- ═══ 11. reviews ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view reviews"
  ON reviews FOR SELECT
  USING (true);

CREATE POLICY "Reviewers can create reviews"
  ON reviews FOR INSERT
  WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "Reviewers can update own reviews"
  ON reviews FOR UPDATE
  USING (auth.uid() = reviewer_id);

CREATE INDEX IF NOT EXISTS idx_reviews_order
  ON reviews (order_id);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee
  ON reviews (reviewee_id);

-- ═══ 12. subscription_plans ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  price           NUMERIC NOT NULL,
  currency        TEXT DEFAULT 'ZAR',
  interval        TEXT NOT NULL CHECK (interval IN ('monthly', 'annual')),
  features        JSONB DEFAULT '[]',
  payfast_plan_id TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active plans"
  ON subscription_plans FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage plans"
  ON subscription_plans FOR ALL
  USING (true);

-- ═══ 13. subscriptions ═════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id               UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  payfast_token         TEXT,
  status                TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'paused')),
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own subscriptions"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage subscriptions"
  ON subscriptions FOR ALL
  USING (true);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status)
  WHERE status = 'active';

-- ═══ 14. updated_at trigger function ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables with updated_at column
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON smart_productions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON smart_rentals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON press
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON careers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON equipment_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ 15. handle_new_user trigger (auto-create profile on signup) ═══════════════

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

COMMIT;
