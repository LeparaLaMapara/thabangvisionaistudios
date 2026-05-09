-- 032: Add per-item date columns to cart_items
-- Nullable so users can add to cart before picking dates; validated at checkout.

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS end_date date;

-- Ensure both dates are set together
ALTER TABLE cart_items ADD CONSTRAINT cart_items_dates_both_or_neither
  CHECK (
    (start_date IS NULL AND end_date IS NULL)
    OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date)
  );
