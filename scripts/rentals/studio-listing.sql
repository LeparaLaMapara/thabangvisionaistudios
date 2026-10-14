-- The owner's studio, ThaBangVision Studio Labs, as the first Studios listing
-- (owner request 2026-10-15).
--
-- Needs migration 093 (the 'studios' category and price_per_half_day).
-- Idempotent: run it again and the row is brought back to these values.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rentals/studio-listing.sql
--
-- WHAT IT WRITES (smart_rentals prices are RANDS, docs/database/schema.md)
--   price_per_day       3500  full day
--   price_per_half_day  1500  half day. Set it to null to remove the half-day
--                             option everywhere if the price was misread.
--                             Half days are arranged on WhatsApp ("ask us"):
--                             bookings are whole days.
--   deposit_amount      1750  STUDIO.rental.depositPercent (50%) of the full
--                             day, as a fixed refundable deposit. The usual
--                             rule (25% of replacement value) does not fit a
--                             room that never leaves, so replacement_value
--                             stays null.
--   Location: not stored here. The page names the place with
--   collectionPoint() (lib/rental/collection-point.ts), so it cannot drift
--   from the collection point.
--   Media: the owner's own behind-the-scenes clips, files in
--   public/media/rentals/studio (frames chosen without identifiable faces).
--   video_provider 'file' points at the loop; the WebM and poster sit next to
--   it (lib/rental/on-site.ts rentalLoop).

begin;

insert into public.smart_rentals (
  slug, title, description, category, sub_category,
  price_per_day, price_per_half_day, price_per_week, deposit_amount, replacement_value,
  currency, thumbnail_url, gallery, quantity,
  is_available, is_published, listing_status, is_featured, is_archived,
  owner_type, owner_id,
  tags, features, rental_includes, metadata,
  video_provider, video_url, video_id
) values (
  'thabangvision-studio-labs',
  'ThaBangVision Studio Labs',
  'Our own photo and video studio, set up and ready for your shoot. Included: backdrop, softbox lights, changing area, Wi-Fi, cameras and props.',
  'studios',
  null,
  3500, 1500, null, 1750, null,
  'ZAR',
  '/media/rentals/studio/studio-photographer.webp',
  '[
    {"url": "/media/rentals/studio/studio-photographer.webp", "public_id": "studio-photographer"},
    {"url": "/media/rentals/studio/studio-shoot-silhouette.webp", "public_id": "studio-shoot-silhouette"},
    {"url": "/media/rentals/studio/studio-softbox.webp", "public_id": "studio-softbox"},
    {"url": "/media/rentals/studio/studio-empty.webp", "public_id": "studio-empty"}
  ]'::jsonb,
  1,
  true, true, 'published', false, false,
  'studio', null,
  array['studio', 'photo studio', 'video studio'],
  array[]::text[],
  array['Backdrop', 'Softbox lights', 'Changing area', 'Wi-Fi', 'Cameras', 'Props'],
  '{}'::jsonb,
  'file', '/media/rentals/studio/studio-loop.mp4', null
)
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  sub_category = excluded.sub_category,
  price_per_day = excluded.price_per_day,
  price_per_half_day = excluded.price_per_half_day,
  price_per_week = excluded.price_per_week,
  deposit_amount = excluded.deposit_amount,
  replacement_value = excluded.replacement_value,
  currency = excluded.currency,
  thumbnail_url = excluded.thumbnail_url,
  gallery = excluded.gallery,
  quantity = excluded.quantity,
  is_available = excluded.is_available,
  is_published = excluded.is_published,
  listing_status = excluded.listing_status,
  is_archived = excluded.is_archived,
  owner_type = excluded.owner_type,
  owner_id = excluded.owner_id,
  tags = excluded.tags,
  features = excluded.features,
  rental_includes = excluded.rental_includes,
  metadata = excluded.metadata,
  video_provider = excluded.video_provider,
  video_url = excluded.video_url,
  video_id = excluded.video_id,
  deleted_at = null,
  updated_at = now();

commit;
