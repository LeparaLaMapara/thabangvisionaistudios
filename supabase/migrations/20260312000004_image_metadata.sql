-- ─── Add image_metadata column to smart_productions ─────────────────────────
-- Stores EXIF data extracted from production images.
-- Format: array of { url, camera, lens, focalLength, aperture, iso, shutterSpeed, ... }

ALTER TABLE smart_productions
  ADD COLUMN IF NOT EXISTS image_metadata jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN smart_productions.image_metadata IS 'EXIF metadata extracted from gallery images';
