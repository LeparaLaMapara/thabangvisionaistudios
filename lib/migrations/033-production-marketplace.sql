-- 033: Production marketplace columns
-- Add creator_id (single owner for marketplace listings) and price_unit.
-- price and currency already exist from prior migration.

ALTER TABLE smart_productions ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES auth.users(id);
ALTER TABLE smart_productions ADD COLUMN IF NOT EXISTS price_unit text NOT NULL DEFAULT 'project';

CREATE INDEX IF NOT EXISTS idx_smart_productions_creator ON smart_productions(creator_id);
CREATE INDEX IF NOT EXISTS idx_smart_productions_price ON smart_productions(price) WHERE price IS NOT NULL AND is_published = true;
